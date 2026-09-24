import SwiftUI

/// Between signing in and the timetable: the student's number, read from the barcode on
/// their student card. "See other options" lets them type it instead.
///
/// The number is set once — after that only an admin can change it (`set_student_id` in
/// `supabase/phase13_roster_allocations.sql`) — so one read from the card is shown back to
/// be checked before anything is saved. The photo is read on the phone and dropped; only
/// the number is sent (see `IDCardCamera`).
struct StudentIDView: View {
    let onSaved: (String) -> Void
    let onSignOut: () -> Void

    @StateObject private var camera = IDCardCamera()
    /// The server is asked first. A reinstall or a second phone already has a number there,
    /// and shouldn't be asked for the camera only to find that out.
    @State private var checking = true
    /// The last number read, shown in the confirmation sheet. Kept apart from `confirming`
    /// so the sheet still has it to draw while it slides away.
    @State private var candidate: StudentNumber?
    @State private var confirming = false
    @State private var showingOptions = false
    @State private var saving = false
    @State private var saveError: String?
    /// Once saved, a sheet closing must not start the camera behind a screen that's leaving.
    @State private var saved = false

    @Environment(\.openURL) private var openURL
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
        .sensoryFeedback(.success, trigger: camera.read) { _, read in read != nil }
        .task { await begin() }
        .onDisappear { camera.stop() }
        .onChange(of: camera.read) { _, read in
            guard let read else { return }
            candidate = read
            saveError = nil
            confirming = true
        }
        .onChange(of: showingOptions) { _, showing in
            if showing {
                saveError = nil
                camera.stop()
            }
        }
        .sheet(isPresented: $confirming, onDismiss: resumeScanning) {
            if let candidate {
                NumberConfirmation(number: candidate, saving: saving, error: saveError,
                                   onSave: { save(candidate) },
                                   onRetake: { confirming = false })
            }
        }
        .sheet(isPresented: $showingOptions, onDismiss: resumeScanning) {
            OtherOptions(saving: saving, error: saveError, onSave: save, onSignOut: onSignOut)
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
        if checking {
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
            if let problem = camera.problem {
                Text(problem == .notACard
                     ? "That barcode isn't from a DCU student card."
                     : "Couldn't read the barcode. Tilt the card away from the light and try again.")
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
        if let existing = try? await store.myProfile()?.studentID {
            saved = true
            onSaved(existing)
            return
        }
        checking = false
        await camera.start()
    }

    private func resumeScanning() {
        guard !saved, !confirming, !showingOptions else { return }
        camera.resume()
    }

    private func save(_ number: StudentNumber) {
        guard !saving else { return }
        saving = true
        saveError = nil
        Task {
            defer { saving = false }
            do {
                try await store.setStudentID(number)
                saved = true
                onSaved(number.value)
            } catch let error as ProfileStoreError {
                saveError = error.errorDescription
            } catch {
                saveError = "Couldn't reach the server. Check your connection and try again."
            }
        }
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

/// "Is this your student number?" — asked of every number read from a card, because it
/// can't be changed afterwards without an admin. Drawn like `ConfirmSheet`, which can't be
/// used as is: that one closes before its action runs, and this one has to stay up to show
/// a failed save.
private struct NumberConfirmation: View {
    let number: StudentNumber
    let saving: Bool
    let error: String?
    let onSave: () -> Void
    let onRetake: () -> Void

    @ScaledMetric(relativeTo: .body) private var detentHeight: CGFloat = 340

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: Theme.Space.m) {
                    Image(systemName: "person.text.rectangle")
                        .font(.title)
                        .foregroundStyle(Theme.accent)
                    Text("Is this your student number?")
                        .font(.headline)
                        .foregroundStyle(Theme.ink)
                    Text(number.value)
                        .font(.largeTitle.weight(.semibold).monospacedDigit())
                        .foregroundStyle(Theme.ink)
                    Text("Check it against your card. Once it's saved, only an admin can change it.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.inkSecondary)
                    if let error {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(Theme.inkSecondary)
                    }
                }
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .padding(.top, Theme.Space.xl + Theme.Space.xs)
                .padding(.horizontal, Theme.Space.xl)
            }

            VStack(spacing: Theme.Space.s) {
                Button(action: onSave) {
                    HStack(spacing: Theme.Space.s) {
                        if saving { ProgressView().controlSize(.small).tint(Theme.onAccent) }
                        Text("Save")
                    }
                }
                .buttonStyle(.primary)
                Button("Retake", action: onRetake)
                    .buttonStyle(.secondary)
            }
            .disabled(saving)
            .padding(.horizontal, Theme.Space.xl)
            .padding(.top, Theme.Space.l)
            .padding(.bottom, Theme.Space.xl)
        }
        .presentationDetents([.height(detentHeight)])
        .presentationDragIndicator(.visible)
        .presentationBackground(Theme.surface)
        .interactiveDismissDisabled(saving)
    }
}

/// Typing the number instead, for a card that won't scan, a camera that isn't allowed, or
/// no card to hand. And the way out, for someone who signed in with the wrong account.
private struct OtherOptions: View {
    let saving: Bool
    let error: String?
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
                            .onSubmit { if let number, !saving { onSave(number) } }
                        Text(caption)
                            .font(.caption)
                            .foregroundStyle(Theme.inkSecondary)
                    }

                    if let error {
                        Section { Text(error).font(.callout).foregroundStyle(Theme.inkSecondary) }
                    }

                    Section {
                        Button { if let number { onSave(number) } } label: {
                            HStack(spacing: Theme.Space.s) {
                                if saving { ProgressView().controlSize(.small).tint(Theme.onAccent) }
                                Text("Save")
                            }
                        }
                        .buttonStyle(.primary)
                        .disabled(number == nil || saving)
                        .bareRow()
                        .listRowInsets(Theme.standaloneRowInsets)
                    }

                    Section {
                        Button(role: .destructive, action: onSignOut) {
                            Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                        }
                        .disabled(saving)
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
                    Button("Cancel") { dismiss() }.disabled(saving)
                }
            }
        }
        .interactiveDismissDisabled(saving)
    }
}

#if DEBUG
#Preview { StudentIDView(onSaved: { _ in }, onSignOut: {}) }
#endif
