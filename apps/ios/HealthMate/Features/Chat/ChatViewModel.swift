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
    private(set) var items: [ChatItem] = []
    private(set) var conversationId: String?
    private(set) var sending = false
    private(set) var conversations: [ConversationRecord] = []
    /// Last failed message, kept so the person can retry without retyping.
    private(set) var failedText: String?
    var errorMessage: String?
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
        } catch {
            onSessionEnded(error)
            failedText = text
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "The message couldn't be sent. Please try again."
        }
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
        } catch {
            onSessionEnded(error)
        }
    }

    func open(_ conversation: ConversationRecord) async {
        do {
            let detail = try await api.conversation(conversation.id)
            conversationId = detail.conversation.id
            items = detail.messages.map { $0.role == .user ? .user(id: $0.id, text: $0.content) : .assistant($0) }
            errorMessage = nil
            failedText = nil
        } catch {
            onSessionEnded(error)
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
