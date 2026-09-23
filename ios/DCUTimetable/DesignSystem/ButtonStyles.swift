import SwiftUI

/// The one action a screen is for: sign in, continue, report it. Full width, filled.
///
/// The fill is a parameter because a destructive-feeling action (reporting a class
/// cancelled) is filled with the cancellation orange rather than the accent. That keeps the
/// question and the colour it will produce on the timetable the same thing.
struct PrimaryButtonStyle: ButtonStyle {
    var fill: Color = Theme.accent
    var foreground: Color = Theme.onAccent

    func makeBody(configuration: Configuration) -> some View {
        StyledBody(configuration: configuration, fill: fill, foreground: foreground,
                   weight: .semibold)
    }
}

/// The alternative to a primary action — "Not now", "Use a different email". Same shape,
/// quieter fill, so the pair reads as a choice with an obvious default.
struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        StyledBody(configuration: configuration, fill: Theme.raised, foreground: Theme.ink,
                   weight: .regular)
    }
}

/// A small inline action inside a row, such as "This is right" on a deadline.
///
/// The visible chip is sized to its words, but the hit area is padded out to 44pt so it can
/// be hit with a thumb. A chip only as tall as its caption text would pass a simulator
/// tap and miss a real finger.
struct InlineActionButtonStyle: ButtonStyle {
    var tint: Color = Theme.accent

    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.footnote.weight(.medium))
            .foregroundStyle(tint)
            .padding(.horizontal, Theme.Space.m)
            .padding(.vertical, Theme.Space.xs + Theme.Space.xxs)
            .background(Theme.raised, in: RoundedRectangle(cornerRadius: Theme.Radius.control))
            .opacity(configuration.isPressed ? 0.6 : (isEnabled ? 1 : 0.4))
            .frame(minHeight: Theme.Size.minTarget)
            .contentShape(Rectangle())
    }
}

/// A whole row that opens something. Pressing it lifts it onto the raised slate, which is
/// the feedback a plain-styled button otherwise doesn't give.
struct RowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .contentShape(Rectangle())
            .background(configuration.isPressed ? Theme.raised : Color.clear)
    }
}

/// Shared by the two full-width styles. A view rather than a function so it can read
/// `isEnabled` from the environment.
private struct StyledBody: View {
    let configuration: ButtonStyleConfiguration
    let fill: Color
    let foreground: Color
    let weight: Font.Weight

    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        configuration.label
            .font(.body.weight(weight))
            .foregroundStyle(foreground)
            .multilineTextAlignment(.center)
            .padding(.horizontal, Theme.Space.l)
            .padding(.vertical, Theme.Space.m)
            .frame(maxWidth: .infinity, minHeight: Theme.Size.minTarget)
            .background(fill, in: RoundedRectangle(cornerRadius: Theme.Radius.control))
            // Disabled drops the whole control, text and fill together; a dimmed fill under
            // full-strength text reads as a different colour, not as "not yet".
            .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.4)
            .contentShape(Rectangle())
    }
}

extension ButtonStyle where Self == PrimaryButtonStyle {
    static var primary: PrimaryButtonStyle { PrimaryButtonStyle() }
    static func primary(fill: Color, foreground: Color = .white) -> PrimaryButtonStyle {
        PrimaryButtonStyle(fill: fill, foreground: foreground)
    }
}

extension ButtonStyle where Self == SecondaryButtonStyle {
    static var secondary: SecondaryButtonStyle { SecondaryButtonStyle() }
}

extension ButtonStyle where Self == InlineActionButtonStyle {
    static var inlineAction: InlineActionButtonStyle { InlineActionButtonStyle() }
    static func inlineAction(tint: Color) -> InlineActionButtonStyle {
        InlineActionButtonStyle(tint: tint)
    }
}

extension ButtonStyle where Self == RowButtonStyle {
    static var row: RowButtonStyle { RowButtonStyle() }
}
