import SwiftUI

/// A horizontally paged container whose content **tracks the finger** and wraps around.
///
/// Three pages are kept live — previous, current, next — in an `HStack` offset by the drag,
/// so a partial swipe shows the neighbouring page and can be abandoned. On release the
/// offset animates to the page boundary and the index is committed, which is what makes
/// wrapping (Fri → Mon) possible; a `TabView` page style can't wrap.
struct WrappingPager<Content: View>: View {
    let count: Int
    @Binding var index: Int
    @ViewBuilder var content: (Int) -> Content

    @State private var drag: CGFloat = 0

    private let commitFraction: CGFloat = 0.22

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            HStack(spacing: 0) {
                content(wrapped(index - 1)).frame(width: width)
                content(index).frame(width: width)
                content(wrapped(index + 1)).frame(width: width)
            }
            .offset(x: -width + drag)
            .simultaneousGesture(
                DragGesture(minimumDistance: 12)
                    .onChanged { value in
                        // Only follow decisively horizontal drags, so each page's own
                        // vertical scrolling still works.
                        guard abs(value.translation.width) > abs(value.translation.height) else { return }
                        drag = value.translation.width
                    }
                    .onEnded { value in
                        let dx = value.translation.width
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
        withAnimation(.easeOut(duration: 0.22)) {
            drag = step > 0 ? -width : width
        } completion: {
            index = wrapped(index + step)
            drag = 0
        }
    }

    private func settle() {
        withAnimation(.easeOut(duration: 0.2)) { drag = 0 }
    }

    private func wrapped(_ value: Int) -> Int {
        guard count > 0 else { return 0 }
        return ((value % count) + count) % count
    }
}
