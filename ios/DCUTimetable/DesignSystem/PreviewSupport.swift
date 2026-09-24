#if DEBUG
import SwiftUI

// Debug-only: fixtures for `#Preview`, and a launch switch that opens one screen with the
// same fixtures on a simulator —
//
//     xcrun simctl launch booted com.stephenh.dcutimetable -previewScreen day
//
// so a screen can be checked at every text size and on every device the simulator has,
// not only in Xcode's canvas. None of this is compiled into a release build.

/// The variants every screen is previewed in.
enum PreviewVariant {
    case light, dark, largestText

    fileprivate var scheme: ColorScheme { self == .dark ? .dark : .light }
}

extension View {
    func previewVariant(_ variant: PreviewVariant) -> some View {
        preferredColorScheme(variant.scheme)
            .dynamicTypeSize(variant == .largestText ? .accessibility5 : .large)
    }
}

/// A plausible first-year week, dated around today so "next class" and "today" have
/// something to point at whenever the preview is opened.
enum PreviewData {
    static let calendar = Calendar.current

    static var monday: Date {
        var cal = calendar
        cal.firstWeekday = 2
        return cal.dateInterval(of: .weekOfYear, for: .now)?.start ?? calendar.startOfDay(for: .now)
    }

    /// Today as a Mon–Fri offset, clamped so a weekend preview still shows a full day.
    static var todayOffset: Int {
        let days = calendar.dateComponents([.day], from: monday, to: calendar.startOfDay(for: .now)).day ?? 0
        return min(max(days, 0), 4)
    }

    static func at(day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
        let date = calendar.date(byAdding: .day, value: day, to: monday) ?? monday
        return calendar.date(bySettingHour: hour, minute: minute, second: 0, of: date) ?? date
    }

    static func event(_ id: String, _ title: String, _ activity: String,
                      start: Date, hours: Double, room: String,
                      staff: [String] = [], type: EventType = .onCampus) -> TimetableEvent {
        TimetableEvent(id: id, start: start, end: start.addingTimeInterval(hours * 3600),
                       type: type, locations: room.isEmpty ? [] : [room], moduleName: title,
                       staff: staff, activity: ActivityCode(activity), weekLabels: ["1-12"])
    }

    /// Today's shape is set relative to the clock: one class already over, the next one
    /// starting on the hour (so its highlight window is open), then a cancelled one.
    static var today: [TimetableEvent] {
        let now = Date()
        let nextHour = calendar.nextDate(after: now, matching: DateComponents(minute: 0),
                                         matchingPolicy: .nextTime) ?? now
        let earlier = nextHour.addingTimeInterval(-3 * 3600)
        return [
            event("t1", "Computer Systems", "CA106[1]OC/L1/01", start: earlier, hours: 1,
                  room: "GLA.C114", staff: ["Dr Ciara Byrne"]),
            event("t2", "Digital Innovation", "CA107[1]OC/P1/02", start: nextHour, hours: 2,
                  room: "GLA.L125", staff: ["Dr Owen Kelly", "Aoife Nolan"]),
            event("t3", "Networks", "CA218[1]OC/L1/01", start: nextHour.addingTimeInterval(3 * 3600),
                  hours: 1, room: "GLA.XG14", staff: ["Prof Martin Doyle"]),
        ]
    }

    static var week: [TimetableEvent] {
        var events: [TimetableEvent] = []
        for day in 0..<5 where day != todayOffset {
            events += [
                event("d\(day)a", "Maths for Computing", "MS121[1]OC/L1/01",
                      start: at(day: day, 9), hours: 1, room: "GLA.QG15", staff: ["Dr Emma Walsh"]),
                event("d\(day)b", "Operating Systems", "CA216[1]OC/L1/01",
                      start: at(day: day, 11), hours: 2, room: "GLA.SA101", staff: ["Dr Liam Fox"]),
                event("d\(day)c", "Programming Lab", "CA117[1]OC/P1/03",
                      start: at(day: day, 14), hours: 3, room: "GLA.L101"),
            ]
            if day == 2 {
                events.append(event("d\(day)d", "Ethics in Engineering", "EE105[1]SY/T1/01",
                                    start: at(day: day, 12), hours: 1, room: "",
                                    type: .synchronous))
            }
        }
        return events + today + nextWeek
    }

