import Foundation
import HealthMateCore
import Observation

/// One row in the chat transcript.
enum ChatItem: Identifiable, Equatable {
    case user(id: String, text: String)
    case assistant(ChatMessageRecord)
    /// Shown instantly from the on-device safety check, before any server reply.
    case localEscalation(id: String, Escalation)

    var id: String {
        switch self {
        case .user(let id, _): return "u-\(id)"
        case .assistant(let m): return "a-\(m.id)"
        case .localEscalation(let id, _): return "e-\(id)"
        }
    }
}

@MainActor
@Observable
final class ChatViewModel {
    /// Why the last message wasn't answered; decides the icon and wording of the error row.
    enum ErrorKind: Equatable { case offline, unavailable, other }

    private(set) var items: [ChatItem] = []
    private(set) var conversationId: String?
    private(set) var sending = false
    private(set) var conversations: [ConversationRecord] = []
    /// Last failed message, kept so the person can retry without retyping.
    private(set) var failedText: String?
    var errorMessage: String?
    private(set) var errorKind: ErrorKind = .other
    /// Past conversations couldn't be loaded.
    private(set) var historyFailed = false
    /// The server has no AI available: messages aren't sent, but on-device emergency guidance still appears.
    var aiUnavailable = false
    var draft = ""
    private(set) var savedSuggestions: Set<String> = []

    private let api: APIClient
    private let onSessionEnded: @MainActor (Error) -> Void

    init(api: APIClient, onSessionEnded: @escaping @MainActor (Error) -> Void = { _ in }) {
        self.api = api
        self.onSessionEnded = onSessionEnded
    }

    var isEmpty: Bool { items.isEmpty }

    func send(_ raw: String? = nil) async {
        let text = (raw ?? draft).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !sending else { return }
        if raw == nil { draft = "" }
        errorMessage = nil
        failedText = nil
        let localId = UUID().uuidString
        items.append(.user(id: localId, text: text))

        // Deterministic on-device check first: emergencies get guidance now, even offline.
        let triage = SafetyEngine.triage(text)
        if triage.level == .emergency, let escalation = SafetyEngine.escalation(for: triage) {
            items.append(.localEscalation(id: localId, escalation))
        }

        if aiUnavailable {
            fail(text, .unavailable, "AI answers are unavailable right now, so this message wasn't sent. Emergency guidance still works.")
            return
        }

        sending = true
        defer { sending = false }
        do {
            let messages: [ChatMessageRecord]
            if let conversationId {
                messages = try await api.sendMessage(text, in: conversationId)
            } else {
                let start = try await api.startConversation(text)
                conversationId = start.conversation.id
                messages = start.messages
            }
            if let reply = messages.last(where: { $0.role == .assistant }) {
                // The server's escalation replaces the local one to avoid showing it twice.
                if case .escalation = reply.payload { items.removeAll { if case .localEscalation(let id, _) = $0 { return id == localId }; return false } }
                items.append(.assistant(reply))
            }
        } catch APIError.network {
            fail(text, .offline, "You're offline, so your message wasn't sent.")
        } catch APIError.aiUnavailable {
            aiUnavailable = true
            fail(text, .unavailable, "AI answers are unavailable right now, so this message wasn't sent. Emergency guidance still works.")
        } catch {
            onSessionEnded(error)
            fail(text, .other, (error as? LocalizedError)?.errorDescription ?? "The message couldn't be sent. Please try again.")
        }
    }

    private func fail(_ text: String, _ kind: ErrorKind, _ message: String) {
        failedText = text
        errorKind = kind
        errorMessage = message
    }

    /// Retries the last failed message (its bubble is already shown).
    func retry() async {
        guard let text = failedText else { return }
        if case .user(_, let last) = items.last, last == text { items.removeLast() }
        await send(text)
    }

    func loadHistory() async {
        do {
            conversations = try await api.conversations()
            historyFailed = false
        } catch {
            onSessionEnded(error)
            historyFailed = true
        }
    }

    func rename(_ conversation: ConversationRecord, to title: String) async {
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        do {
            let updated = try await api.renameConversation(conversation.id, title: String(name.prefix(80)))
            if let index = conversations.firstIndex(where: { $0.id == conversation.id }) { conversations[index] = updated }
        } catch {
            errorKind = .other
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Couldn't rename the conversation."
        }
    }

    func open(_ conversation: ConversationRecord) async {
        await openConversation(id: conversation.id)
    }

    /// Opens a conversation by id (e.g. from a Home activity item or a notification).
    func openConversation(id: String) async {
        do {
            let detail = try await api.conversation(id)
            conversationId = detail.conversation.id
            items = detail.messages.map { $0.role == .user ? .user(id: $0.id, text: $0.content) : .assistant($0) }
            errorMessage = nil
            failedText = nil
        } catch APIError.server(404, _, _) {
            startNew()
            errorKind = .other
            errorMessage = "That conversation was deleted or isn't available. You can start a new one."
        } catch {
            onSessionEnded(error)
            errorKind = error as? APIError == .network ? .offline : .other
            errorMessage = (error as? LocalizedError)?.errorDescription
        }
    }

    func delete(_ conversation: ConversationRecord) async {
        do {
            try await api.deleteConversation(conversation.id)
            conversations.removeAll { $0.id == conversation.id }
            if conversationId == conversation.id { startNew() }
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription
        }
    }

    func startNew() {
        items = []
        conversationId = nil
        errorMessage = nil
        errorKind = .other
        failedText = nil
        draft = ""
    }

    /// Saves a fact the person explicitly confirmed. Never automatic.
    func saveSuggestion(_ fact: String) async {
        do {
            _ = try await api.saveMemory(fact, fromConversation: conversationId)
            savedSuggestions.insert(fact)
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Couldn't save that. Please try again."
        }
    }
}
