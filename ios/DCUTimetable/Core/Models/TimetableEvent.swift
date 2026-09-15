import Foundation

/// One class in a timetable — the Core domain type the UI renders.
public struct TimetableEvent: Identifiable, Equatable, Sendable, Codable {
    public let id: String
    public let start: Date
    public let end: Date
    public let type: EventType
    public let locations: [String]
    public let moduleName: String?
    public let staff: [String]
    public let activity: ActivityCode
    public let weekLabels: [String]

    public init(
        id: String,
        start: Date,
        end: Date,
        type: EventType,
        locations: [String],
        moduleName: String?,
        staff: [String],
        activity: ActivityCode,
        weekLabels: [String]
    ) {
        self.id = id
        self.start = start
        self.end = end
        self.type = type
        self.locations = locations
        self.moduleName = moduleName
        self.staff = staff
        self.activity = activity
        self.weekLabels = weekLabels
    }

    public var moduleCode: String? { activity.moduleCode }

    /// Best available title: module name, else module code, else the raw activity code.
    public var title: String {
        moduleName ?? activity.moduleCode ?? activity.raw
    }

    /// Room(s), or an em dash when there is no location (e.g. recorded classes).
    public var locationText: String {
        locations.isEmpty ? "—" : locations.joined(separator: ", ")
    }

    public var staffText: String? {
        staff.isEmpty ? nil : staff.joined(separator: ", ")
    }

    /// Stable identifier for the attendance group this event belongs to — module +
    /// activity kind/index + group number + cohort. Two events with the same key are the
    /// same weekly group; different keys are groups a student chooses between.
    public var groupKey: String {
        [
            moduleCode ?? activity.raw,
            "\(activity.kind.rawValue)\(activity.activityIndex.map(String.init) ?? "")",
            activity.group ?? "",
            activity.cohort ?? "",
        ].joined(separator: "|")
    }

    /// Human label for the group, e.g. "Practical P1", "Tutorial T1 · Grp 02 · Surname A - M".
    public var groupLabel: String {
        let code = "\(activity.kind.rawValue)\(activity.activityIndex.map(String.init) ?? "")"
        var parts = ["\(activity.kind.label) \(code)"]
        if let group = activity.group, !group.isEmpty { parts.append("Grp \(group)") }
        if let cohort = activity.cohort, !cohort.isEmpty { parts.append(cohort) }
        return parts.joined(separator: " · ")
    }
}
