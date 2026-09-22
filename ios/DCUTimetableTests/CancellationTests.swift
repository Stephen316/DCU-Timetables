import Foundation
import Testing
@testable import DCUTimetable

struct CancellationTests {

    private func event(_ code: String, startHour: Int) -> TimetableEvent {
        var comps = DateComponents(year: 2026, month: 9, day: 16, hour: startHour)
        comps.timeZone = TimeZone(secondsFromGMT: 0)
        let start = Calendar(identifier: .gregorian).date(from: comps)!
        return TimetableEvent(id: UUID().uuidString, start: start,
                              end: start.addingTimeInterval(3600), type: .onCampus,
                              locations: [], moduleName: nil, staff: [],
                              activity: ActivityCode(code), weekLabels: [])
    }

    @Test func eventKeyIsStableAcrossDevicesButUniquePerOccurrence() {
        let nine = event("EEG1006[1]OC/L1/01", startHour: 9)
        let sameAgain = event("EEG1006[1]OC/L1/01", startHour: 9)
        let later = event("EEG1006[1]OC/L1/01", startHour: 11)

        // Same class, same slot → same bucket even though the event ids differ.
        #expect(CancellationRules.eventKey(for: nine) == CancellationRules.eventKey(for: sameAgain))
        // A different slot of the same module must not share the bucket.
        #expect(CancellationRules.eventKey(for: nine) != CancellationRules.eventKey(for: later))
    }

    @Test func flagsOnlyAtTheThreshold() {
        let key = "k"
        func reports(_ ids: [String]) -> [CancellationReport] {
            ids.map { CancellationReport(eventKey: key, reporterID: $0) }
        }
        #expect(CancellationRules.status(forKey: key, reports: reports(["a", "b"]), reporterID: "z").isFlagged == false)
        #expect(CancellationRules.status(forKey: key, reports: reports(["a", "b", "c"]), reporterID: "z").isFlagged)
    }

    @Test func oneDeviceCannotFlagAClassAlone() {
        let key = "k"
        // Same reporter submitting repeatedly must count once.
        let spam = (0..<5).map { _ in CancellationReport(eventKey: key, reporterID: "me") }
        let status = CancellationRules.status(forKey: key, reports: spam, reporterID: "me")
        #expect(status.reportCount == 1)
        #expect(status.isFlagged == false)
        #expect(status.reportedByMe)
    }

    @Test func reportsForOtherClassesDoNotLeak() {
        let reports = [
            CancellationReport(eventKey: "a", reporterID: "1"),
            CancellationReport(eventKey: "a", reporterID: "2"),
            CancellationReport(eventKey: "b", reporterID: "3"),
        ]
        let all = CancellationRules.statuses(from: reports, reporterID: "1")
        #expect(all["a"]?.reportCount == 2)
        #expect(all["a"]?.reportedByMe == true)
        #expect(all["b"]?.reportCount == 1)
        #expect(all["b"]?.reportedByMe == false)
    }

    /// Counts are stated in full, never "x of 3" — the threshold decides whether a class is
    /// flagged, not how many people are worth mentioning.
    @Test func summaryNeverCapsTheCount() {
        #expect(CancellationStatus(reportCount: 0).summary
                == "Nobody has reported this class as cancelled")
        #expect(CancellationStatus(reportCount: 1, myStance: .cancelled).summary
                == "1 person says this is cancelled")
        #expect(CancellationStatus(reportCount: 2).summary
                == "2 people say this is cancelled")
        #expect(CancellationStatus(reportCount: 11).summary
                == "11 people say this is cancelled")
    }
}

/// The counter-report: a student saying a class they were told was cancelled actually ran.
struct ReportStanceTests {

    /// Two bars, and both have to clear: three people must say cancelled, and they must
    /// still be two ahead once the people who walked into the lecture are subtracted.
    @Test func flaggingNeedsThreeReportsAndANetOfTwo() {
        // 3–0: the plain case.
        #expect(CancellationStatus(reportCount: 3).isFlagged)
        // 3–1: one answered, two still clear — the class stays flagged.
        #expect(CancellationStatus(reportCount: 3, onCount: 1).isFlagged)
        // 3–2: down to one clear, so it isn't.
        #expect(CancellationStatus(reportCount: 3, onCount: 2).isFlagged == false)
        // 4–2: back to two clear.
        #expect(CancellationStatus(reportCount: 4, onCount: 2).isFlagged)
        // 5–4: a big crowd that mostly disagrees with itself is not evidence.
        #expect(CancellationStatus(reportCount: 5, onCount: 4).isFlagged == false)
    }

    /// The evidence bar is never netted. If it were, two people reporting cancelled and
    /// nobody contradicting them would somehow be enough — a contradiction would make the
    /// class *easier* to flag by shrinking the crowd needed.
    @Test func twoReportsNeverFlagHoweverUncontradicted() {
        #expect(CancellationStatus(reportCount: 2).isFlagged == false)
        #expect(CancellationStatus(reportCount: 2, onCount: 0).netReports == 2)
    }

