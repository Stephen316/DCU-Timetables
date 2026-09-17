import SwiftUI

/// DCU-only sign-in with an email address and password.
///
/// The address must be a DCU one, and Supabase emails a confirmation link on sign-up, so
/// an account only works once the student has proved they control that address. The name
/// then comes from the address — nothing else is typed.
struct SignInView: View {
    let onSignedIn: (AuthenticatedUser) -> Void

    private enum Mode: Hashable { case signIn, createAccount }

    @State private var mode: Mode = .signIn
    @State private var address = ""
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var isBusy = false
    @State private var note: String?

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
            Form {
                Section {
                    Text("Sign in with your DCU email address")
                }

                Section {
                    Picker("", selection: $mode) {
                        Text("Sign in").tag(Mode.signIn)
                        Text("Create account").tag(Mode.createAccount)
                    }
                    .pickerStyle(.segmented)
                    .onChange(of: mode) { _, _ in
                        confirmPassword = ""
                        note = nil
                    }
                }

                Section {
                    TextField("Email", text: $address)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    if addressLooksWrong {
                        Text("\(address.trimmingCharacters(in: .whitespaces)) is not a valid email address")
                            .font(.caption).foregroundStyle(.secondary)
                    } else if let email {
                        Text("Signing in as \(email.displayName)")
                            .font(.caption).foregroundStyle(.secondary)
                    }

                    SecureField("Password", text: $password)
                        .textContentType(mode == .createAccount ? .newPassword : .password)

                    if mode == .createAccount {
                        SecureField("Confirm password", text: $confirmPassword)
                            .textContentType(.newPassword)
                        if let passwordProblem {
                            Text(passwordProblem.message)
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }

                if let note {
                    Section { Text(note).font(.callout).foregroundStyle(.secondary) }
                }

                Section {
                    Button(action: submit) {
                        HStack {
                            if isBusy { ProgressView().controlSize(.small) }
                            Text(mode == .signIn ? "Sign in" : "Create account")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!canSubmit)
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
            .navigationTitle("Welcome")
        }
    }

    private func submit() {
        switch mode {
        case .signIn:
            run { auth in
                let user = try await auth.signIn(email: email!, password: password)
                SignedInUser.save(user)
                onSignedIn(user)
            }
        case .createAccount:
            run { auth in
                switch try await auth.signUp(email: email!, password: password) {
                case .needsEmailConfirmation:
                    note = "Account created. Check your DCU email to confirm the address, then sign in."
                    mode = .signIn
                case .signedIn(let user):
                    SignedInUser.save(user)
                    onSignedIn(user)
                }
            }
        }
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
