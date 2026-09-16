import SwiftUI

/// Swipe left/right to page the timetable — days in the day view, weeks in the calendar.
///
/// Only a decisively horizontal drag counts, so the vertical scroll through the day (or
/// the list) still wins for anything ambiguous. Callbacks are synchronous; the caller
/// decides whether the work needs a `Task`.
struct PagingSwipe: ViewModifier {
    let onBack: () -> Void
    let onForward: () -> Void

    private let minimumDistance: CGFloat = 60
    private let horizontalBias: CGFloat = 1.5

    func body(content: Content) -> some View {
        content.simultaneousGesture(
            DragGesture(minimumDistance: 24)
                .onEnded { value in
                    let dx = value.translation.width
                    let dy = value.translation.height
                    guard abs(dx) > minimumDistance, abs(dx) > abs(dy) * horizontalBias else { return }
                    if dx > 0 { onBack() } else { onForward() }
                }
        )
    }
}

extension View {
    func pagingSwipe(onBack: @escaping () -> Void,
                     onForward: @escaping () -> Void) -> some View {
        modifier(PagingSwipe(onBack: onBack, onForward: onForward))
    }
}
