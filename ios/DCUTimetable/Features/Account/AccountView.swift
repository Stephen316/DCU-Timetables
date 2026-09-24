import SwiftUI

/// Who you're signed in as, the identifier you share to be made trusted, and the way out.
struct AccountView: View {
    @Environment(\.dismiss) private var dismiss

    private let store: ProfileStore
    private let deadlines: DeadlineStore
    /// Nil until counted, so a failed count shows nothing rather than a wrong "No one".
    @State private var hiddenCount: Int?
    @State private var unhiding = false
    @State private var profile: AccountProfile?
    @State private var loadFailed = false
    @State private var copied = false
    @State private var confirmingDelete = false
    @State private var deleting = false
    @State private var deleteError: String?
    @AppStorage(AppearanceSetting.storageKey) private var appearance: AppearanceSetting = .system

    private let user = SignedInUser.current

    init(store: ProfileStore = ProfileStoreFactory.make(),
         deadlines: DeadlineStore = DeadlineStoreFactory.make()) {
        self.store = store
        self.deadlines = deadlines
    }

    var body: some View {
        NavigationStack {
            List {
                Group {
                    signedInSection
                    appearanceSection
                    identifierSection
                    hiddenSection
                    aboutSection
                    dangerSection
                }
                .themedRows()
            }
            .listStyle(.grouped)
            .themedList()
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .task { await load() }
            .alert("Delete your account?", isPresented: $confirmingDelete) {
                Button("Delete", role: .destructive) { Task { await delete() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This can't be undone. Deadlines and reports you shared stay, but "
                     + "nothing will link them to you.")
            }
            .alert("Couldn't delete", isPresented: .constant(deleteError != nil)) {
                Button("OK") { deleteError = nil }
            } message: {
                Text(deleteError ?? "")
            }
        }
    }

    // MARK: - Sections

    @ViewBuilder
    private var signedInSection: some View {
        Section("Signed in as") {
            LabeledContent("Name", value: user?.email?.displayName ?? "--")
            LabeledContent("Email", value: user?.address ?? "--")
            if let profile, profile.role != .student {
                LabeledContent("Role", value: profile.role.label)
            }
        }
    }

    /// Three rows with a checkmark rather than a segmented control: the rows wrap at the
    /// largest text sizes, and a segmented control's labels don't grow at all.
    private var appearanceSection: some View {
        Section {
            Picker("Appearance", selection: $appearance) {
                ForEach(AppearanceSetting.allCases) { setting in
                    Text(setting.label).tag(setting)
                }
            }
            .pickerStyle(.inline)
            .labelsHidden()
        } header: {
            Text("Appearance")
        } footer: {
            Text("Match iPhone follows the Light or Dark setting in your iPhone's Display & Brightness settings.")
        }
    }

    @ViewBuilder
    private var identifierSection: some View {
        Section {
            if let pi = profile?.pi {
                Button {
                    UIPasteboard.general.string = pi
                    copied = true
                    // Long enough to read, short enough that it doesn't linger into the
                    // next thing the student does.
                    Task {
                        try? await Task.sleep(for: .seconds(2))
                        copied = false
                    }
                } label: {
                    HStack {
                        Text(pi)
                            .foregroundStyle(Theme.ink)
                            .font(.system(.title3, design: .monospaced))
                            .textSelection(.enabled)
                        Spacer()
                        Image(systemName: copied ? "checkmark" : "doc.on.doc")
                            .foregroundStyle(copied ? TimetableTint.confirmed : Theme.accent)
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(copied ? "Copied" : "Your ID, \(pi)")
                .accessibilityHint("Copies it")
            } else if loadFailed {
                LabeledContent("Your ID", value: "--")
            } else {
                HStack {
                    Text("Your ID")
                    Spacer()
                    ProgressView()
                }
            }
        } header: {
            Text("Your ID")
        } footer: {
            Text("Share this only with someone making you a trusted reporter. "
                 + "It identifies your account — it isn't a password, and it doesn't "
                 + "let anyone sign in as you.")
        }
    }

    /// The way back from "Hide posts from this person". All at once, because the app never
    /// learns who was hidden — only how many.
    @ViewBuilder
    private var hiddenSection: some View {
        if let hiddenCount, hiddenCount > 0 {
            Section {
                LabeledContent("Hidden", value: hiddenCount == 1 ? "1 person" : "\(hiddenCount) people")
                Button {
                    Task { await unhideAll() }
                } label: {
                    HStack {
                        Text("Show everyone again")
                        if unhiding {
                            Spacer()
                            ProgressView()
                        }
                    }
                    .contentShape(.rect)
                }
                .disabled(unhiding)
            } header: {
                Text("Hidden people")
            } footer: {
                Text("Deadlines from people you've hidden don't reach you.")
            }
        }
    }

    private var aboutSection: some View {
        Section {
            Link("Privacy policy", destination: AppLinks.privacy)
            Link("Terms of use", destination: AppLinks.terms)
            Link("Help and contact", destination: AppLinks.support)
        } header: {
            Text("About")
        } footer: {
            Text("An independent student project. Not affiliated with or endorsed by Dublin City University.")
        }
    }

    @ViewBuilder
    private var dangerSection: some View {
        Section {
            Button(role: .destructive) {
                confirmingDelete = true
            } label: {
                HStack {
                    Text("Delete account")
                    if deleting {
                        Spacer()
                        ProgressView()
                    }
                }
                .contentShape(.rect)
            }
            .disabled(deleting)
        } footer: {
            Text("Removes your account and everything on this device.")
        }
    }

    // MARK: - Actions

    private func load() async {
        hiddenCount = try? await deadlines.hiddenAuthorCount()
        do {
            let fetched = try await store.myProfile()
            profile = fetched
            if let fetched { CachedRole.save(fetched.role) }
            loadFailed = fetched == nil
        } catch {
            // The ID is a convenience, not something worth an error dialog over — it
            // shows as `--` and the student can come back.
            loadFailed = true
        }
    }

    private func unhideAll() async {
        unhiding = true
        defer { unhiding = false }
        do {
            try await deadlines.unhideAllAuthors()
            hiddenCount = 0
        } catch {
            hiddenCount = try? await deadlines.hiddenAuthorCount()
        }
    }

    private func delete() async {
        deleting = true
        defer { deleting = false }
        do {
            try await store.deleteAccount()
            // RootView owns the teardown — it clears the profile, the attendance marks and
            // the voter id as well as the credentials, which this sheet can't reach.
            NotificationCenter.default.post(name: .signOutRequested, object: nil)
            dismiss()
        } catch {
            deleteError = error.localizedDescription
        }
    }
}

#if DEBUG
#Preview("Light") { PreviewScreen.account.view.previewVariant(.light) }
#Preview("Dark") { PreviewScreen.account.view.previewVariant(.dark) }
#Preview("Largest text") { PreviewScreen.account.view.previewVariant(.largestText) }
#Preview("iPhone SE", traits: .fixedLayout(width: 375, height: 667)) {
    PreviewScreen.account.view
}
#endif
