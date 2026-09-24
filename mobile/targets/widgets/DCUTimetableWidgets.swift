import SwiftUI
import WidgetKit

/// Both widgets ship from one extension. A second extension would mean a second copy of
/// `Shared`, a second Info.plist and a second thing to sign, for two widgets that read the
/// same file.
@main
struct DCUTimetableWidgets: WidgetBundle {
    var body: some Widget {
        TimetableWidget()
        DeadlinesWidget()
    }
}
