import SwiftUI

/// Hands a question to the AI Health Assistant (the Chat tab) from any screen.
/// Nil outside the tab bar (previews, onboarding), where screens hide the action.
struct AskAssistantAction {
    let perform: (String) -> Void
    func callAsFunction(_ question: String) { perform(question) }
}

private struct AskAssistantKey: EnvironmentKey {
    static let defaultValue: AskAssistantAction? = nil
}

extension EnvironmentValues {
    var askAssistant: AskAssistantAction? {
        get { self[AskAssistantKey.self] }
        set { self[AskAssistantKey.self] = newValue }
    }
}