    static var nextWeek: [TimetableEvent] {
        (7..<12).flatMap { day in
            [event("n\(day)a", "Maths for Computing", "MS121[1]OC/L1/01",
                   start: at(day: day, 9), hours: 1, room: "GLA.QG15"),
             event("n\(day)b", "Operating Systems", "CA216[1]OC/L1/01",
                   start: at(day: day, 11), hours: 2, room: "GLA.SA101")]
        }
    }

    static var deadlines: [Deadline] {
        [
            Deadline(id: "dl-quiz", moduleKey: "CA106", title: "Quiz 2: memory hierarchy",
                     due: calendar.date(byAdding: .day, value: 1, to: .now) ?? .now,
                     kind: .quiz, submitterID: "someone"),
            Deadline(id: "dl-sched", moduleKey: "CA216", title: "Scheduler assignment",
                     due: calendar.date(byAdding: .day, value: 4, to: .now) ?? .now,
                     kind: .assignment, submitterID: "someone"),
            Deadline(id: "dl-sheet", moduleKey: "MS121", title: "Problem sheet 3",
                     due: calendar.date(byAdding: .day, value: 9, to: .now) ?? .now,
                     kind: .assignment, submitterID: "preview-me", isMine: true),
        ]
    }

    static let programme = TimetableCategory(identity: "preview", name: "CASE1",
                                             categoryTypeIdentity: "")

    static let user = AuthenticatedUser(id: "preview-me", address: "aoife.murphy5@mail.dcu.ie")
}

struct PreviewTimetableSource: TimetableSource {
    func searchProgrammes(query: String, page: Int) async throws -> [TimetableCategory] { [] }

    func weekCalendar() async throws -> WeekCalendar {
        let monday = PreviewData.monday
        let next = Calendar.current.date(byAdding: .day, value: 7, to: monday) ?? monday
        return WeekCalendar(weeks: [TeachingWeek(number: 5, label: "5", firstDay: monday),
                                    TeachingWeek(number: 6, label: "6", firstDay: next)],
                            days: [])
    }

    func events(for category: TimetableCategory, weeks: [TeachingWeek]) async throws -> [TimetableEvent] {
        let all = PreviewData.week
        return weeks.flatMap { week in
            let end = Calendar.current.date(byAdding: .day, value: 7, to: week.firstDay) ?? week.firstDay
            return all.filter { $0.start >= week.firstDay && $0.start < end }
        }
    }
}

/// Four reports on today's Networks lecture — enough to flag it — and nothing else.
actor PreviewCancellationStore: CancellationStore {
    func tallies(forKeys keys: [String]) async throws -> [CancellationTally] {
        guard let networks = PreviewData.today.first(where: { $0.id == "t3" }) else { return [] }
        let key = CancellationRules.eventKey(for: networks)
        return keys.contains(key) ? [CancellationTally(eventKey: key, reportCount: 4)] : []
    }
    func submit(_ report: CancellationReport) async throws {}
    func withdraw(eventKey: String, reporterID: String) async throws {}
}

actor PreviewDeadlineStore: DeadlineStore {
    func deadlines(forModule moduleKey: String) async throws -> [Deadline] {
        PreviewData.deadlines.filter { $0.moduleKey == moduleKey }
    }
    func deadlines(forModules moduleKeys: [String]) async throws -> [Deadline] {
        PreviewData.deadlines
    }
    func submit(_ deadline: Deadline) async throws {}
    func withdraw(id: String, submitterID: String) async throws {}
    func standings(forDeadlineIDs ids: [String]) async throws -> [String: DeadlineStanding] {
        guard let first = ids.first else { return [:] }
        return [first: DeadlineStanding(confirmCount: 4, confirmedByMe: true)]
    }
    func confirm(deadlineID: String, confirmerID: String) async throws {}
    func unconfirm(deadlineID: String, confirmerID: String) async throws {}
}

