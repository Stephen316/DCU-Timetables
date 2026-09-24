import SwiftUI

/// Between signing in and the timetable: the student's number, read from the barcode on
/// their student card. "See other options" lets them type it instead.
///
/// A number is saved the moment it's read or entered, and `SavedOverlay` confirms it over
/// the camera. There's no "is this right?" step, and the number can be set only once —
/// after that only an admin can change it (`set_student_id` in
/// `supabase/phase13_roster_allocations.sql`) — so a misread is stopped before it gets
/// here: `StudentNumber(barcode:)` refuses anything not shaped like a card's barcode, and
/// a live read counts only once several frames agree (`IDCardCamera.liveAgreement`).
///
/// The photo is read on the phone and dropped; only the number is sent.
struct StudentIDView: View {
    let onSaved: (String) -> Void
    let onSignOut: () -> Void

    /// The number on its way to the server, and whether it has arrived.
    private struct Confirmation: Equatable {
        let number: StudentNumber
        var saved = false
    }

    @StateObject private var camera = IDCardCamera()
    /// The server is asked first. A reinstall or a second phone already has a number there,
    /// and shouldn't be asked for the camera only to find that out.
    @State private var checking = true
    @State private var showingOptions = false
    /// A number typed in the sheet, saved once the sheet has gone — started any sooner, the
    /// confirmation plays out underneath it.
    @State private var typed: StudentNumber?
    @State private var confirmation: Confirmation?
    @State private var saveError: String?
    /// Once saved, a sheet closing must not start the camera behind a screen that's leaving.
    @State private var finished = false

    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let store = ProfileStoreFactory.make()

    var body: some View {
        GeometryReader { outer in
            let insets = outer.safeAreaInsets
            GeometryReader { full in
                let guide = Self.guideRect(in: full.size)
                ZStack {
                    Color.black
                    if !checking { CameraPreview(camera: camera) }
                    GuideOverlay(guide: guide)
                    layout(guide: guide, insets: insets)
                    if let confirmation {
                        SavedOverlay(number: confirmation.number, saved: confirmation.saved)
                            .position(x: guide.midX, y: guide.midY)
                            .transition(reduceMotion ? .opacity
                                                     : .scale(scale: 0.8).combined(with: .opacity))
                    }
                }
                // Dark over the camera whatever the setting, as the Camera app is. Applied
                // here rather than to the whole view so the sheets still follow the setting.
                .environment(\.colorScheme, .dark)
                .onAppear { camera.guide = guide }
                .onChange(of: guide) { _, rect in camera.guide = rect }
            }
            .ignoresSafeArea()
        }
        .statusBarHidden()
        .sensoryFeedback(.success, trigger: confirmation?.saved) { _, saved in saved == true }
        .task { await begin() }
        .onDisappear { camera.stop() }
        .onChange(of: camera.read) { _, read in
            if let read { save(read) }
        }
        .onChange(of: showingOptions) { _, showing in
            if showing {
                saveError = nil
                camera.stop()
            }
        }
        .sheet(isPresented: $showingOptions, onDismiss: optionsClosed) {
            OtherOptions(onSave: { number in
                             typed = number
                             showingOptions = false
                         },
                         onSignOut: onSignOut)
        }
    }

    /// The guide's place on the full screen. Its width is `IDCardCamera.guideWidthFraction`,
    /// which the camera's zoom is worked out from, and it sits a little above the middle to
    /// leave the lower part for the shutter.
    static func guideRect(in size: CGSize) -> CGRect {
        let width = size.width * IDCardCamera.guideWidthFraction
        let height = width / IDCardCamera.cardAspect
        return CGRect(x: (size.width - width) / 2, y: size.height * 0.42 - height / 2,
                      width: width, height: height)
    }

    private func layout(guide: CGRect, insets: EdgeInsets) -> some View {
        VStack(spacing: 0) {
            instructions
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                .padding(.bottom, Theme.Space.xl)
                .padding(.horizontal, Theme.Space.xl)
                .frame(height: max(0, guide.minY - insets.top))

            frameMessage
                .padding(Theme.Space.l)
                .frame(width: guide.width, height: guide.height)

            controls
                .padding(.horizontal, Theme.Space.xl)
                .frame(maxHeight: .infinity)
        }
        .padding(.top, insets.top)
        .padding(.bottom, max(insets.bottom, Theme.Space.s))
    }

