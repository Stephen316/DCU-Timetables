import Testing
import Foundation
@testable import DCUTimetable

@Suite("Account roles")
struct AccountRoleTests {

    @Test("A plain student decides nothing")
    func studentHasNoPowers() {
        let profile = AccountProfile(id: "u1", role: .student)
        #expect(!profile.canDecide())
        #expect(!profile.canAdminister())
    }

    @Test("Trusted decides but does not administer")
    func trustedCannotAdminister() {
        let profile = AccountProfile(id: "u1", role: .trusted)
        #expect(profile.canDecide())
        #expect(!profile.canAdminister())
    }

    @Test("Admin does both")
    func adminDoesBoth() {
        let profile = AccountProfile(id: "u1", role: .admin)
        #expect(profile.canDecide())
        #expect(profile.canAdminister())
    }

    /// The database enforces this too (`not is_banned()` on every insert policy), but a
    /// banned admin must not be shown the buttons either — the role survives a ban, so
    /// asking `role.canDecide` alone would let them through the UI to a wall of 403s.
    @Test("A ban outranks the role while it lasts")
    func banOutranksRole() {
        let now = Date()
        let banned = AccountProfile(id: "u1", role: .admin,
                                    bannedUntil: now.addingTimeInterval(3600))
        #expect(banned.isBanned(at: now))
        #expect(!banned.canDecide(at: now))
        #expect(!banned.canAdminister(at: now))
    }

    @Test("A ban that has run out is not a ban")
    func expiredBanIsNotABan() {
        let now = Date()
        let profile = AccountProfile(id: "u1", role: .trusted,
                                     bannedUntil: now.addingTimeInterval(-1))
        #expect(!profile.isBanned(at: now))
        #expect(profile.canDecide(at: now))
    }

    @Test("An unknown role from the server reads as student, never as more")
    func unknownRoleDegradesDownward() {
        #expect(AppRole(rawValue: "superuser") == nil)
    }
}

@Suite("Public identifier")
struct PublicIdentifierTests {

    @Test("A well-formed id passes")
    func wellFormed() {
        #expect(PublicIdentifier.isValid("K482913"))
    }

    /// I and O are excluded so they can't be confused with 1 and 0 when the id is read
    /// aloud or retyped — which is the only way it ever travels. Must match `new_pi()`.
    @Test("I and O are not in the alphabet", arguments: ["I482913", "O482913"])
    func confusableLettersRejected(_ candidate: String) {
        #expect(!PublicIdentifier.isValid(candidate))
    }

    @Test("Wrong shapes are rejected",
          arguments: ["K48291", "K4829134", "4482913", "KK82913", "", "K48291a"])
    func wrongShapesRejected(_ candidate: String) {
        #expect(!PublicIdentifier.isValid(candidate))
    }

    /// Non-ASCII digits look like digits to `isNumber` and would sail through a naive
    /// check, then fail to match any row.
    @Test("Non-ASCII digits are not digits")
    func nonASCIIDigitsRejected() {
        #expect(!PublicIdentifier.isValid("K٤٨٢٩١٣"))
    }

    @Test("Normalising accepts what people actually paste",
          arguments: ["k482913", "K-482913", "k 482 913", " K482913 "])
    func normalisationAcceptsHumanInput(_ raw: String) {
        #expect(PublicIdentifier.normalised(raw) == "K482913")
    }

    @Test("Normalising still rejects a non-identifier")
    func normalisationRejectsNonsense() {
        #expect(PublicIdentifier.normalised("hello") == nil)
    }
}
