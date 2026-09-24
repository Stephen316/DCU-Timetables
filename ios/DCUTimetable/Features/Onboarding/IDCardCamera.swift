import AVFoundation
import SwiftUI
import Vision

/// The camera behind `StudentIDView`. It reads the card's barcode two ways: from the photo
/// when the shutter is pressed, and live while the card is being lined up, so a steady hand
/// often doesn't need the shutter at all.
///
/// Only the decoded number leaves this class. The photo is read in memory and dropped — it
/// is never written to disk, never uploaded, and never reaches the photo library.
@MainActor
final class IDCardCamera: NSObject, ObservableObject {
    enum Status: Equatable {
        case starting
        case running
        /// No back camera: the Simulator, or hardware that isn't there.
        case unavailable
        /// Camera access was refused, now or earlier.
        case denied
    }

    /// Why a photo gave no number.
    enum Problem: Error, Equatable {
        /// There was a barcode, but not a student card's.
        case notACard
        case unreadable
    }

    /// The guide frame's width as a share of the screen's. The view draws it at this width
    /// and `zoomFactor` assumes it, so the two can't drift apart.
    static let guideWidthFraction: CGFloat = 0.88
    /// ID-1, the size of every bank and student card: 85.6 × 54 mm.
    static let cardAspect: CGFloat = 85.6 / 54

    @Published private(set) var status: Status = .starting
    @Published private(set) var isCapturing = false
    /// A card's number, once one has been read. `resume()` clears it.
    @Published private(set) var read: StudentNumber?
    @Published private(set) var problem: Problem?

    let session = AVCaptureSession()
    private let photoOutput = AVCapturePhotoOutput()
    private let metadataOutput = AVCaptureMetadataOutput()
    /// Configuring, starting and stopping a session block, so they happen here.
    private let queue = DispatchQueue(label: "ie.dcu.timetable.id-camera")
    private var configured = false
    /// A live read counts once this many frames agree. The barcode has no check character,
    /// so one frame caught mid-blur could otherwise hand over a wrong number that still has
    /// the right shape — and it's saved without a second look (`StudentIDView`). At 30
    /// frames a second, three is a tenth of a second on a card held still.
    static let liveAgreement = 3
    /// The number the last frames agreed on, and how many of them.
    private var liveRead: (number: StudentNumber, frames: Int)?

    /// The preview's layer and the guide frame in its coordinates. Together they say which
    /// part of the sensor holds the card.
    weak var previewLayer: AVCaptureVideoPreviewLayer?
    var guide: CGRect = .zero {
        didSet { if guide != oldValue { applyGuide() } }
    }
    /// The guide in the sensor's normalised coordinates, which are also the unrotated
    /// photo's. The whole frame until the preview has reported where the guide is.
    private var guideInSensor = CGRect(x: 0, y: 0, width: 1, height: 1)

    func start() async {
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
            status = .unavailable
            return
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            break
        case .notDetermined:
            guard await AVCaptureDevice.requestAccess(for: .video) else {
                status = .denied
                return
            }
        default:
            status = .denied
            return
        }

