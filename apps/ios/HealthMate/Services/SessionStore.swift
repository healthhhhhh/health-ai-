import Foundation
import HealthMateCore
import Observation

/// Account state for features that need the HealthMate server (AI chat,
/// reports, image analysis, sync). Everything else works signed out.
@MainActor
@Observable
final class SessionStore {
    enum State: Equatable { case unknown, signedOut, signedIn }

    private(set) var state: State = .unknown
    /// nil until checked; false means the server has no AI provider configured.
    private(set) var aiAvailable: Bool?
    /// The server gives scripted demo answers; the UI must say so.
    private(set) var isDemo = false
    /// Phase 1 Preview mode: sample account and sample AI responses, no server.
    private(set) var isPreview = false
    private(set) var consents: [String: Bool] = [:]
    private(set) var busy = false
    private var lastError: Error?
    var errorMessage: String?
    /// Non-error status to show on the sign-in screen (e.g. "check your email").
    var notice: String?
    /// Set after sign-up (or a sign-in before confirming): the address waiting for its confirmation link.
    var pendingVerificationEmail: String?
    /// The signed-in account hasn't finished first-run setup (goals, privacy, reminders).
    private(set) var needsAccountSetup = false

    let api: APIClient

    init(api: APIClient) {
        self.api = api
    }

    var isSignedIn: Bool { state == .signedIn }

    func restore() async {
        state = await api.isSignedIn ? .signedIn : .signedOut
        #if DEBUG
        // Screenshots and UI tests: `-hmDemoEmail … -hmDemoPassword …` signs in to a demo server.
        if state == .signedOut,
           let email = UserDefaults.standard.string(forKey: "hmDemoEmail"),
           let password = UserDefaults.standard.string(forKey: "hmDemoPassword") {
            _ = await signIn(email: email, password: password)
        }
        #endif
        await refreshMeta()
        if isSignedIn { await loadAccount() }
    }

    func refreshMeta() async {
        let meta = try? await api.meta()
        aiAvailable = meta?.ai.available
        isDemo = meta?.ai.demo == true
        isPreview = meta?.preview == true
    }

    func signIn(email: String, password: String) async -> Bool {
        let ok = await perform { _ = try await self.api.login(email: email, password: password) }
        if !ok, case .server(_, "email_not_confirmed", _)? = lastError as? APIError {
            // Not confirmed yet: go back to "check your email" rather than showing an error.
            errorMessage = nil
            pendingVerificationEmail = email.trimmingCharacters(in: .whitespaces)
        }
        return ok
    }

    /// Returns true when signed in. With email confirmation on, returns false and sets `notice`.
    func signUp(email: String, password: String, firstName: String, lastName: String) async -> Bool {
        var pending = false
        let ok = await perform {
            let outcome = try await self.api.register(email: email, password: password, firstName: firstName, lastName: lastName, timeZone: TimeZone.current.identifier)
            if outcome == .confirmationRequired {
                pending = true
                throw CancellationError()
            }
        }
        if pending {
            errorMessage = nil
            pendingVerificationEmail = email.trimmingCharacters(in: .whitespaces)
        }
        return ok
    }

    /// Always reports success for a valid address, so it can't reveal who has an account.
    func requestPasswordReset(email: String) async -> Bool {
        busy = true
        errorMessage = nil
        defer { busy = false }
        do {
            try await api.requestPasswordReset(email: email)
        } catch APIError.server(501, _, _) {
            errorMessage = "Password reset isn't available on this server yet."
            return false
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Couldn't send the reset email. Please try again."
            return false
        }
        notice = "If an account uses \(email), we've sent a link to reset the password."
        return true
    }

    /// Confirms an email address from the confirmation email and signs in.
    func verifyEmail(token: String) async -> Bool {
        let ok = await perform { _ = try await self.api.verifyEmail(token: token) }
        if ok { pendingVerificationEmail = nil }
        return ok
    }

    /// Sends the confirmation email again (always "sent", so it can't reveal who has an account).
    func resendVerification() async -> Bool {
        guard let email = pendingVerificationEmail else { return false }
        busy = true
        errorMessage = nil
        defer { busy = false }
        do {
            try await api.resendVerification(email: email)
            return true
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "We couldn't send the email. Please try again."
            return false
        }
    }

    /// Saves first-run setup; on success the app continues to Home.
    func completeAccountSetup(_ draft: AccountSetupDraft) async -> Bool {
        busy = true
        errorMessage = nil
        defer { busy = false }
        do {
            try await draft.save(using: api)
            needsAccountSetup = false
            await loadConsents()
            return true
        } catch {
            handle(error)
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "We couldn't save your choices. Please try again."
            return false
        }
    }

    /// Continue with Apple or Google (Phase 1: mocked in Preview mode).
    func signIn(with provider: String) async -> Bool {
        await perform { _ = try await self.api.signIn(with: provider) }
    }

    func signOut() async {
        await api.logout()
        consents = [:]
        needsAccountSetup = false
        state = .signedOut
    }

    func deleteAccount(password: String) async -> Bool {
        busy = true
        defer { busy = false }
        do {
            try await api.deleteAccount(password: password)
            consents = [:]
            state = .signedOut
            return true
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Couldn't delete your account. Please try again."
            return false
        }
    }

    func hasConsent(_ kind: String) -> Bool { consents[kind] == true }

    func setConsent(_ kind: String, granted: Bool) async {
        do {
            try await api.setConsent(kind, granted: granted)
            consents[kind] = granted
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription
        }
    }

    /// Called when any request reports the session has ended.
    func handle(_ error: Error) {
        if (error as? APIError) == .unauthorized { state = .signedOut }
    }

    /// Consents plus whether first-run setup is still to do (an older server without the endpoint counts as done).
    private func loadAccount() async {
        await loadConsents()
        needsAccountSetup = (try? await api.accountSummary())?.onboardingCompleted == false
    }

    private func loadConsents() async {
        if let list = try? await api.consents() {
            consents = Dictionary(uniqueKeysWithValues: list.map { ($0.kind, $0.granted) })
        }
    }

    private func perform(_ work: @escaping () async throws -> Void) async -> Bool {
        busy = true
        errorMessage = nil
        defer { busy = false }
        lastError = nil
        do {
            try await work()
            state = .signedIn
            await loadAccount()
            return true
        } catch {
            lastError = error
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Something went wrong. Please try again."
            return false
        }
    }
}
