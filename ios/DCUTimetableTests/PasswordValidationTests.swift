import Testing
@testable import DCUTimetable

struct PasswordValidationTests {

    @Test func saysNothingUntilSomethingIsTyped() {
        #expect(PasswordValidation.problem(password: "", confirmation: "") == nil)
    }

    @Test func mismatchIsReportedOnceTheConfirmationIsStarted() {
        #expect(PasswordValidation.problem(password: "correcthorse1", confirmation: "d") == .mismatch)
        #expect(PasswordValidation.problem(password: "correcthorse1", confirmation: "different2") == .mismatch)
        #expect(PasswordValidation.problem(password: "correcthorse1", confirmation: "correcthorse1") == nil)
    }

    @Test func mismatchOutranksLengthSoTheTypoIsSurfacedFirst() {
        // Both wrong: telling them "too short" would hide the fact the two boxes differ.
        #expect(PasswordValidation.problem(password: "abc", confirmation: "abd") == .mismatch)
    }

    @Test func tooShortIsReportedWhileTypingTheFirstBox() {
        #expect(PasswordValidation.problem(password: "abc", confirmation: "") == .tooShort)
        #expect(PasswordValidation.problem(password: "longenough1", confirmation: "") == nil)
    }

    @Test func accountCreationNeedsBothLengthAndMatch() {
        #expect(PasswordValidation.canCreateAccount(password: "correcthorse1", confirmation: "correcthorse1"))
        #expect(PasswordValidation.canCreateAccount(password: "short1", confirmation: "short1") == false)
        #expect(PasswordValidation.canCreateAccount(password: "correcthorse1", confirmation: "different2") == false)
        #expect(PasswordValidation.canCreateAccount(password: "", confirmation: "") == false)
    }
}
