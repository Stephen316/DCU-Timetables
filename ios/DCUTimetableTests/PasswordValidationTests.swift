import Testing
@testable import DCUTimetable

struct PasswordValidationTests {

    @Test func saysNothingUntilSomethingIsTyped() {
        #expect(PasswordValidation.problem(password: "", confirmation: "") == nil)
    }

    @Test func mismatchIsReportedOnceTheConfirmationIsStarted() {
        #expect(PasswordValidation.problem(password: "Correcthorse1", confirmation: "d") == .mismatch)
        #expect(PasswordValidation.problem(password: "Correcthorse1", confirmation: "Different2") == .mismatch)
        #expect(PasswordValidation.problem(password: "Correcthorse1", confirmation: "Correcthorse1") == nil)
    }

    @Test func mismatchOutranksTheOtherRulesSoTheTypoIsSurfacedFirst() {
        // Both wrong: telling them "too short" would hide the fact the two boxes differ, and
        // send them off fixing the password instead of the confirmation.
        #expect(PasswordValidation.problem(password: "abc", confirmation: "abd") == .mismatch)
    }

    @Test func tooShortIsReportedWhileTypingTheFirstBox() {
        #expect(PasswordValidation.problem(password: "Abc1", confirmation: "") == .tooShort)
        #expect(PasswordValidation.problem(password: "Longenough1", confirmation: "") == nil)
    }

    @Test func lengthIsCheckedBeforeComposition() {
        // "Ab1" breaks all three rules; length is the one worth saying first because fixing it
        // is what they're already doing.
        #expect(PasswordValidation.problem(password: "ab", confirmation: "") == .tooShort)
    }

    @Test func aCapitalIsRequired() {
        #expect(PasswordValidation.problem(password: "lowercase1", confirmation: "") == .needsCapital)
        #expect(PasswordValidation.problem(password: "Lowercase1", confirmation: "") == nil)
    }

    @Test func aNumberOrSymbolIsRequired() {
        #expect(PasswordValidation.problem(password: "Lettersonly", confirmation: "") == .needsNumberOrSymbol)
        #expect(PasswordValidation.problem(password: "Lettersonly1", confirmation: "") == nil)
        #expect(PasswordValidation.problem(password: "Lettersonly!", confirmation: "") == nil)
    }

    /// A trailing space is invisible in a `SecureField`, so accepting one as the "symbol" would
    /// create an account with a password the student can't reliably retype.
    @Test func whitespaceDoesNotCountAsASymbol() {
        #expect(PasswordValidation.problem(password: "Letters only", confirmation: "") == .needsNumberOrSymbol)
    }

    @Test func accountCreationNeedsMatchLengthAndComposition() {
        #expect(PasswordValidation.canCreateAccount(password: "Correcthorse1", confirmation: "Correcthorse1"))
        #expect(PasswordValidation.canCreateAccount(password: "Short1!", confirmation: "Short1!") == false)
        #expect(PasswordValidation.canCreateAccount(password: "correcthorse1", confirmation: "correcthorse1") == false)
        #expect(PasswordValidation.canCreateAccount(password: "Correcthorse", confirmation: "Correcthorse") == false)
        #expect(PasswordValidation.canCreateAccount(password: "Correcthorse1", confirmation: "Different2") == false)
        #expect(PasswordValidation.canCreateAccount(password: "", confirmation: "") == false)
    }
}
