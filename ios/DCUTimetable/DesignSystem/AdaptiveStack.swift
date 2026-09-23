import SwiftUI

/// A row that lays out side by side, and stacks once the text is one of the accessibility
/// sizes.
///
/// A deadline's title, its countdown and a "This is right" button fit on one line at
/// default size. At AX3 and up, the same line would clip the title to a few letters. The
/// HIG asks for reflow over truncation, and this is that reflow in one place instead of an
/// `if` in every row.
struct AdaptiveStack<Content: View>: View {
    var spacing: CGFloat = Theme.Space.s
    @ViewBuilder var content: Content

    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: spacing))
            : AnyLayout(HStackLayout(alignment: .center, spacing: spacing))
        layout { content }
    }
}
