import SwiftUI

/// DCU-only sign-in: enter a college address, receive a one-time code, enter it.
/// Verifying the address is what proves the person is a student — and it supplies their
/// name, so nothing has to be typed by hand.
struct SignInView: View {
    let onSignedIn: (AuthenticatedUser) -> Void

    @State private var address = ""
    @State private var code = ""
    @State private var codeSent = false
    @State private var isBusy = false
    @State private var errorText: String?

    private let auth = AuthServiceFactory.make()
    private var email: DCUEmail? { DCUEmail(address) }
    private var addressLooksWrong: Bool { !address.isEmpty && email == nil }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Sign in with your DCU email address")
                }

                Section {
                    TextField("", text: $address)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .disabled(codeSent)
                    if addressLooksWrong {
                        Text("\(address.trimmingCharacters(in: .whitespaces)) is not a valid email address")
                            .font(.caption).foregroundStyle(.secondary)
                    } else if let email, !codeSent {
                        Text("Signing in as \(email.displayName)")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }

                if codeSent {
                    Section("Code from your email") {
                        TextField("6-digit code", text: $code)
                            .keyboardType(.numberPad)
                            .textContentType(.oneTimeCode)
                        Button("Use a different address") {
                            codeSent = false; code = ""; errorText = nil
                        }
                        .font(.footnote)
                    }
                }

                if let errorText {
                    Section { Text(errorText).font(.callout).foregroundStyle(.secondary) }
                }

                Section {
                    Button(action: primaryAction) {
                        HStack {
                            if isBusy { ProgressView().controlSize(.small) }
                            Text(codeSent ? "Verify and continue" : "Email me a code")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isBusy || email == nil || (codeSent && code.count < 4))
                }
            }
            .navigationTitle("Welcome")
        }
    }

    private func primaryAction() {
        guard let email, let auth else {
            errorText = AuthError.notConfigured.errorDescription
            return
        }
        isBusy = true
        errorText = nil
        Task {
            defer { isBusy = false }
            do {
                if codeSent {
                    let user = try await auth.verify(email: email, code: code)
                    SignedInUser.save(user)
                    onSignedIn(user)
                } else {
                    try await auth.sendCode(to: email)
                    codeSent = true
                }
            } catch {
                errorText = (error as? LocalizedError)?.errorDescription ?? "Something went wrong."
            }
        }
    }
}