    @Test func theNetNeverGoesBelowZero() {
        // More contradictions than reports is not negative evidence of anything.
        #expect(CancellationStatus(reportCount: 1, onCount: 4).netReports == 0)
    }

    @Test func aVerdictStillOutranksBothSides() {
        let cancelled = EventVerdict(eventKey: "k", state: .cancelled)
        // Ten people insisting it ran does not overturn a stated cancellation, and neither
        // does failing the three-report bar the crowd would have had to clear.
        #expect(CancellationStatus(reportCount: 0, onCount: 10, verdict: cancelled).isFlagged)

        let running = EventVerdict(eventKey: "k", state: .running)
        #expect(CancellationStatus(reportCount: 9, verdict: running).isFlagged == false)
    }

    @Test func reportedByMeMeansCancelledSpecifically() {
        #expect(CancellationStatus(reportCount: 1, myStance: .cancelled).reportedByMe)
        // Saying a class went ahead is not reporting it cancelled.
        #expect(CancellationStatus(reportCount: 1, onCount: 1, myStance: .on).reportedByMe == false)
        #expect(CancellationStatus(reportCount: 1).reportedByMe == false)
    }

    @Test func statusesSplitTheTwoSides() {
        let reports = [
            CancellationReport(eventKey: "a", reporterID: "1", stance: .cancelled),
            CancellationReport(eventKey: "a", reporterID: "2", stance: .cancelled),
            CancellationReport(eventKey: "a", reporterID: "3", stance: .on),
        ]
        let status = CancellationRules.statuses(from: reports, reporterID: "3")["a"]
        #expect(status?.reportCount == 2)
        #expect(status?.onCount == 1)
        #expect(status?.myStance == .on)
    }

    /// Switching sides is a delete then an insert, but a device holding both rows (a failed
    /// delete, say) must still count once — on whichever it claimed last.
    @Test func onePersonCountsOnceEvenHoldingBothRows() {
        let earlier = Date(timeIntervalSince1970: 100)
        let reports = [
            CancellationReport(eventKey: "a", reporterID: "me", stance: .cancelled, reportedAt: earlier),
            CancellationReport(eventKey: "a", reporterID: "me", stance: .on,
                               reportedAt: earlier.addingTimeInterval(60)),
        ]
        let status = CancellationRules.statuses(from: reports, reporterID: "me")["a"]
        #expect(status?.reportCount == 0)
        #expect(status?.onCount == 1)
        #expect(status?.myStance == .on)
    }

    /// A stance-less row on disk is a pre-migration cancellation report, not a decode
    /// failure — one of those would empty the whole local file.
    @Test func legacyRowsDecodeAsCancellations() throws {
        let json = Data("""
        [{"eventKey":"a","reporterID":"me","reportedAt":0}]
        """.utf8)
        let decoded = try JSONDecoder().decode([CancellationReport].self, from: json)
        #expect(decoded.first?.stance == .cancelled)
    }
}

/// The orange banner at the top of a lecture page.
struct ReportBannerTests {

    @Test func yourOwnReportIsStatedBack() {
        #expect(CancellationStatus(reportCount: 1, myStance: .cancelled).myReportLine
                == "You reported cancelled")
        #expect(CancellationStatus(reportCount: 1, onCount: 1, myStance: .on).myReportLine
                == "You reported this class went ahead")
        #expect(CancellationStatus(reportCount: 4).myReportLine == nil)
    }

    /// The count excludes the reader. "3 people have reported cancelled" when one of them
    /// is you reads as three strangers agreeing, which overstates the evidence by one.
    @Test func othersExcludesYou() {
        #expect(CancellationStatus(reportCount: 4, myStance: .cancelled).othersLine
                == "3 others have reported cancelled")
        #expect(CancellationStatus(reportCount: 2, myStance: .cancelled).othersLine
                == "1 other has reported cancelled")
        // Your report is the only one: there are no others to mention.
        #expect(CancellationStatus(reportCount: 1, myStance: .cancelled).othersLine == nil)
    }

    @Test func othersCountsEveryoneWhenYouHaventVoted() {
        #expect(CancellationStatus(reportCount: 3).othersLine == "3 people have reported cancelled")
        #expect(CancellationStatus(reportCount: 1).othersLine == "1 person has reported cancelled")
        #expect(CancellationStatus(reportCount: 0).othersLine == nil)
    }

    @Test func aDisputeIsOnlyWorthSayingWhenThereIsOneToDispute() {
        #expect(CancellationStatus(reportCount: 2, onCount: 1).disputedLine
                == "1 person says it went ahead")
        #expect(CancellationStatus(reportCount: 2, onCount: 3).disputedLine
                == "3 people say it went ahead")
        // Nobody claimed it was cancelled, so there is nothing being contradicted.
        #expect(CancellationStatus(reportCount: 0, onCount: 2).disputedLine == nil)
    }
}
