import SwiftUI

/// Who you're signed in as, your settings, the app's policies, and the way out.
///
/// Laid out as a menu: the name large at the top, then cards of rows that each open one
/// thing. Anything with more to say than a label — the ID, appearance, hidden people — has
/// its own page, so the top level stays a list of places to go.
struct AccountView: View {
    @Environment(\.dismiss) private var dismiss

    private let store: ProfileStore
    private let deadlines: DeadlineStore
    /// Nil until counted, so a failed count shows nothing rather than a wrong "No one".
    @State private var hiddenCount: Int?
    @State private var profile: AccountProfile?
    @State private var loadFailed = false
    @State private var confirmingDelete = false
    @State private var confirmingSignOut = false
    @State private var deleting = false
    @State private var deleteError: String?
    @State private var page: WebPage?
    @AppStorage(AppearanceSetting.storageKey) private var appearance: AppearanceSetting = .system

    private let user: AuthenticatedUser?

    init(store: ProfileStore = ProfileStoreFactory.make(),
         deadlines: DeadlineStore = DeadlineStoreFactory.make(),
         user: AuthenticatedUser? = SignedInUser.current) {
        self.store = store
        self.deadlines = deadlines
        self.user = user
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.xl) {
                    heading
                    settingsCard
                    aboutCard
                    leaveCard
                }
                .padding(.horizontal, Theme.Space.l)
                .padding(.bottom, Theme.Space.xxl)
            }
            .background(Theme.canvas.ignoresSafeArea())
            // The name below is the page's heading; a title over it would say "Account" twice.
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .navigationDestination(for: AccountPage.self) { destination in
                switch destination {
                case .appearance:
                    AppearancePage(appearance: $appearance)
                case .identifier:
                    IdentifierPage(profile: profile, loadFailed: loadFailed)
                case .hidden:
                    HiddenPeoplePage(count: $hiddenCount, store: deadlines)
                }
            }
            .sheet(item: $page) { page in
                SafariSheet(url: page.url).ignoresSafeArea()
            }
            .task { await load() }
            .confirmationDialog("Sign out?", isPresented: $confirmingSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) { signOut() }
            } message: {
                Text("Your timetable and settings stay on this iPhone.")
            }
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

    // MARK: - Heading

    private var heading: some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            Text(user?.email?.displayName ?? "Account")
                .font(.title.weight(.bold))
                .foregroundStyle(Theme.ink)
                .accessibilityAddTraits(.isHeader)
            Text(user?.address ?? "")
                .font(.title3)
                .foregroundStyle(Theme.inkSecondary)
                // Addresses are long and unbreakable; shrink a little before truncating.
                .lineLimit(2)
                .minimumScaleFactor(0.8)
            if let profile, profile.role != .student {
                Text(profile.role.label)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.accent)
                    .padding(.top, Theme.Space.xs)
            }
        }
        .padding(.top, Theme.Space.s)
    }

    // MARK: - Cards

    private var settingsCard: some View {
        SettingsCard {
            NavigationLink(value: AccountPage.appearance) {
                SettingsRow(title: "Appearance", symbol: "circle.lefthalf.filled",
                            value: appearance.label)
            }
            SettingsDivider()
            NavigationLink(value: AccountPage.identifier) {
                SettingsRow(title: "Your ID", symbol: "person.text.rectangle",
                            value: profile?.pi)
            }
            if let hiddenCount, hiddenCount > 0 {
                SettingsDivider()
                NavigationLink(value: AccountPage.hidden) {
                    SettingsRow(title: "Hidden people", symbol: "eye.slash",
                                value: "\(hiddenCount)")
                }
            }
        }
        .buttonStyle(.row)
    }

    private var aboutCard: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            SettingsCard {
                Button { page = WebPage(url: AppLinks.privacy) } label: {
                    SettingsRow(title: "Privacy policy", symbol: "hand.raised")
                }
                SettingsDivider()
                Button { page = WebPage(url: AppLinks.terms) } label: {
                    SettingsRow(title: "Terms of use", symbol: "doc.text")
                }
                SettingsDivider()
                Button { page = WebPage(url: AppLinks.support) } label: {
                    SettingsRow(title: "Help and contact", symbol: "questionmark.bubble")
                }
            }
            .buttonStyle(.row)

            Text("An independent student project. Not affiliated with or endorsed by Dublin City University.")
                .font(.footnote)
                .foregroundStyle(Theme.inkTertiary)
                .padding(.horizontal, Theme.Space.l)
        }
    }

    private var leaveCard: some View {
        SettingsCard {
            Button { confirmingSignOut = true } label: {
                SettingsRow(title: "Sign out", symbol: "rectangle.portrait.and.arrow.right",
                            accessory: .none)
            }
            SettingsDivider()
            Button { confirmingDelete = true } label: {
                HStack {
                    SettingsRow(title: "Delete account", symbol: "trash", tint: .red, accessory: .none)
                    if deleting {
                        ProgressView().padding(.trailing, Theme.Space.l)
                    }
                }
            }
            .disabled(deleting)
        }
        .buttonStyle(.row)
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

    /// RootView owns the teardown — it clears the profile, the attendance marks and the
    /// voter id as well as the credentials, which this sheet can't reach.
    private func signOut() {
        NotificationCenter.default.post(name: .signOutRequested, object: nil)
        dismiss()
    }

    private func delete() async {
        deleting = true
        defer { deleting = false }
        do {
            try await store.deleteAccount()
            signOut()
        } catch {
            deleteError = error.localizedDescription
        }
    }
}

private enum AccountPage: Hashable {
    case appearance, identifier, hidden
}

// MARK: - Pages

/// Three rows with a checkmark rather than a segmented control: the rows wrap at the
/// largest text sizes, and a segmented control's labels don't grow at all.
private struct AppearancePage: View {
    @Binding var appearance: AppearanceSetting

    var body: some View {
        List {
            Section {
                Picker("Appearance", selection: $appearance) {
                    ForEach(AppearanceSetting.allCases) { setting in
                        Text(setting.label).tag(setting)
                    }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            } footer: {
                Text("Match iPhone follows the Light or Dark setting in your iPhone's Display & Brightness settings.")
            }
            .themedRows()
        }
        .listStyle(.insetGrouped)
        .themedList()
        .navigationTitle("Appearance")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct IdentifierPage: View {
    let profile: AccountProfile?
    let loadFailed: Bool
    @State private var copied = false

    var body: some View {
        List {
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
            } footer: {
                Text("Share this only with someone making you a trusted reporter. "
                     + "It identifies your account — it isn't a password, and it doesn't "
                     + "let anyone sign in as you.")
            }
            .themedRows()
        }
        .listStyle(.insetGrouped)
        .themedList()
        .navigationTitle("Your ID")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// The way back from "Hide posts from this person". All at once, because the app never
/// learns who was hidden — only how many.
private struct HiddenPeoplePage: View {
    @Binding var count: Int?
    let store: DeadlineStore
    @State private var unhiding = false

    var body: some View {
        List {
            Section {
                LabeledContent("Hidden", value: (count ?? 0) == 1 ? "1 person" : "\(count ?? 0) people")
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
                .disabled(unhiding || (count ?? 0) == 0)
            } footer: {
                Text("Deadlines from people you've hidden don't reach you.")
            }
            .themedRows()
        }
        .listStyle(.insetGrouped)
        .themedList()
        .navigationTitle("Hidden people")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func unhideAll() async {
        unhiding = true
        defer { unhiding = false }
        do {
            try await store.unhideAllAuthors()
            count = 0
        } catch {
            count = try? await store.hiddenAuthorCount()
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
