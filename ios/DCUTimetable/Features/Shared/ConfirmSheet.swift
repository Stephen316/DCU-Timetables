import SwiftUI

/// A confirmation step drawn in the app's own idiom rather than the system's.
///
/// `confirmationDialog` renders as a grey system sheet that carries none of the meaning the
/// rest of the app uses: the orange that means "reported cancelled" everywhere else, the
/// 6pt bordered buttons, the symbol vocabulary. Asking "report this as cancelled?" in a
/// chrome-coloured box makes the question look like it came from iOS instead of from the
/// timetable.
///
/// Presented as a sheet with a fixed detent, not a hand-rolled overlay: it keeps the
/// swipe-to-dismiss, the focus handling and the accessibility behaviour that a `ZStack` over
/// the page would have to reimplement, and a plain overlay cannot cover the navigation bar
/// or the floating tab bar anyway.
///
/// Scales with Dynamic Type: the detent grows with the text, and the message scrolls past
/// the point where even that runs out of screen.
struct ConfirmSheet: View {
    let title: String
    let message: String
    let confirmTitle: String
    let symbol: String
    /// Carries the meaning — `TimetableTint.off` for a cancellation, the accent for
    /// anything ordinary. Drawn as the icon, where it sits on the sheet's background.
    let tint: Color
    /// The same meaning as `tint` but as a button fill, which is a different contrast
    /// problem: see `TimetableTint.offFill`, which carries white text. Leave it nil for an
    /// ordinary confirmation and the button takes the accent.
    var fill: Color?
    let onConfirm: () -> Void

    @Environment(\.dismiss) private var dismiss
    /// The sheet's height at the default text size, scaled up with it.
    @ScaledMetric(relativeTo: .body) private var detentHeight: CGFloat = 300

    var body: some View {
        VStack(spacing: 0) {
            // Scrolls so the buttons stay reachable at the largest Dynamic Type sizes,
            // where this content is several times taller than the detent.
            ScrollView {
                VStack(spacing: 12) {
                    Image(systemName: symbol)
                        .font(.title)
                        .foregroundStyle(tint)
                    Text(title)
                        .font(.headline)
                        .foregroundStyle(Theme.ink)
                        .multilineTextAlignment(.center)
                    Text(message)
                        .font(.subheadline)
                        .foregroundStyle(Theme.inkSecondary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, Theme.Space.xl + Theme.Space.xs)
                .padding(.horizontal, Theme.Space.xl)
            }

            VStack(spacing: Theme.Space.s) {
                Button {
                    // Dismiss first: the caller's work is asynchronous, and leaving the
                    // sheet up while it runs makes a slow network look like a dead button.
                    dismiss()
                    onConfirm()
                } label: {
                    Text(confirmTitle)
                }
                .buttonStyle(PrimaryButtonStyle(fill: fill ?? Theme.accent,
                                                foreground: fill == nil ? Theme.onAccent : .white))

                // Full width comes from the style, which sizes the tappable area with it —
                // a frame chained onto the Button would stretch the slot and leave the hit
                // area the size of the words.
                Button("Not now") { dismiss() }
                    .buttonStyle(.secondary)
            }
            .padding(.horizontal, Theme.Space.xl)
            .padding(.top, Theme.Space.l)
            .padding(.bottom, Theme.Space.xl)
        }
        .presentationDetents([.height(detentHeight)])
        .presentationDragIndicator(.visible)
        .presentationBackground(Theme.surface)
    }
}

#if DEBUG
#Preview("Light") { PreviewScreen.confirm.view.previewVariant(.light) }
#Preview("Dark") { PreviewScreen.confirm.view.previewVariant(.dark) }
#Preview("Largest text") { PreviewScreen.confirm.view.previewVariant(.largestText) }
#Preview("iPhone SE", traits: .fixedLayout(width: 375, height: 667)) {
    PreviewScreen.confirm.view
}
#endif
