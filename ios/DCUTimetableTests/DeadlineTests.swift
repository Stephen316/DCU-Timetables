import Foundation
import Testing
@testable import DCUTimetable

struct DeadlineTests {

    private func deadline(_ title: String, inDays days: Int, id: String = UUID().uuidString) -> Deadline {
        Deadline(id: id, moduleKey: "EEG1001", title: title,
                 due: Calendar.current.date(byAdding: .day, value: days, to: Date())!,
                 submitterID: "someone")
    }

    @Test func upcomingIsSoonestFirstAndDropsThePast() {
        let list = [deadline("Lab 3", inDays: 9), deadline("Last term's essay", inDays: -2),
                    deadline("Quiz", inDays: 1)]
        let upcoming = DeadlineRules.upcoming(list)
        #expect(upcoming.map(\.title) == ["Quiz", "Lab 3"])
    }

    /// The bug this pins: `upcoming` used to cut at the current instant while `isDue`
    /// colours the class for the whole calendar day, so an 11am hand-in kept its border on
    /// the timetable at 11:01 but had already vanished from the class page.
    @Test func upcomingKeepsTodaysDeadlinesForTheWholeDay() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Dublin")!
        let now = DateComponents(calendar: calendar, year: 2026, month: 9, day: 17, hour: 14).date!
        let thisMorning = DateComponents(calendar: calendar, year: 2026, month: 9, day: 17, hour: 11).date!
        let lastNight = DateComponents(calendar: calendar, year: 2026, month: 9, day: 16, hour: 23).date!

        let list = [
            Deadline(moduleKey: "EEG1001", title: "Handed in this morning",
                     due: thisMorning, submitterID: "someone"),
            Deadline(moduleKey: "EEG1001", title: "Yesterday", due: lastNight, submitterID: "someone"),
        ]
        let upcoming = DeadlineRules.upcoming(list, now: now, calendar: calendar)
        #expect(upcoming.map(\.title) == ["Handed in this morning"])
    }

    @Test func rejectsEmptyTitlesAndPastDates() {
        let future = Date().addingTimeInterval(3600)
        #expect(DeadlineRules.isValid(title: "Assignment 1", due: future))
        #expect(!DeadlineRules.isValid(title: "   ", due: future))
        #expect(!DeadlineRules.isValid(title: "Assignment 1", due: Date().addingTimeInterval(-60)))
    }

    @Test func countdownReadsTheWayStudentsThink() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Dublin")!
        let now = DateComponents(calendar: calendar, year: 2026, month: 9, day: 17, hour: 10).date!
        func due(day: Int, hour: Int = 17) -> Date {
            DateComponents(calendar: calendar, year: 2026, month: 9, day: day, hour: hour).date!
        }
        #expect(DeadlineRules.countdown(to: due(day: 17), from: now, calendar: calendar) == "today")
        #expect(DeadlineRules.countdown(to: due(day: 18), from: now, calendar: calendar) == "tomorrow")
        #expect(DeadlineRules.countdown(to: due(day: 24), from: now, calendar: calendar) == "in 7 days")
        // 9am on the due day is still "today", not "overdue" — the cutoff is the calendar day.
        #expect(DeadlineRules.countdown(to: due(day: 17, hour: 9), from: now, calendar: calendar) == "today")
        #expect(DeadlineRules.countdown(to: due(day: 16), from: now, calendar: calendar) == "overdue")
    }

    /// Deadlines are a module noticeboard: every class in the module shares one board.
    @Test func everyClassInAModuleSharesOneBoard() {
        func event(_ code: String) -> TimetableEvent {
            TimetableEvent(id: code, start: Date(), end: Date(), type: .onCampus, locations: [],
                           moduleName: nil, staff: [], activity: ActivityCode(code), weekLabels: [])
        }
        let lecture = event("EEG1001[1]L1/01")
        let lab = event("EEG1001[1]P2/03")
        #expect(DeadlineRules.moduleKey(for: lecture) == DeadlineRules.moduleKey(for: lab))
    }
}

struct DeadlineConfirmationTests {

    private func confirmations(_ pairs: [(String, String)]) -> [DeadlineConfirmation] {
        pairs.map { DeadlineConfirmation(deadlineID: $0.0, confirmerID: $0.1) }
    }

    @Test func confirmedOnceEnoughPeopleVouch() {
        let list = confirmations([("d1", "a"), ("d1", "b"), ("d1", "c"), ("d2", "a")])
        let standings = DeadlineRules.standings(from: list, confirmerID: "a")

        #expect(standings["d1"]?.confirmCount == 3)
        #expect(standings["d1"]?.isConfirmed == true)
        #expect(standings["d1"]?.confirmedByMe == true)

        // One person — the submitter — is not agreement.
        #expect(standings["d2"]?.confirmCount == 1)
        #expect(standings["d2"]?.isConfirmed == false)
    }

