import Foundation
import Testing
@testable import DCUTimetable

struct DCUEmailTests {

    @Test func derivesTheNameFromTheAddress() {
        let email = DCUEmail("stephen.harcourt2@mail.dcu.ie")
        #expect(email?.displayName == "Stephen Harcourt")   // dot split, trailing 2 dropped
        #expect(email?.givenName == "Stephen")
        #expect(email?.familyName == "Harcourt")
        #expect(email?.nameParts == ["stephen", "harcourt"])
    }

    @Test func acceptsBothDCUDomainsAndIgnoresCaseAndSpacing() {
        #expect(DCUEmail("  Stephen.Harcourt@DCU.ie ")?.displayName == "Stephen Harcourt")
        #expect(DCUEmail("stephen.harcourt@mail.dcu.ie")?.displayName == "Stephen Harcourt")
    }

    @Test func rejectsNonDCUAndLookalikeDomains() {
        #expect(DCUEmail("stephen.harcourt@gmail.com") == nil)
        #expect(DCUEmail("stephen.harcourt@dcu.ie.attacker.com") == nil)  // suffix trick
        #expect(DCUEmail("stephen.harcourt@notdcu.ie") == nil)
        #expect(DCUEmail("stephen.harcourt@student.dcu.ie") == nil)       // not an allowed domain
        #expect(DCUEmail("nodomain") == nil)
        #expect(DCUEmail("@dcu.ie") == nil)
    }

    @Test func handlesNamesWithoutADotOrWithExtraParts() {
        // No dot: the whole local part is the one name we have.
        #expect(DCUEmail("harcourt3@dcu.ie")?.displayName == "Harcourt")
        // Middle names keep their order; the last part is the surname.
        let long = DCUEmail("mary.anne.smith2@dcu.ie")
        #expect(long?.displayName == "Mary Anne Smith")
        #expect(long?.givenName == "Mary")
        #expect(long?.familyName == "Smith")
    }

    @Test func stripsOnlyTrailingDigits() {
        // A digit inside a name part shouldn't swallow the rest of it.
        #expect(DCUEmail("s3an.murphy12@dcu.ie")?.nameParts == ["s3an", "murphy"])
    }
}