        let needsConfiguring = !configured
        configured = true
        let (session, photo, metadata) = (session, photoOutput, metadataOutput)
        let working = await withCheckedContinuation { continuation in
            queue.async {
                if needsConfiguring,
                   !Self.configure(session, device: device, photo: photo, metadata: metadata) {
                    continuation.resume(returning: false)
                    return
                }
                session.startRunning()
                continuation.resume(returning: session.isRunning)
            }
        }
        guard working else {
            status = .unavailable
            return
        }
        metadataOutput.setMetadataObjectsDelegate(self, queue: .main)
        status = .running
        applyGuide()
    }

    func stop() {
        let session = session
        queue.async { session.stopRunning() }
    }

    /// Back to lining up a card, after a read was turned down or a sheet closed.
    func resume() {
        read = nil
        problem = nil
        liveRead = nil
        guard status == .running else { return }
        let session = session
        queue.async { if !session.isRunning { session.startRunning() } }
    }

    func capture() {
        guard status == .running, !isCapturing, read == nil else { return }
        isCapturing = true
        problem = nil
        let settings = AVCapturePhotoSettings()
        // A flash is the glare on the laminate that the instructions ask them to avoid.
        settings.flashMode = .off
        photoOutput.capturePhoto(with: settings, delegate: self)
    }

    private func applyGuide() {
        guard status == .running, let previewLayer, !guide.isEmpty else { return }
        let rect = previewLayer.metadataOutputRectConverted(fromLayerRect: guide)
        guard !rect.isEmpty, rect.width.isFinite, rect.height.isFinite else { return }
        guideInSensor = rect
        let output = metadataOutput
        queue.async { output.rectOfInterest = rect }
    }

    private func deliver(_ number: StudentNumber) {
        read = number
        problem = nil
        stop()
    }

    // MARK: - Session

    private nonisolated static func configure(_ session: AVCaptureSession, device: AVCaptureDevice,
                                              photo: AVCapturePhotoOutput,
                                              metadata: AVCaptureMetadataOutput) -> Bool {
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        // 4:3, which `zoomFactor` assumes.
        session.sessionPreset = .photo

        guard let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input),
              session.canAddOutput(photo), session.canAddOutput(metadata) else { return false }
        session.addInput(input)
        session.addOutput(photo)
        session.addOutput(metadata)
        // Only once the output is on the session does it know what it can recognise.
        if metadata.availableMetadataObjectTypes.contains(.code39) {
            metadata.metadataObjectTypes = [.code39]
        }

        if (try? device.lockForConfiguration()) != nil {
            if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
            if device.isAutoFocusRangeRestrictionSupported { device.autoFocusRangeRestriction = .near }
            device.videoZoomFactor = zoomFactor(for: device)
            device.unlockForConfiguration()
        }
        return true
    }

    /// A card that fills the guide sits about 9 cm from the lens, closer than many iPhones'
    /// main camera can focus — the Pro models' can't get nearer than about 20 cm. Zooming in
    /// moves the card out to where it's sharp. Apple's AVCamBarcode sample does the same.
    private nonisolated static func zoomFactor(for device: AVCaptureDevice) -> CGFloat {
        let minimumFocus = CGFloat(device.minimumFocusDistance)   // mm; -1 when unknown
        guard minimumFocus > 0 else { return 1 }
        // In portrait the screen's width is the sensor's short side. The field of view is
        // given across the long side, and a 4:3 frame's short side spans 3/4 of its tangent.
        let halfLong = CGFloat(device.activeFormat.videoFieldOfView) * .pi / 360
        let tanHalfShort = tan(halfLong) * 3 / 4
        let distance = 85.6 / guideWidthFraction / 2 / tanHalfShort
        guard distance < minimumFocus else { return 1 }
        return min(minimumFocus / distance, device.activeFormat.videoMaxZoomFactor)
    }

    // MARK: - Reading a photo

    private nonisolated static func decode(_ image: CGImage, guide: CGRect) -> Result<StudentNumber, Problem> {
        // The guide with a margin, so a card not quite lined up is still inside, then the
        // whole photo in case it wasn't lined up at all. The crop is what makes the
        // difference on a busy photo: the hologram and the background are what defeat it.
        let unit = CGRect(x: 0, y: 0, width: 1, height: 1)
        let region = guide.insetBy(dx: -guide.width * 0.15, dy: -guide.height * 0.15).intersection(unit)
        let size = CGSize(width: image.width, height: image.height)
        let pixels = CGRect(x: region.minX * size.width, y: region.minY * size.height,
                            width: region.width * size.width, height: region.height * size.height).integral

        var sawBarcode = false
        for candidate in [image.cropping(to: pixels), image].compactMap({ $0 }) {
            for payload in barcodes(in: candidate) {
                if let number = StudentNumber(barcode: payload) { return .success(number) }
                sawBarcode = true
            }
        }
        return .failure(sawBarcode ? .notACard : .unreadable)
    }

    private nonisolated static func barcodes(in image: CGImage) -> [String] {
        let request = VNDetectBarcodesRequest()
        request.symbologies = [.code39]
        try? VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        return (request.results ?? []).compactMap(\.payloadStringValue)
    }
}

extension IDCardCamera: AVCapturePhotoCaptureDelegate {
    nonisolated func photoOutput(_ output: AVCapturePhotoOutput,
                                 didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        // Unrotated, so its coordinates are the sensor's — the same space as `guideInSensor`.
        let image = photo.cgImageRepresentation()
        Task { @MainActor in
            let guide = guideInSensor
            let outcome: Result<StudentNumber, Problem>
            if let image {
                outcome = await Task.detached(priority: .userInitiated) {
                    Self.decode(image, guide: guide)
                }.value
            } else {
                outcome = .failure(.unreadable)
            }
            isCapturing = false
            guard read == nil else { return }   // a live read got there first
            switch outcome {
            case .success(let number): deliver(number)
            case .failure(let reason): problem = reason
            }
        }
    }
}

extension IDCardCamera: AVCaptureMetadataOutputObjectsDelegate {
    /// Delivered on the main queue — see `setMetadataObjectsDelegate` in `start()`.
    nonisolated func metadataOutput(_ output: AVCaptureMetadataOutput,
                                    didOutput objects: [AVMetadataObject],
                                    from connection: AVCaptureConnection) {
        let payloads = objects.compactMap { ($0 as? AVMetadataMachineReadableCodeObject)?.stringValue }
        MainActor.assumeIsolated {
            guard read == nil,
                  let number = payloads.lazy.compactMap(StudentNumber.init(barcode:)).first else { return }
            let frames = liveRead?.number == number ? (liveRead?.frames ?? 0) + 1 : 1
            liveRead = (number, frames)
            if frames >= Self.liveAgreement { deliver(number) }
        }
    }
}

/// The live camera image. A `UIView` whose layer *is* the preview layer, so it resizes with
/// the view without being told.
struct CameraPreview: UIViewRepresentable {
    let camera: IDCardCamera

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = camera.session
        view.previewLayer.videoGravity = .resizeAspectFill
        camera.previewLayer = view.previewLayer
        return view
    }

    func updateUIView(_ view: PreviewView, context: Context) {}

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }
}
