import Foundation

/// "today", "tomorrow", "in 3 days" — how far off a deadline is, in the words students
/// actually use.
///
/// In `Shared` because the deadlines widget has to say the same thing the deadlines tab
/// says. The obvious alternative — the app writing the wording into the snapshot — cannot
/// work: a timeline entry rendered tomorrow morning would still be showing the string
/// computed today, so "tomorrow" would be on screen on the day itself.
///
/// Counted in whole calendar days between midnights, not in elapsed hours. Something due
/// at 9am tomorrow is "tomorrow" whether it is now 10pm or 10am, because that is what the
/// student means by the word.
public enum DeadlineCountdown {
    public static func text(to due: Date, from now: Date = Date(),
                            calendar: Calendar = .current) -> String {
        let days = calendar.dateComponents([.day],
                                           from: calendar.startOfDay(for: now),
                                           to: calendar.startOfDay(for: due)).day ?? 0
        switch days {
        case ..<0: return "overdue"
        case 0: return "today"
        case 1: return "tomorrow"
        default: return "in \(days) days"
        }
    }
}
