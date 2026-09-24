import Foundation

/// A DCU student number — a letter and eight digits, "A12345678" — in the form
/// `profiles.student_id` stores it (`supabase/phase13_roster_allocations.sql`).
public struct StudentNumber: Equatable, Sendable {
    public let value: String

    /// Read from the Code 39 barcode on a student card, which is the number printed under
    /// it: "10", the eight digits of the student number, then three more. A12345678's card
    /// reads 1012345678001.
    ///
    /// The trailing three are the same on every card seen so far, and are most likely which
    /// issue of the card it is — so a replacement card still yields the same number. The
    /// barcode has no check character, so a misread can only be caught by its shape, and
    /// anything that isn't exactly this shape is refused rather than trimmed into a
    /// plausible-looking number.
    public init?(barcode: String) {
        let code = barcode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard code.count == 13, code.hasPrefix("10"), code.allSatisfy(Self.isDigit) else { return nil }
        value = "A" + code.dropFirst(2).prefix(8)
    }

    /// Typed by hand. Case, spaces and hyphens don't matter, a missing leading letter is
    /// taken to be the usual "A", and the 13-digit number printed under the barcode is
    /// accepted too — it's the other number on the card people are likely to copy.
    public init?(typed: String) {
        let entry = typed.uppercased().filter { !$0.isWhitespace && $0 != "-" }
        if let read = StudentNumber(barcode: entry) {
            self = read
            return
        }
        let letter = entry.first.flatMap { $0.isASCII && $0.isLetter ? $0 : nil }
        let digits = letter == nil ? entry : String(entry.dropFirst())
        guard digits.count == 8, digits.allSatisfy(Self.isDigit) else { return nil }
        value = String(letter ?? "A") + digits
    }

    /// `isNumber` is true for "٣" and "Ⅳ"; a student number is ASCII digits only.
    private static func isDigit(_ character: Character) -> Bool {
        character.isASCII && character.isNumber
    }
}
