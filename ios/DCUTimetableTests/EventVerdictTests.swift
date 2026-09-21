import Testing
import Foundation
@testable import DCUTimetable

@Suite("Verdict precedence")
struct VerdictPrecedenceTests {

    private func reports(_ n: Int, key: String = "K") -> [CancellationReport] {
        (0..<n).map { CancellationReport(eventKey: key, reporterID: "reporter-\($0)") }
    }

    @Test("With no verdict, the crowd still decides at the threshold")
    func crowdDecidesWithoutAVerdict() {
        let status = CancellationRules.status(forKey: "K",
                                              reports: reports(CancellationRules.threshold),
                                              reporterID: "me")
        #expect(status.isFlagged)
        #expect(!status.isDecided)
    }

    @Test("A cancelled verdict flags a class nobody reported")
    func verdictFlagsAloneWithNoReports() {
        let verdict = EventVerdict(eventKey: "K", state: .cancelled)
        let status = CancellationRules.status(forKey: "K", reports: [],
                                              reporterID: "me", verdict: verdict)
        #expect(status.isFlagged)
        #expect(status.isDecided)
        #expect(status.reportCount == 0)
    }

    /// The whole point of a `running` verdict: clearing a false flag without hunting down
    /// and deleting other people's reports. If the crowd could outvote it, it would be
    /// useless — so this holds at ten times the threshold.
    @Test("A running verdict beats any number of reports")
    func runningBeatsTheCrowd() {
        let verdict = EventVerdict(eventKey: "K", state: .running)
        let status = CancellationRules.status(forKey: "K",
                                              reports: reports(CancellationRules.threshold * 10),
                                              reporterID: "me", verdict: verdict)
        #expect(!status.isFlagged)
        #expect(status.isDecided)
    }

    @Test("Moved is not cancelled")
    func movedIsNotCancelled() {
        let verdict = EventVerdict(eventKey: "K", state: .moved, roomOverride: "Q119")
        let status = CancellationRules.status(forKey: "K", reports: [],
                                              reporterID: "me", verdict: verdict)
        #expect(!status.isFlagged)
        #expect(status.isMoved)
    }

    /// Losing the tally is a degraded view. Losing "this lecture is off" is a wasted
    /// journey across campus, so the count is shown beneath the verdict, not instead of it.
    @Test("The crowd count survives underneath a verdict")
    func crowdShownBeneathVerdict() {
        let verdict = EventVerdict(eventKey: "K", state: .cancelled)
        let status = CancellationRules.status(forKey: "K", reports: reports(4),
                                              reporterID: "me", verdict: verdict)
        #expect(status.reportCount == 4)
        #expect(status.crowdSummary == "4 people had reported this as off")
    }

    @Test("No crowd line when nobody reported")
    func noCrowdLineWhenNobodyReported() {
        let verdict = EventVerdict(eventKey: "K", state: .cancelled)
        let status = CancellationRules.status(forKey: "K", reports: [],
                                              reporterID: "me", verdict: verdict)
        #expect(status.crowdSummary == nil)
    }
}

@Suite("Verdicts across a week")
struct VerdictBatchTests {

    /// A verdict on a class nobody reported has no crowd row to decorate, so a version
    /// that only walked the reports would drop it silently — the class would look normal.
    @Test("A verdict appears even with no reports anywhere")
    func verdictSurvivesWithNoReports() {
        let statuses = CancellationRules.statuses(
            from: [],
            reporterID: "me",
            verdicts: [EventVerdict(eventKey: "QUIET", state: .cancelled)])
        #expect(statuses["QUIET"]?.isFlagged == true)
    }

    @Test("Verdicts and reports merge per class")
    func verdictsAndReportsMerge() {
        let reports = [
            CancellationReport(eventKey: "A", reporterID: "r1"),
            CancellationReport(eventKey: "A", reporterID: "r2"),
            CancellationReport(eventKey: "B", reporterID: "r1"),
        ]
        let statuses = CancellationRules.statuses(
            from: reports,
            reporterID: "r1",
            verdicts: [EventVerdict(eventKey: "A", state: .running)])

        #expect(statuses["A"]?.reportCount == 2)
        #expect(statuses["A"]?.isDecided == true)
        #expect(statuses["A"]?.isFlagged == false)
        #expect(statuses["B"]?.isDecided == false)
        #expect(statuses["B"]?.reportedByMe == true)
    }

