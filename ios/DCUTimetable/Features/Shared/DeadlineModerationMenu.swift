import SwiftUI

/// "…" on someone else's deadline: report it, or hide everything its author posts.
///
/// A menu rather than a swipe action, so it can be found without knowing to swipe — App
/// Review looks for both of these, and so does a student who has just read something
/// abusive. Neither shows who posted the deadline; the server works that out.
struct DeadlineModerationMenu: View {
    let deadline: Deadline
    let onReport: (DeadlineReportReason) -> Void
    let onHideAuthor: () -> Void

    @State private var choosingReason = false
    @State private var confirmingHide = false

    var body: some View {
        Menu {
            Button {
                choosingReason = true
            } label: {
                Label("Report…", systemImage: "flag")
            }
            Button(role: .destructive) {
                confirmingHide = true
            } label: {
                Label("Hide posts from this person", systemImage: "eye.slash")
            }
        } label: {
            Image(systemName: "ellipsis.circle")
                .foregroundStyle(Theme.inkSecondary)
                .frame(minWidth: Theme.Size.minTarget, minHeight: Theme.Size.minTarget)
                .contentShape(Rectangle())
        }
        .accessibilityLabel("More for \(deadline.title)")
        .confirmationDialog("Why are you reporting this?", isPresented: $choosingReason,
                            titleVisibility: .visible) {
            ForEach(DeadlineReportReason.allCases, id: \.self) { reason in
                Button(reason.label) { onReport(reason) }
            }
        } message: {
            Text("It's hidden from you straight away, and an administrator reviews it within a day. The person who posted it isn't told who reported it.")
        }
        .confirmationDialog("Hide posts from this person?", isPresented: $confirmingHide,
                            titleVisibility: .visible) {
            Button("Hide their posts", role: .destructive, action: onHideAuthor)
        } message: {
            Text("You won't see any deadline they share. You can show everyone again from Account.")
        }
    }
}