@MainActor
enum PreviewModels {
    static func week() -> WeekViewModel {
        WeekViewModel(programme: PreviewData.programme,
                      source: PreviewTimetableSource(),
                      cache: TimetableCache(directoryName: "PreviewCache"),
                      cancellationStore: PreviewCancellationStore(),
                      deadlineStore: PreviewDeadlineStore(),
                      verdictStore: LocalVerdictStore())
    }
}

/// The screens the launch switch can open.
enum PreviewScreen: String, CaseIterable {
    case day, week, lecture, deadlines, signIn, profile, programme, groups, labs, account, confirm

    /// `-previewScreen <name>` on the launch command line.
    static var requested: PreviewScreen? {
        UserDefaults.standard.string(forKey: "previewScreen").flatMap(PreviewScreen.init)
    }

    @MainActor @ViewBuilder
    var view: some View {
        switch self {
        case .day:
            TimetablePreviewShell(showsCalendar: false)
        case .week:
            TimetablePreviewShell(showsCalendar: true)
        case .lecture:
            NavigationStack {
                LectureDetailView(event: PreviewData.today[2], isClashing: false,
                                  knownDeadlines: PreviewData.deadlines,
                                  cancellations: PreviewCancellationStore(),
                                  deadlines: PreviewDeadlineStore())
            }
        case .deadlines:
            DeadlinesView(modules: ["CA106", "CA216", "MS121"], store: PreviewDeadlineStore())
        case .signIn:
            SignInView { _ in }
        case .profile:
            ProfileCreatorView(user: PreviewData.user, onCreate: { _ in },
                               onChooseProgramme: {}, onSignOut: {})
        case .programme:
            ProgrammePickerView { _ in }
        case .groups:
            GroupSelectionView(programme: PreviewData.programme, source: PreviewTimetableSource())
        case .labs:
            EngineeringLabsView()
        case .account:
            AccountView(store: LocalProfileStore(), deadlines: PreviewDeadlineStore(), user: PreviewData.user)
        case .confirm:
            Color.clear.sheet(isPresented: .constant(true)) {
                ConfirmSheet(title: "Report this lecture as cancelled?",
                             message: "Everyone taking this module sees the count. You can undo it afterwards.",
                             confirmTitle: "Report cancelled",
                             symbol: "exclamationmark.bubble.fill",
                             tint: TimetableTint.off,
                             fill: TimetableTint.offFill) {}
            }
        }
    }
}

/// The signed-in shell with preview data in place of the network.
struct TimetablePreviewShell: View {
    /// The list or the grid. Set through the view's own settings store, so the preview
    /// never changes what the real app opens on.
    var showsCalendar = false

    @StateObject private var model = PreviewModels.week()

    var body: some View {
        TabView {
            WeekView(model: model, programme: PreviewData.programme,
                     source: PreviewTimetableSource(), title: "CASE1", resetLabel: "Sign out") {}
                .tabItem { Label("Timetable", systemImage: "calendar") }
            DeadlinesView(modules: model.loadedModuleKeys, store: PreviewDeadlineStore())
                .tabItem { Label("Deadlines", systemImage: "checklist") }
        }
        .defaultAppStorage(Self.settings(showsCalendar: showsCalendar))
    }

    private static func settings(showsCalendar: Bool) -> UserDefaults {
        let store = UserDefaults(suiteName: showsCalendar ? "preview.week" : "preview.day") ?? .standard
        store.set(showsCalendar, forKey: "weekShowsCalendar")
        return store
    }
}
#endif
