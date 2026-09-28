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
    private(set) var consents: [String: Bool] = [:]
    private(set) var busy = false
    var errorMessage: String?

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
        if isSignedIn { await loadConsents() }
    }

    func refreshMeta() async {
        let meta = try? await api.meta()
        aiAvailable = meta?.ai.available
        isDemo = meta?.ai.demo == true
    }

    func signIn(email: String, password: String) async -> Bool {
        await perform { _ = try await self.api.login(email: email, password: password) }
    }

    func signUp(email: String, password: String, firstName: String, lastName: String) async -> Bool {
        await perform {
            _ = try await self.api.register(email: email, password: password, firstName: firstName, lastName: lastName, timeZone: TimeZone.current.identifier)
        }
    }

    func signOut() async {
        await api.logout()
        consents = [:]
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

    private func loadConsents() async {
        if let list = try? await api.consents() {
            consents = Dictionary(uniqueKeysWithValues: list.map { ($0.kind, $0.granted) })
        }
    }

    private func perform(_ work: @escaping () async throws -> Void) async -> Bool {
        busy = true
        errorMessage = nil
        defer { busy = false }
        do {
            try await work()
            state = .signedIn
            await loadConsents()
            return true
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Something went wrong. Please try again."
            return false
        }
    }
}
