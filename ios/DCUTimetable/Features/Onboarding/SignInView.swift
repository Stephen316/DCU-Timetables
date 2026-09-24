import SwiftUI

/// DCU-only sign-in with an email address and password.
///
/// Creating an account sends Supabase's confirmation email. The student taps the link in
/// it, comes back, and presses Continue — the account can't be used until they do, which
/// is what proves the address is theirs. The name then comes from the address, so nothing
/// else is ever typed.
struct SignInView: View {
    let onSignedIn: (AuthenticatedUser) -> Void

    private enum Mode: Hashable { case signIn, createAccount }

    @State private var mode: Mode = .signIn
    @State private var address = ""
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var isBusy = false
    @State private var note: String?
    /// Set once the confirmation email has been sent — the form then shows only that step.
    @State private var awaitingConfirmation: DCUEmail?

    private let auth = AuthServiceFactory.make()
    private var email: DCUEmail? { DCUEmail(address) }
    private var addressLooksWrong: Bool { !address.isEmpty && email == nil }
    private var passwordProblem: PasswordValidation.Problem? {
        PasswordValidation.problem(password: password, confirmation: confirmPassword)
    }

    private var canSubmit: Bool {
        guard email != nil, !password.isEmpty, !isBusy else { return false }
        guard mode == .createAccount else { return true }
        return PasswordValidation.canCreateAccount(password: password, confirmation: confirmPassword)
    }

    var body: some View {
        NavigationStack {
            List {
                Group {
                    Section {
                        Text("Use your DCU email address. Your name and lab group come from it, so there's nothing else to fill in.")
                            .font(.subheadline)
                            .foregroundStyle(Theme.inkSecondary)
                            .bareRow()
                    }

                    if let pending = awaitingConfirmation {
                        confirmation(for: pending)
                    } else {
                        credentials
                    }
                }
                .themedRows()
            }
            .listStyle(.grouped)
            .themedList()
            .navigationTitle("DCU Timetable")
            .adaptiveLargeTitle()
        }
    }

    private static let termsNotice: AttributedString = {
        let markdown = "By creating an account you agree to the [Terms of use](\(AppLinks.terms.absoluteString)) "
            + "and [Privacy policy](\(AppLinks.privacy.absoluteString)). Abusive or objectionable posts "
            + "aren't tolerated: they're removed, and the account that posted them is banned."
        return (try? AttributedString(markdown: markdown)) ?? AttributedString(markdown)
    }()