    @Test func oneStudentCannotConfirmTwice() {
        let list = confirmations([("d1", "a"), ("d1", "a"), ("d1", "a")])
        #expect(DeadlineRules.standings(from: list, confirmerID: "a")["d1"]?.confirmCount == 1)
    }

    /// The count is always the real number; 3 only decides whether it reads as confirmed.
    @Test func wordingCountsEveryoneAndKeepsGoingPastTheThreshold() {
        func standing(_ count: Int) -> DeadlineStanding {
            DeadlineStanding(confirmCount: count, confirmedByMe: false)
        }
        #expect(standing(0).summary == "Nobody has confirmed this yet")
        #expect(standing(1).summary == "1 person has confirmed")
        #expect(standing(2).summary == "2 people have confirmed")
        #expect(standing(3).summary == "3 people have confirmed")
        #expect(standing(11).summary == "11 people have confirmed")

        #expect(!standing(2).isConfirmed)
        #expect(standing(3).isConfirmed)
        #expect(standing(11).isConfirmed)
    }

    @Test func anUnknownDeadlineHasNoStanding() {
        #expect(DeadlineRules.standings(from: [], confirmerID: "a")["d1"] == nil)
    }
}

struct AuthSessionTests {

    private let json: [String: Any] = [
        "access_token": "access-123",
        "refresh_token": "refresh-456",
        "expires_in": 3600.0,
        "user": ["id": "user-789"],
    ]

    @Test func readsTokensAndExpiry() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        let session = AuthSessionParser.session(from: json, now: now)
        #expect(session?.accessToken == "access-123")
        #expect(session?.refreshToken == "refresh-456")
        #expect(session?.userID == "user-789")
        #expect(session?.expiresAt == now.addingTimeInterval(3600))
    }

    @Test func prefersAnAbsoluteExpiryWhenGiven() {
        var withAbsolute = json
        withAbsolute["expires_at"] = 2_000_000.0
        let session = AuthSessionParser.session(from: withAbsolute, now: Date(timeIntervalSince1970: 1_000_000))
        #expect(session?.expiresAt == Date(timeIntervalSince1970: 2_000_000))
    }

    /// A signup that only confirms the address carries no tokens — that must read as "no
    /// session", not as a half-built one.
    @Test func noSessionWithoutTokens() {
        #expect(AuthSessionParser.session(from: ["user": ["id": "user-789"]]) == nil)
        #expect(AuthSessionParser.session(from: ["access_token": "a", "refresh_token": "b"]) == nil)
    }

    /// Expiry is treated as a minute early so a token can't die mid-request.
    @Test func tokensAboutToExpireCountAsExpired() {
        let now = Date()
        func session(expiringIn seconds: TimeInterval) -> AuthSession {
            AuthSession(accessToken: "a", refreshToken: "b",
                        expiresAt: now.addingTimeInterval(seconds), userID: "u")
        }
        #expect(session(expiringIn: 300).isValid(at: now))
        #expect(!session(expiringIn: 30).isValid(at: now))
        #expect(!session(expiringIn: -10).isValid(at: now))
    }
}

struct AttendanceTests {

    @Test func togglingAddsThenRemoves() {
        let key = "EEG1001|2026-09-17T09:00:00Z"
        let once = Attendance.toggling(key, in: [])
        #expect(once == [key])
        #expect(Attendance.toggling(key, in: once).isEmpty)
    }

    @Test func survivesARoundTripThroughStorage() {
        let keys: Set<String> = ["a", "b"]
        #expect(Attendance.decode(Attendance.encode(keys)) == keys)
        // An empty or corrupt blob must read as "nothing skipped", never crash.
        #expect(Attendance.decode(Data()).isEmpty)
    }
}

struct LecturerTests {

    @Test func readsSurnameFirstNamesTheWayPeopleDo() {
        #expect(Lecturer(name: "Harcourt, Stephen").displayName == "Stephen Harcourt")
        #expect(Lecturer(name: "Stephen Harcourt").displayName == "Stephen Harcourt")
    }

    @Test func initialsUseFirstAndLastName() {
        #expect(Lecturer(name: "Harcourt, Stephen").initials == "SH")
        #expect(Lecturer(name: "Ó Briain, Seán").initials == "SB")
        #expect(Lecturer(name: "Cher").initials == "C")
        #expect(Lecturer(name: "").initials == "?")
    }

    /// No bundled directory is the normal case, and it must degrade to initials rather
    /// than inventing a photo URL from a name.
    @Test func withoutADirectoryThereIsNoPhoto() {
        let lecturer = LecturerDirectory.lecturer(named: "Harcourt, Stephen")
        #expect(lecturer.photoURL == nil)
        #expect(lecturer.initials == "SH")
    }
}
