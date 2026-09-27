import SwiftUI

enum AppTab: String, CaseIterable, Identifiable {
    case home, chat, health, plans, profile

    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: return "Home"
        case .chat: return "Chat"
        case .health: return "Health"
        case .plans: return "Plans"
        case .profile: return "Profile"
        }
    }

    var systemImage: String {
        switch self {
        case .home: return "house.fill"
        case .chat: return "message.fill"
        case .health: return "heart.fill"
        case .plans: return "checklist"
        case .profile: return "person.fill"
        }
    }
}
