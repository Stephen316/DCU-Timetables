import SwiftUI

/// The day as a line you move along.
///
/// Every class is a stop on one continuous rail, with its start time set large beside it,
/// so the left edge of the screen reads as a clock running down the day. Free time is the
/// rail carrying on, dashed, with nothing on it. The class you should be heading to is the
/// one stop drawn in the accent. Classes already over shrink to a dot.
///
/// A rail rather than a stack of cards: cards make every class the same size of object,
/// and what a student is doing with this screen is reading *time* — where the gaps are,
/// how long the day runs, what's next.
enum RailStop: Equatable {
    /// Still to come, nothing to say about it.
    case upcoming
    /// The class to be walking to now (see `NextClassWindow`).
    case next
    /// Over.
    case past
    /// Carries news: cancelled, moved, a test, something due. Drawn in that news's colour.
    case flagged(Color)
}

/// Where a row sits in the day, which decides whether the rail runs above and below its stop.
struct RailPosition: Equatable {
    var hasAbove: Bool
    var hasBelow: Bool

    static func at(_ index: Int, of count: Int) -> RailPosition {
        RailPosition(hasAbove: index > 0, hasBelow: index < count - 1)
    }
}

/// Shared measurements, scaled with Dynamic Type so the rail lines up with the text beside
/// it at every size. A `DynamicProperty` so the scaled values inside it stay live when
/// it's held by a view.
private struct RailMetrics: DynamicProperty {
    @ScaledMetric(relativeTo: .title3) var gutter: CGFloat = 58
    /// From the top of a row's text to the middle of its first line — where the stop sits.
    @ScaledMetric(relativeTo: .title3) var stopCentre: CGFloat = 12
    @ScaledMetric(relativeTo: .title3) var stop: CGFloat = 11
    let column: CGFloat = 28
}

/// One class on the rail.
///
/// At the accessibility text sizes the times move above the content instead of beside it.
/// A 58pt gutter becomes ~150pt at AX5, which would leave the class title a few
/// characters per line; stacking keeps the title at full width and the rail at the edge.
struct RailRow<Content: View>: View {
    let start: Date
    let end: Date
    let stop: RailStop
    let position: RailPosition
    let content: Content

    @Environment(\.dynamicTypeSize) private var typeSize
    private var metrics = RailMetrics()

    init(start: Date, end: Date, stop: RailStop, position: RailPosition,
         @ViewBuilder content: () -> Content) {
        self.start = start
        self.end = end
        self.stop = stop
        self.position = position
        self.content = content()
    }

    private var stacked: Bool { typeSize.isAccessibilitySize }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            if !stacked {
                times
                    .frame(width: metrics.gutter, alignment: .trailing)
            }
            Color.clear.frame(width: metrics.column)
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                if stacked {
                    HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s) {
                        Text(start.formatted(date: .omitted, time: .shortened))
                            .font(.railStart)
                        Text("to \(end.formatted(date: .omitted, time: .shortened))")
                            .font(.railEnd)
                            .foregroundStyle(Theme.inkSecondary)
                    }
                    .foregroundStyle(timeColour)
                }
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, Theme.Space.m)
        .padding(.trailing, Theme.Space.l)
        .background(alignment: .topLeading) {
            RailLine(x: railX, stopY: Theme.Space.m + metrics.stopCentre,
                     position: position, dashed: false) {
                StopMark(stop: stop, diameter: metrics.stop)
            }
        }
    }

    private var railX: CGFloat {
        (stacked ? 0 : metrics.gutter) + metrics.column / 2
    }

    private var times: some View {
        VStack(alignment: .trailing, spacing: Theme.Space.xxs) {
            Text(start.formatted(date: .omitted, time: .shortened))
                .font(.railStart)
                .foregroundStyle(timeColour)
            Text(end.formatted(date: .omitted, time: .shortened))
                .font(.railEnd)
                .foregroundStyle(Theme.inkSecondary)
        }
        // Times are read with the row, not as a separate element.
        .accessibilityHidden(true)
    }

    private var timeColour: Color {
        switch stop {
        case .next: return Theme.accent
        case .past: return Theme.inkSecondary
        case .upcoming, .flagged: return Theme.ink
        }
    }
}