    private var instructions: some View {
        VStack(spacing: Theme.Space.s) {
            Text("Take a photo of your student ID")
                .font(.title3.weight(.semibold))
                .foregroundStyle(.white)
            Text("Avoid reflections, and centre the card in the frame.")
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.8))
        }
        .multilineTextAlignment(.center)
        .minimumScaleFactor(0.6)
    }

    @ViewBuilder
    private var frameMessage: some View {
        if confirmation != nil {
            // The confirmation sits in the frame; a message behind it shows at its edges.
            EmptyView()
        } else if checking {
            ProgressView().tint(.white)
        } else {
            switch camera.status {
            case .unavailable:
                frameText("There's no camera to use here. Type your student number instead.")
            case .denied:
                frameText("Camera access is off for DCU Timetable. Turn it on in Settings, or type your student number instead.")
            case .starting, .running:
                EmptyView()
            }
        }
    }

    private func frameText(_ text: String) -> some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(.white)
            .multilineTextAlignment(.center)
            .minimumScaleFactor(0.6)
    }

    private var controls: some View {
        VStack(spacing: Theme.Space.m) {
            if let message = saveError ?? camera.problem.map(Self.describe) {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .padding(.top, Theme.Space.m)
            }

            Spacer(minLength: Theme.Space.s)

            switch camera.status {
            case .denied:
                Button("Open Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                }
                .buttonStyle(.secondary)
            case .unavailable:
                Button("Type your student number") { showingOptions = true }
                    .buttonStyle(.secondary)
            case .starting, .running:
                shutter
            }

            Spacer(minLength: Theme.Space.s)

            // The padding and the 44pt height are inside the label so the whole area takes
            // the tap, not just the small words.
            Button { showingOptions = true } label: {
                Text("See other options")
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.8))
                    .padding(.horizontal, Theme.Space.l)
                    .frame(minHeight: Theme.Size.minTarget)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .disabled(confirmation != nil)
        .opacity(confirmation == nil ? 1 : 0.4)
    }

    private static func describe(_ problem: IDCardCamera.Problem) -> String {
        switch problem {
        case .notACard: return "That barcode isn't from a DCU student card."
        case .unreadable: return "Couldn't read the barcode. Tilt the card away from the light and try again."
        }
    }

    private var shutter: some View {
        Button(action: camera.capture) {
            ZStack {
                Circle()
                    .strokeBorder(.white, lineWidth: 4)
                    .frame(width: 76, height: 76)
                Circle()
                    .fill(.white.opacity(camera.isCapturing ? 0.4 : 1))
                    .frame(width: 62, height: 62)
                if camera.isCapturing { ProgressView().tint(.black) }
            }
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(checking || camera.status != .running || camera.isCapturing)
        .opacity(checking || camera.status != .running ? 0.4 : 1)
        .accessibilityLabel("Take photo")
    }

    private func begin() async {
        do {
            if let existing = try await store.myProfile()?.studentID {
                finished = true
                onSaved(existing)
                return
            }
        } catch ProfileStoreError.notSignedIn {
            // Signed in on this phone, but with no session to act as: the app remembers who
            // signed in, and the tokens that let it act for them are gone. Nothing can be
            // saved without them, so back to sign-in rather than a scan whose Save can only
            // answer "You're not signed in."
            onSignOut()
            return
        } catch {
            // Offline, or the server erred. Scanning still works; the save will say so.
        }
        checking = false
        await camera.start()
    }

    private func optionsClosed() {
        if let number = typed {
            typed = nil
            save(number)
        } else if !finished, confirmation == nil {
            camera.resume()
        }
    }

    /// Shows the confirmation at once, then saves. The ring draws while the request is out
    /// and the tick draws when the server has the number — usually before the ring closes.
    private func save(_ number: StudentNumber) {
        guard confirmation == nil else { return }
        saveError = nil
        camera.stop()
        withAnimation(reduceMotion ? .easeOut(duration: 0.2) : .spring(duration: 0.35, bounce: 0.25)) {
            confirmation = Confirmation(number: number)
        }
        Task {
            do {
                try await store.setStudentID(number)
                confirmation?.saved = true
                // Long enough to see the tick land before the next screen replaces this one.
                try? await Task.sleep(for: .seconds(1.1))
                finished = true
                onSaved(number.value)
            } catch ProfileStoreError.notSignedIn {
                onSignOut()
            } catch {
                withAnimation(.easeOut(duration: 0.25)) { confirmation = nil }
                saveError = (error as? ProfileStoreError)?.errorDescription
                    ?? "Couldn't reach the server. Check your connection and try again."
                camera.resume()
            }
        }
    }
}

/// The translucent confirmation over the frozen camera image: a ring that draws while the
/// number is sent, then a tick, with the number itself underneath so the student sees what
/// was saved.
private struct SavedOverlay: View {
    let number: StudentNumber
    let saved: Bool

    @State private var ring: CGFloat = 0
    @ScaledMetric(relativeTo: .title) private var badge: CGFloat = 84

    var body: some View {
        VStack(spacing: Theme.Space.l) {
            ZStack {
                Circle()
                    .stroke(.white.opacity(0.25), lineWidth: 5)
                Circle()
                    .trim(from: 0, to: saved ? 1 : ring)
                    .stroke(.white, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Tick()
                    .trim(from: 0, to: saved ? 1 : 0)
                    .stroke(.white, style: StrokeStyle(lineWidth: 6, lineCap: .round, lineJoin: .round))
                    .padding(badge * 0.28)
            }
            .frame(width: badge, height: badge)

            VStack(spacing: Theme.Space.xs) {
                Text(number.value)
                    .font(.title2.weight(.semibold).monospacedDigit())
                Text(saved ? "Student number saved" : "Saving…")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.8))
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, Theme.Space.xxl)
        .padding(.vertical, Theme.Space.xl)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .animation(.easeOut(duration: 0.35), value: saved)
        .onAppear {
            // Most of the way round, not all: the last stretch is the server's to close.
            withAnimation(.easeOut(duration: 0.8)) { ring = 0.85 }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct Tick: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.midY + rect.height * 0.05))
        path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.38, y: rect.maxY - rect.height * 0.12))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY + rect.height * 0.15))
        return path
    }
}