    @ViewBuilder
    private var credentials: some View {
        Group {
            Section {
                Picker("Sign in or create an account", selection: $mode) {
                    Text("Sign in").tag(Mode.signIn)
                    Text("Create account").tag(Mode.createAccount)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .onChange(of: mode) { _, _ in
                    confirmPassword = ""
                    note = nil
                }
                .bareRow()
            }

            Section {
                TextField("Email", text: $address)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if addressLooksWrong {
                    Text("\(address.trimmingCharacters(in: .whitespaces)) is not a valid email address")
                        .font(.caption).foregroundStyle(Theme.inkSecondary)
                } else if let email {
                    Text("Signing in as \(email.displayName)")
                        .font(.caption).foregroundStyle(Theme.inkSecondary)
                }

                // `.password`, never `.newPassword`: the latter opts the field into iOS's
                // automatic "Use Strong Password?" sheet, which slides up and covers the
                // fields — with a confirm box present that makes them impossible to type in.
                SecureField("Password", text: $password)
                    .textContentType(.password)

                if mode == .createAccount {
                    SecureField("Confirm password", text: $confirmPassword)
                    // The rules are stated before they type, not sprung on them after: the
                    // line is always there and the current problem takes its place.
                    Text(passwordProblem?.message ?? PasswordValidation.requirements)
                        .font(.caption).foregroundStyle(Theme.inkSecondary)
                }
            }

            if let note {
                Section { Text(note).font(.callout).foregroundStyle(Theme.inkSecondary) }
            }

            Section {
                Button(action: submit) {
                    HStack(spacing: Theme.Space.s) {
                        if isBusy { ProgressView().controlSize(.small).tint(Theme.onAccent) }
                        Text(mode == .signIn ? "Sign in" : "Create account")
                    }
                }
                .buttonStyle(.primary)
                .disabled(!canSubmit)
                .bareRow()
                .listRowInsets(Theme.standaloneRowInsets)
            } footer: {
                if mode == .createAccount {
                    // App Review 1.2: agreeing to terms that rule out abuse is part of letting
                    // people post where classmates read it.
                    Text(Self.termsNotice)
                        .font(.caption)
                        .foregroundStyle(Theme.inkSecondary)
                        .tint(Theme.accent)
                }
            }

            if mode == .signIn {
                Section {
                    Button("Forgot password?") {
                        run { auth in
                            try await auth.sendPasswordReset(to: email!)
                            note = "Password reset sent to your DCU email."
                        }
                    }
                    .disabled(email == nil || isBusy)
                }
            }
        }
    }

    /// The confirmation step. Confirming happens in the browser when the student taps the
    /// link, so the app can't observe it — Continue simply asks Supabase again.
    @ViewBuilder
    private func confirmation(for pending: DCUEmail) -> some View {
        Section {
            Text("Check your email").font(.headline).foregroundStyle(Theme.ink)
            Text("We've sent a confirmation link to \(pending.address). Tap it, then come back here.")
                .foregroundStyle(Theme.inkSecondary)
        }

        if let note {
            Section { Text(note).font(.callout).foregroundStyle(Theme.inkSecondary) }
        }

        Section {
            Button(action: { checkConfirmed(pending) }) {
                HStack(spacing: Theme.Space.s) {
                    if isBusy { ProgressView().controlSize(.small).tint(Theme.onAccent) }
                    Text("Continue")
                }
            }
            .buttonStyle(.primary)
            .disabled(isBusy)
            .bareRow()
            .listRowInsets(Theme.standaloneRowInsets)
        }

        Section {
            Button("Send the email again") {
                run { auth in
                    try await auth.resendConfirmation(to: pending)
                    note = "Sent again to \(pending.address)."
                }
            }
            .disabled(isBusy)
            Button("Use a different email") {
                awaitingConfirmation = nil
                note = nil
            }
            .disabled(isBusy)
        }
    }

    private func checkConfirmed(_ pending: DCUEmail) {
        run { auth in
            do {
                let user = try await auth.signIn(email: pending, password: password)
                SignedInUser.save(user)
                onSignedIn(user)
            } catch AuthError.emailNotConfirmed {
                note = "Not confirmed yet — tap the link in the email, then press Continue."
            }
        }
    }

    private func submit() {
        switch mode {
        case .signIn:
            let account = email!
            run { auth in
                do {
                    let user = try await auth.signIn(email: account, password: password)
                    SignedInUser.save(user)
                    onSignedIn(user)
                } catch AuthError.emailNotConfirmed {
                    // The account exists but was never confirmed — send the email again and
                    // say so, rather than letting a correct password look wrong.
                    try? await auth.resendConfirmation(to: account)
                    startConfirmation(of: account, note: "This address hasn't been confirmed yet.")
                }
            }
        case .createAccount:
            run { auth in
                switch try await auth.signUp(email: email!, password: password) {
                case .needsEmailConfirmation:
                    startConfirmation(of: email!, note: nil)
                case .signedIn(let user):
                    SignedInUser.save(user)
                    onSignedIn(user)
                }
            }
        }
    }

    /// `password` is deliberately kept — Continue re-tries the sign-in with it.
    private func startConfirmation(of account: DCUEmail, note message: String?) {
        awaitingConfirmation = account
        confirmPassword = ""
        mode = .signIn
        note = message
    }

    /// Shared busy/error handling so each action stays a single statement.
    private func run(_ work: @escaping (AuthService) async throws -> Void) {
        guard let auth else {
            note = AuthError.notConfigured.errorDescription
            return
        }
        isBusy = true
        note = nil
        Task {
            defer { isBusy = false }
            do { try await work(auth) }
            catch { note = (error as? LocalizedError)?.errorDescription ?? "Something went wrong." }
        }
    }
}

#if DEBUG
#Preview("Light") { PreviewScreen.signIn.view.previewVariant(.light) }
#Preview("Dark") { PreviewScreen.signIn.view.previewVariant(.dark) }
#Preview("Largest text") { PreviewScreen.signIn.view.previewVariant(.largestText) }
#Preview("iPhone SE", traits: .fixedLayout(width: 375, height: 667)) {
    PreviewScreen.signIn.view
}
#endif