/// Free time between two classes: the rail carries on, dashed, with nothing on it.
struct RailGap: View {
    let start: Date
    let end: Date
    let label: String

    @Environment(\.dynamicTypeSize) private var typeSize
    private var metrics = RailMetrics()

    init(start: Date, end: Date, label: String) {
        self.start = start
        self.end = end
        self.label = label
    }

    var body: some View {
        let stacked = typeSize.isAccessibilitySize
        HStack(alignment: .center, spacing: 0) {
            if !stacked {
                Color.clear.frame(width: metrics.gutter)
            }
            Color.clear.frame(width: metrics.column)
            Text(label)
                .font(.footnote)
                .foregroundStyle(Theme.inkTertiary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, Theme.Space.l)
        .padding(.trailing, Theme.Space.l)
        .background(alignment: .topLeading) {
            RailLine(x: (stacked ? 0 : metrics.gutter) + metrics.column / 2, stopY: 0,
                     position: RailPosition(hasAbove: true, hasBelow: true), dashed: true) {
                EmptyView()
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label), \(start.formatted(date: .omitted, time: .shortened)) to \(end.formatted(date: .omitted, time: .shortened))")
    }
}

/// The vertical line through a row, and the stop on it.
private struct RailLine<Stop: View>: View {
    let x: CGFloat
    let stopY: CGFloat
    let position: RailPosition
    let dashed: Bool
    @ViewBuilder var stop: Stop

    var body: some View {
        GeometryReader { geo in
            Path { path in
                path.move(to: CGPoint(x: x, y: position.hasAbove ? 0 : stopY))
                path.addLine(to: CGPoint(x: x, y: position.hasBelow ? geo.size.height : stopY))
            }
            .stroke(Theme.rail,
                    style: StrokeStyle(lineWidth: Theme.Size.railLine,
                                       lineCap: .butt,
                                       dash: dashed ? [3, 4] : []))
            stop.position(x: x, y: stopY)
        }
        .accessibilityHidden(true)
    }
}

/// The mark where a class sits on the rail.
private struct StopMark: View {
    let stop: RailStop
    let diameter: CGFloat

    var body: some View {
        switch stop {
        case .upcoming:
            // Filled with the canvas so the rail doesn't show through the ring.
            Circle()
                .fill(Theme.canvas)
                .overlay(Circle().strokeBorder(Theme.rail, lineWidth: Theme.Size.railLine))
                .frame(width: diameter, height: diameter)
        case .past:
            Circle()
                .fill(Theme.rail)
                .frame(width: diameter * 0.55, height: diameter * 0.55)
        case .next:
            // A halo as well as a fill, so it doesn't rely on the accent's hue alone.
            Circle()
                .fill(Theme.accent)
                .frame(width: diameter, height: diameter)
                .padding(3)
                .overlay(Circle().strokeBorder(Theme.accent.opacity(0.35), lineWidth: 3))
        case .flagged(let tint):
            Circle()
                .fill(tint)
                .frame(width: diameter, height: diameter)
        }
    }
}

#if DEBUG
#Preview("Rail pieces") {
    let base = Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: .now) ?? .now
    let hour: TimeInterval = 3600
    ScrollView {
        VStack(spacing: 0) {
            RailRow(start: base, end: base + hour, stop: .past,
                    position: .at(0, of: 4)) { Text("Computer Systems").font(.headline) }
            RailGap(start: base + hour, end: base + 2 * hour, label: "1 hr free")
            RailRow(start: base + 2 * hour, end: base + 3 * hour, stop: .next,
                    position: .at(1, of: 4)) { Text("Digital Innovation").font(.headline) }
            RailRow(start: base + 3 * hour, end: base + 5 * hour,
                    stop: .flagged(TimetableTint.off),
                    position: .at(2, of: 4)) { Text("Networks").font(.headline) }
            RailRow(start: base + 5 * hour, end: base + 6 * hour, stop: .upcoming,
                    position: .at(3, of: 4)) { Text("Maths for Computing").font(.headline) }
        }
    }
    .background(Theme.canvas)
    .foregroundStyle(Theme.ink)
}
#endif
