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
struct ConfirmSheet: View {
    let title: String
    let message: String
    let confirmTitle: String
    let symbol: String
    /// Carries the meaning — `TimetableTint.off` for a cancellation, the accent for
    /// anything ordinary. Drawn as the icon, where it sits on the sheet's background.
    let tint: Color
    /// The same meaning as `tint` but as a button fill, which is a different contrast
    /// problem: see `TimetableTint.offFill`. Defaults to `tint` for colours that work both
    /// ways, such as the system accent.
    var fill: Color?
    let onConfirm: () -> Void

    @Environment(\.dismiss) private var dismiss

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
                        .multilineTextAlignment(.center)
                    Text(message)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 28)
                .padding(.horizontal, 24)
            }

            VStack(spacing: 10) {
                Button {
                    // Dismiss first: the caller's work is asynchronous, and leaving the
                    // sheet up while it runs makes a slow network look like a dead button.
                    dismiss()
                    onConfirm()
                } label: {
                    Text(confirmTitle)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 2)
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.roundedRectangle(radius: 6))
                .tint(fill ?? tint)

                // The width goes inside the label, not chained onto the Button: a frame
                // applied outside stretches the layout slot and leaves the tappable area
                // the size of the words, which looks identical and isn't.
                Button {
                    dismiss()
                } label: {
                    Text("Not now")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 2)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.roundedRectangle(radius: 6))
                .tint(.secondary)
            }
            .padding(.horizontal, 24)
            .padding(.top, 16)
            .padding(.bottom, 24)
        }
        .presentationDetents([.height(280)])
        .presentationDragIndicator(.visible)
    }
}
