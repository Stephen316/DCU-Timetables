import Foundation

/// One selectable attendance group within a module (e.g. "Practical P1").
public struct GroupOption: Identifiable, Equatable, Sendable {
    public let key: String
    public let moduleCode: String
    public let moduleName: String
    public let kind: ActivityCode.Kind
    public let label: String

    public var id: String { key }

    public init(key: String, moduleCode: String, moduleName: String,
                kind: ActivityCode.Kind, label: String) {
        self.key = key
        self.moduleCode = moduleCode
        self.moduleName = moduleName
        self.kind = kind
        self.label = label
    }
}

/// A module and its distinct groups, for the group-selection UI.
public struct ModuleGroups: Identifiable, Equatable, Sendable {
    public let moduleCode: String
    public let moduleName: String
    public let groups: [GroupOption]
    public var id: String { moduleCode }
}

/// Derives the selectable group structure from a set of timetable events.
public enum GroupCatalog {

    /// Modules and their *selectable* streams. Lectures are excluded — everyone attends
    /// all lecture slots, so they aren't a choice (and would otherwise clutter the list
    /// with every weekly slot L1/L2/L7…). Only tutorial/lab/practical/seminar/workshop
    /// groups are offered; modules with no such group are omitted.
    public static func modules(from events: [TimetableEvent]) -> [ModuleGroups] {
        var order: [String] = []
        var names: [String: String] = [:]
        var groups: [String: [String: GroupOption]] = [:]

        for event in events where event.activity.kind != .lecture {
            let code = event.moduleCode ?? event.activity.raw
            if groups[code] == nil {
                groups[code] = [:]
                order.append(code)
            }
            if let name = event.moduleName, names[code] == nil {
                names[code] = name
            }
            groups[code]?[event.groupKey] = GroupOption(
                key: event.groupKey,
                moduleCode: code,
                moduleName: event.moduleName ?? code,
                kind: event.activity.kind,
                label: event.groupLabel
            )
        }

        return order.compactMap { code -> ModuleGroups? in
            let opts = (groups[code] ?? [:]).values.sorted { $0.label < $1.label }
            guard !opts.isEmpty else { return nil }
            return ModuleGroups(moduleCode: code, moduleName: names[code] ?? code, groups: opts)
        }
        .sorted { $0.moduleCode < $1.moduleCode }
    }

    /// Events a student attends, given the set of group keys they've hidden.
    public static func filter(_ events: [TimetableEvent], hiding hidden: Set<String>) -> [TimetableEvent] {
        guard !hidden.isEmpty else { return events }
        return events.filter { !hidden.contains($0.groupKey) }
    }
}
