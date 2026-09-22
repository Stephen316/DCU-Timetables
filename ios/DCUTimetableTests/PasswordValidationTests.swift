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

    @Test func aLowerCaseLetterIsRequired() {
        #expect(PasswordValidation.problem(password: "SHOUTING123", confirmation: "") == .needsLowercase)
        #expect(PasswordValidation.problem(password: "SHOUTINg123", confirmation: "") == nil)
    }

    @Test func aNumberIsRequired() {
        #expect(PasswordValidation.problem(password: "Lettersonly", confirmation: "") == .needsNumber)
        #expect(PasswordValidation.problem(password: "Lettersonly1", confirmation: "") == nil)
    }

    /// A symbol used to stand in for a digit. It no longer does — still allowed anywhere,
    /// it just doesn't satisfy a rule on its own.
    @Test func aSymbolIsNoLongerASubstituteForANumber() {
        #expect(PasswordValidation.problem(password: "Lettersonly!", confirmation: "") == .needsNumber)
        #expect(PasswordValidation.problem(password: "Letters!only1", confirmation: "") == nil)
    }

    /// Reported one at a time, easiest first, so a password failing all three doesn't dump
    /// a list on someone mid-type.
    @Test func theCharacterRulesAreReportedInOrder() {
        #expect(PasswordValidation.problem(password: "aaaaaaaa", confirmation: "") == .needsCapital)
        #expect(PasswordValidation.problem(password: "AAAAAAAA", confirmation: "") == .needsLowercase)
        #expect(PasswordValidation.problem(password: "AaaaaaaA", confirmation: "") == .needsNumber)
    }

    @Test func accountCreationNeedsMatchLengthAndAllThreeClasses() {
        #expect(PasswordValidation.canCreateAccount(password: "Correcthorse1", confirmation: "Correcthorse1"))
        #expect(PasswordValidation.canCreateAccount(password: "Short1a", confirmation: "Short1a") == false)
        // One class missing each time: lower-case only, upper-case only, no digit.
        #expect(PasswordValidation.canCreateAccount(password: "correcthorse1", confirmation: "correcthorse1") == false)
        #expect(PasswordValidation.canCreateAccount(password: "CORRECTHORSE1", confirmation: "CORRECTHORSE1") == false)
        #expect(PasswordValidation.canCreateAccount(password: "Correcthorse", confirmation: "Correcthorse") == false)
        #expect(PasswordValidation.canCreateAccount(password: "Correcthorse1", confirmation: "Different2") == false)
        #expect(PasswordValidation.canCreateAccount(password: "", confirmation: "") == false)
    }
}