    /// Two rows for one key shouldn't be possible — `event_key` is the primary key — but
    /// `Dictionary(uniqueKeysWithValues:)` would *trap* if it ever were, taking the app
    /// down over a duplicate row. Keeping the first is the boring, survivable answer.
    @Test("Duplicate verdicts for one key don't crash")
    func duplicateVerdictsSurvive() {
        let statuses = CancellationRules.statuses(
            from: [],
            reporterID: "me",
            verdicts: [EventVerdict(eventKey: "A", state: .cancelled),
                       EventVerdict(eventKey: "A", state: .running)])
        #expect(statuses["A"] != nil)
    }
}

@Suite("Verdict wording")
struct VerdictWordingTests {

    @Test("An unattributed verdict still reads as coming from a person")
    func unattributedHasASource() {
        #expect(EventVerdict(eventKey: "K", state: .cancelled).source == "an organiser")
        #expect(EventVerdict(eventKey: "K", state: .cancelled,
                             decidedByLabel: "   ").source == "an organiser")
    }

    @Test("A label is used when there is one")
    func labelIsUsed() {
        let verdict = EventVerdict(eventKey: "K", state: .cancelled,
                                   decidedByLabel: "the class rep")
        #expect(verdict.headline == "Confirmed off by the class rep")
    }

    /// The summary must change shape when a verdict lands, not just its number — a student
    /// reading "3 people say this isn't on" under a confirmed cancellation would weigh it
    /// as a guess.
    @Test("A verdict replaces the tally in the summary")
    func verdictReplacesTally() {
        let plain = CancellationStatus(reportCount: 3, reportedByMe: false)
        let decided = CancellationStatus(reportCount: 3, reportedByMe: false,
                                         verdict: EventVerdict(eventKey: "K", state: .cancelled))
        #expect(plain.summary == "3 people say this isn't on")
        #expect(decided.summary == "Confirmed off by an organiser")
    }
}

@Suite("Verdict in the week outline")
struct VerdictHighlightTests {

    private func event() -> TimetableEvent {
        var comps = DateComponents(year: 2026, month: 9, day: 21, hour: 12)
        comps.timeZone = TimeZone(secondsFromGMT: 0)
        let start = Calendar(identifier: .gregorian).date(from: comps)!
        return TimetableEvent(id: UUID().uuidString, start: start,
                              end: start.addingTimeInterval(3600), type: .onCampus,
                              locations: [], moduleName: "Materials Engineering", staff: [],
                              activity: ActivityCode("EEG1006[1]SY/L1/01"), weekLabels: [])
    }

    /// The bug this pins was caught in the simulator, not by a unit test: a verdict with
    /// no reports behind it rendered as "Reported not on · 0 people" — which reads as
    /// *nobody* thinks it's off, the exact opposite of a confirmed cancellation.
    @Test("A verdict never renders as a crowd count")
    func verdictDoesNotRenderAsCrowdCount() {
        let status = CancellationStatus(
            reportCount: 0, reportedByMe: false,
            verdict: EventVerdict(eventKey: "K", state: .cancelled))
        let highlight = DeadlineRules.highlight(for: event(), deadlines: [], cancellation: status)

        #expect(highlight?.reason == "Not on · confirmed by an organiser")
        #expect(highlight?.reason.contains("0 people") == false)
    }

    @Test("Without a verdict the crowd wording is kept")
    func crowdWordingKeptWithoutAVerdict() {
        let status = CancellationStatus(reportCount: 3, reportedByMe: false)
        let highlight = DeadlineRules.highlight(for: event(), deadlines: [], cancellation: status)
        #expect(highlight?.reason == "Reported not on · 3 people")
    }

    /// A moved class is still on, so it never reaches the cancelled branch — without its
    /// own case it would show no outline at all and a student would go to the old room.
    @Test("A moved class is outlined in its own right")
    func movedClassIsOutlined() {
        let status = CancellationStatus(
            reportCount: 0, reportedByMe: false,
            verdict: EventVerdict(eventKey: "K", state: .moved, decidedByLabel: "the class rep"))
        let highlight = DeadlineRules.highlight(for: event(), deadlines: [], cancellation: status)
        #expect(highlight?.reason == "Moved · the class rep")
    }
}
