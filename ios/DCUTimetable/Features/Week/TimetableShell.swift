import SwiftUI

/// The signed-in app: the timetable and the deadlines list, sharing one `WeekViewModel`.
///
/// The model lives here rather than in `WeekView` because both tabs need it — the deadlines
/// tab takes its module list from the weeks the timetable has already loaded, so it costs
/// no extra request and can't disagree with what's on the grid.
struct TimetableShell: View {
    let programme: TimetableCategory
    let source: TimetableSource
    let title: String
    let resetLabel: String
    let onReset: () -> Void

    @StateObject private var model: WeekViewModel

    init(programme: TimetableCategory,
         source: TimetableSource = DCUAPIClient(),
         title: String? = nil,
         resetLabel: String = "Change programme",
         audience: TimetableAudience? = nil,
         onReset: @escaping () -> Void) {
        self.programme = programme
        self.source = source
        self.title = title ?? programme.code
        self.resetLabel = resetLabel
        self.onReset = onReset
        let hidden = HiddenGroups.decode(UserDefaults.standard.data(forKey: "hiddenGroups") ?? Data())
        _model = StateObject(wrappedValue: WeekViewModel(programme: programme,
                                                         hiddenGroups: hidden,
                                                         audience: audience ?? TimetableAudience.forProgramme(code: programme.code),
                                                         source: source))
    }

    var body: some View {
        TabView {
            WeekView(model: model,
                     programme: programme,
                     source: source,
                     title: title,
                     resetLabel: resetLabel,
                     onReset: onReset)
                .tabItem { Label("Timetable", systemImage: "calendar") }

            DeadlinesView(modules: model.loadedModuleKeys, store: model.deadlineStore)
                .tabItem { Label("Deadlines", systemImage: "checklist") }
        }
    }
}
