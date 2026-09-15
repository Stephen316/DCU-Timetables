import Testing
@testable import DCUTimetable

struct ActivityCodeTests {

    @Test func parsesFullLectureCode() {
        let a = ActivityCode("BIO1000[1]OC/L1/01 Surname A - M")
        #expect(a.moduleCode == "BIO1000")
        #expect(a.occurrence == "1")
        #expect(a.delivery == "OC")
        #expect(a.kind == .lecture)
        #expect(a.activityIndex == 1)
        #expect(a.group == "01")
        #expect(a.cohort == "Surname A - M")
    }

    @Test func parsesLabPractical() {
        let a = ActivityCode("CHM1008[1]OC/P1/01")
        #expect(a.moduleCode == "CHM1008")
        #expect(a.kind == .practical)
        #expect(a.group == "01")
        #expect(a.cohort == nil)
    }

    @Test func parsesAsynchronousDelivery() {
        let a = ActivityCode("MTH1033[1]AY/L1/01")
        #expect(a.moduleCode == "MTH1033")
        #expect(a.delivery == "AY")
        #expect(a.kind == .lecture)
        #expect(a.group == "01")
    }

    @Test func toleratesEmptyAndGarbage() {
        let empty = ActivityCode("")
        #expect(empty.kind == .other)
        #expect(empty.moduleCode == nil)

        let odd = ActivityCode("just some text")
        #expect(odd.moduleCode == "just")
        #expect(odd.cohort == "some text")
    }
}
