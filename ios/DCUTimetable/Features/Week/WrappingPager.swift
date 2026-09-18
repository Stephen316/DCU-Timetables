import SwiftUI

/// A horizontally paged container whose content **tracks the finger**.
///
/// Three pages are kept live — previous, current, next — in an `HStack` offset by the drag,
/// so a partial swipe shows the neighbouring page and can be abandoned. On release the
/// offset animates to the page boundary and the index is committed, which is what makes
/// wrapping (Fri → Mon) possible; a `TabView` page style can't wrap.
///
/// `bounds` decides what happens at the ends. The day pager wraps within its week; the week
/// pager stops, because scrolling back from week 1 and landing in week 52 is a teleport, not
/// a scroll.
struct WrappingPager<Content: View>: View {
    let count: Int
    var bounds: PagerBounds = .wrapping
    @Binding var index: Int
    @ViewBuilder var content: (Int) -> Content

    @State private var drag: CGFloat = 0
    /// Shared with the pages so a swipe can't be mistaken for a tap on the row it started on.
    @State private var dragState = PagerDragState()

    private let commitFraction: CGFloat = 0.22

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            HStack(spacing: 0) {
                page(index - 1).frame(width: width)
                page(index).frame(width: width)
                page(index + 1).frame(width: width)
            }
            .environment(\.pagerDrag, dragState)
            .offset(x: -width + drag)
            .simultaneousGesture(
                DragGesture(minimumDistance: 12)
                    .onChanged { value in
                        // Only follow decisively horizontal drags, so each page's own
                        // vertical scrolling still works.
                        guard abs(value.translation.width) > abs(value.translation.height) else { return }
                        dragState.begin()
                        // Past the last page in either direction the content resists rather
                        // than freezing: the finger still moves something, so the gesture
                        // reads as "there is nothing here", not as a dropped touch.
                        drag = isBlocked(value.translation.width)
                            ? value.translation.width * 0.25
                            : value.translation.width
                    }
                    .onEnded { value in
                        let dx = value.translation.width
                        dragState.end()
                        guard abs(dx) > abs(value.translation.height) else { return settle() }
                        if dx < -width * commitFraction { commit(step: 1, width: width) }
                        else if dx > width * commitFraction { commit(step: -1, width: width) }
                        else { settle() }
                    }
            )
        }
        .clipped()
    }

    /// Animate out to the page edge, then swap the index and reset the offset in the same
    /// frame so the new centre page is already in place — no visible jump.
    private func commit(step: Int, width: CGFloat) {
        guard let destination = PagerIndex.resolve(index + step, count: count, bounds: bounds) else {
            return settle()
        }
        withAnimation(.easeOut(duration: 0.22)) {
            drag = step > 0 ? -width : width
        } completion: {
            index = destination
            drag = 0
        }
    }

    private func settle() {
        withAnimation(.easeOut(duration: 0.2)) { drag = 0 }
    }

    /// Blank rather than the far end of the range — the whole point of `.clamped`.
    @ViewBuilder
    private func page(_ value: Int) -> some View {
        if let resolved = PagerIndex.resolve(value, count: count, bounds: bounds) {
            content(resolved)
        } else {
            Color.clear
        }
    }

    private func isBlocked(_ translation: CGFloat) -> Bool {
        let neighbour = translation > 0 ? index - 1 : index + 1
        return PagerIndex.resolve(neighbour, count: count, bounds: bounds) == nil
    }
}
