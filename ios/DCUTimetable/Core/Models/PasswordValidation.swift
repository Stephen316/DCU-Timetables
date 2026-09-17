import Foundation

/// Password rules for creating an account.
///
/// Kept out of the view so they can be tested directly — the fields themselves are hard to
/// drive in the Simulator because iOS AutoFill intercepts a new-password field.
public enum PasswordValidation {
    public static let minimumLength = 8

    public enum Problem: Equatable {
        case tooShort
        case mismatch

        public var message: String {
            switch self {
            case .tooShort: return "Use at least \(PasswordValidation.minimumLength) characters"
            case .mismatch: return "Passwords don't match"
            }
        }
    }

    /// What (if anything) to tell the student right now. Nothing is reported until they've
    /// actually typed, so the form doesn't nag while it's still empty.
    public static func problem(password: String, confirmation: String) -> Problem? {
        if !confirmation.isEmpty, password != confirmation { return .mismatch }
        if !password.isEmpty, password.count < minimumLength { return .tooShort }
        return nil
    }

    public static func canCreateAccount(password: String, confirmation: String) -> Bool {
        password.count >= minimumLength && password == confirmation
    }
}