/// The dimmed surround, and the marks that show where the card goes: a bracket at each
/// corner, and a tick at the middle of each edge to centre it by.
private struct GuideOverlay: View {
    let guide: CGRect

    private static let radius: CGFloat = 14

    var body: some View {
        Canvas { context, size in
            var surround = Path(CGRect(origin: .zero, size: size))
            surround.addRoundedRect(in: guide, cornerSize: CGSize(width: Self.radius, height: Self.radius))
            context.fill(surround, with: .color(.black.opacity(0.55)), style: FillStyle(eoFill: true))

            context.stroke(Path(roundedRect: guide, cornerRadius: Self.radius),
                           with: .color(.white.opacity(0.35)), lineWidth: 1)
            context.stroke(Self.marks(around: guide), with: .color(.white),
                           style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private static func marks(around r: CGRect) -> Path {
        let arm: CGFloat = 28
        let tick: CGFloat = 12
        var path = Path()

        func corner(_ start: CGPoint, _ elbow: CGPoint, _ end: CGPoint) {
            path.move(to: start)
            path.addArc(tangent1End: elbow, tangent2End: end, radius: radius)
            path.addLine(to: end)
        }
        corner(CGPoint(x: r.minX, y: r.minY + arm), CGPoint(x: r.minX, y: r.minY), CGPoint(x: r.minX + arm, y: r.minY))
        corner(CGPoint(x: r.maxX - arm, y: r.minY), CGPoint(x: r.maxX, y: r.minY), CGPoint(x: r.maxX, y: r.minY + arm))
        corner(CGPoint(x: r.maxX, y: r.maxY - arm), CGPoint(x: r.maxX, y: r.maxY), CGPoint(x: r.maxX - arm, y: r.maxY))
        corner(CGPoint(x: r.minX + arm, y: r.maxY), CGPoint(x: r.minX, y: r.maxY), CGPoint(x: r.minX, y: r.maxY - arm))

        for (edge, inward) in [(CGPoint(x: r.midX, y: r.minY), CGVector(dx: 0, dy: tick)),
                               (CGPoint(x: r.midX, y: r.maxY), CGVector(dx: 0, dy: -tick)),
                               (CGPoint(x: r.minX, y: r.midY), CGVector(dx: tick, dy: 0)),
                               (CGPoint(x: r.maxX, y: r.midY), CGVector(dx: -tick, dy: 0))] {
            path.move(to: edge)
            path.addLine(to: CGPoint(x: edge.x + inward.dx, y: edge.y + inward.dy))
        }
        return path
    }
}

/// Typing the number instead, for a card that won't scan, a camera that isn't allowed, or
/// no card to hand. And the way out, for someone who signed in with the wrong account.
///
/// Save closes the sheet and hands the number back, so the confirmation plays on the
/// camera screen like a scanned one, and a failure is reported there too.
private struct OtherOptions: View {
    let onSave: (StudentNumber) -> Void
    let onSignOut: () -> Void

    @State private var entry = ""
    @Environment(\.dismiss) private var dismiss

    private var number: StudentNumber? { StudentNumber(typed: entry) }

    private var caption: String {
        if entry.trimmingCharacters(in: .whitespaces).isEmpty {
            return "It's on your student card, after \"Student Number\": a letter and eight digits. Once it's saved, only an admin can change it."
        }
        guard let number else {
            return "A student number is a letter and eight digits, like A00000000."
        }
        return "Saves as \(number.value). Once it's saved, only an admin can change it."
    }

    var body: some View {
        NavigationStack {
            List {
                Group {
                    Section("Enter your student number") {
                        TextField("A00000000", text: $entry)
                            .font(.body.monospacedDigit())
                            .keyboardType(.asciiCapable)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .submitLabel(.done)
                            .onSubmit { if let number { onSave(number) } }
                        Text(caption)
                            .font(.caption)
                            .foregroundStyle(Theme.inkSecondary)
                    }

                    Section {
                        Button("Save") { if let number { onSave(number) } }
                            .buttonStyle(.primary)
                            .disabled(number == nil)
                            .bareRow()
                            .listRowInsets(Theme.standaloneRowInsets)
                    }

                    Section {
                        Button(role: .destructive, action: onSignOut) {
                            Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                        }
                    }
                }
                .themedRows()
            }
            .listStyle(.grouped)
            .themedList()
            .navigationTitle("Other options")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}

#if DEBUG
#Preview { StudentIDView(onSaved: { _ in }, onSignOut: {}) }
#endif
