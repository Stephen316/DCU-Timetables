import Foundation
import Testing
@testable import DCUTimetable

struct ClassHighlightTests {

    private var calendar: Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Europe/Dublin")!
        return cal
    }

    private func date(day: Int, hour: Int = 9) -> Date {
        DateComponents(calendar: calendar, timeZone: TimeZone(identifier: "Europe/Dublin"),
                       year: 2026, month: 9, day: day, hour: hour).date!
    }

    /// A lecture and a practical in the same module, on different days.
    private func event(_ activity: String, day: Int) -> TimetableEvent {
        TimetableEvent(id: activity + "\(day)", start: date(day: day), end: date(day: day, hour: 11),
                       type: .onCampus, locations: [], moduleName: nil, staff: [],
                       activity: ActivityCode(activity), weekLabels: [])
    }

    private var lecture: TimetableEvent { event("EEG1001[1]L1/01", day: 14) }     // Monday
    private var practical: TimetableEvent { event("EEG1001[1]P2/03", day: 17) }   // Thursday

    private func deadline(_ title: String, kind: DeadlineKind, day: Int,
                          at event: TimetableEvent? = nil) -> Deadline {
        Deadline(moduleKey: "EEG1001", atGroupKey: event?.groupKey, title: title,
                 due: date(day: day, hour: 17), kind: kind, submitterID: "someone")
    }

    private let quiet = CancellationStatus(reportCount: 0, reportedByMe: false)

    private func highlight(_ event: TimetableEvent, _ deadlines: [Deadline],
                           _ status: CancellationStatus? = nil) -> ClassHighlight? {
        DeadlineRules.highlight(for: event, deadlines: deadlines,
                                cancellation: status ?? quiet, calendar: calendar)
    }

    @Test func nothingDueMeansNoBorder() {
        #expect(highlight(lecture, []) == nil)
    }

    /// The whole point of "only on the exact day": Thursday's assignment must not colour
    /// Monday's lecture.
    @Test func onlyTheDayItIsDue() {
        let thursdayAssignment = [deadline("Assignment 2", kind: .assignment, day: 17)]
        #expect(highlight(practical, thursdayAssignment) == .assignment(title: "Assignment 2"))
        #expect(highlight(lecture, thursdayAssignment) == nil)
    }

    @Test func aQuizOutranksSomethingDueTheSameDay() {
        let both = [deadline("Assignment 2", kind: .assignment, day: 17),
                    deadline("Quiz 3", kind: .quiz, day: 17)]
        #expect(highlight(practical, both) == .test(title: "Quiz 3"))
    }

    @Test func anExamCountsAsSatInClass() {
        #expect(highlight(practical, [deadline("Lab exam", kind: .exam, day: 17)])
                == .test(title: "Lab exam"))
    }

    /// A class that isn't running outranks everything — turning up for a quiz that isn't on
    /// is the worst outcome of the three.
    @Test func aReportedCancellationOutranksBoth() {
        let flagged = CancellationStatus(reportCount: 4, reportedByMe: false)
        let result = highlight(practical, [deadline("Quiz 3", kind: .quiz, day: 17)], flagged)
        #expect(result == .cancelled(reportCount: 4))
        // Below the threshold it isn't a cancellation at all.
        let two = CancellationStatus(reportCount: 2, reportedByMe: false)
        #expect(highlight(practical, [deadline("Quiz 3", kind: .quiz, day: 17)], two)
                == .test(title: "Quiz 3"))
    }

    /// Pinned to the practical: the practical leads with it, the module's lecture doesn't,
    /// even if they fall on the same day.
    @Test func aPinnedDeadlineOnlyColoursItsOwnClass() {
        let sameDayLecture = event("EEG1001[1]L1/01", day: 17)
        let pinned = [deadline("Lab report 2", kind: .labReport, day: 17, at: practical)]
        #expect(highlight(practical, pinned) == .assignment(title: "Lab report 2"))
        #expect(highlight(sameDayLecture, pinned) == nil)
    }

    /// Unpinned deadlines are module-wide, so any class that day carries them.
    @Test func anUnpinnedDeadlineColoursAnyClassThatDay() {
        let sameDayLecture = event("EEG1001[1]L1/01", day: 17)
        let unpinned = [deadline("Essay", kind: .assignment, day: 17)]
        #expect(highlight(sameDayLecture, unpinned) == .assignment(title: "Essay"))
    }

    @Test func anotherModulesDeadlineIsIgnored() {
        let other = Deadline(moduleKey: "EEG1004", title: "Assignment 1",
                             due: date(day: 17, hour: 17), submitterID: "someone")
        #expect(highlight(practical, [other]) == nil)
    }

    @Test func theBannerListsOnlyWhatIsDueAtThisClass() {
        let list = [deadline("Lab report 2", kind: .labReport, day: 17, at: practical),
                    deadline("Essay", kind: .assignment, day: 20)]
        let due = DeadlineRules.due(at: practical, from: list, calendar: calendar)
        #expect(due.map(\.title) == ["Lab report 2"])
    }
}
