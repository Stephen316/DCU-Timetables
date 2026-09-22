import Foundation

/// Password rules for creating an account.
///
/// Kept out of the view so they can be tested directly — the fields themselves are hard to
/// drive in the Simulator because iOS AutoFill intercepts a new-password field.
public enum PasswordValidation {
    public static let minimumLength = 8

    /// The rules in one line, for the form to show before anything has been typed.
    public static let requirements =
        "At least \(minimumLength) characters, with a capital, a lower-case letter and a number"

    public enum Problem: Equatable {
        case tooShort
        case needsCapital
        case needsLowercase
        case needsNumber
        case mismatch

        public var message: String {
            switch self {
            case .tooShort:       return "Use at least \(PasswordValidation.minimumLength) characters"
            case .needsCapital:   return "Add a capital letter"
            case .needsLowercase: return "Add a lower-case letter"
            case .needsNumber:    return "Add a number"
            case .mismatch:       return "Passwords don't match"
            }
        }
    }

    /// What (if anything) to tell the student right now. Nothing is reported until they've
    /// actually typed, so the form doesn't nag while it's still empty.
    ///
    /// One problem at a time, in the order the rules are easiest to act on: a mismatch first
    /// (it means one of the two boxes has a typo, and reporting a composition rule instead
    /// would send them off fixing the wrong thing), then length, then the character rules.
    public static func problem(password: String, confirmation: String) -> Problem? {
        if !confirmation.isEmpty, password != confirmation { return .mismatch }
        guard !password.isEmpty else { return nil }
        return compositionProblem(in: password)
    }

    public static func canCreateAccount(password: String, confirmation: String) -> Bool {
        password == confirmation && compositionProblem(in: password) == nil
    }

    /// The rules that look at the password on its own, ignoring the confirmation box.
    ///
    /// Three required classes, one of each. Symbols are still allowed anywhere — they just
    /// no longer stand in for a digit, which is what the old rule let them do.
    ///
    /// `isNumber` is deliberately the lenient test here, and it accepts "٣" and "Ⅳ" as
    /// numbers. `PublicIdentifier` insists on ASCII digits because that string is read
    /// aloud and retyped by someone else; a password is typed by the person who chose it,
    /// on their own keyboard, so refusing the digits their keyboard produces would be a
    /// rule with nothing behind it.
    private static func compositionProblem(in password: String) -> Problem? {
        if password.count < minimumLength { return .tooShort }
        if !password.contains(where: \.isUppercase) { return .needsCapital }
        if !password.contains(where: \.isLowercase) { return .needsLowercase }
        if !password.contains(where: \.isNumber) { return .needsNumber }
        return nil
    }
}
