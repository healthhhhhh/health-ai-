import Foundation

/// In-app destinations. Links from the API (notifications, activity) are web
/// paths like "/reports/<id>"; this maps them to screens, mirroring
/// apps/web/src/lib/links.ts. Unknown or external links map to nil.
public enum AppRoute: Hashable, Sendable {
    case home
    case notifications
    case chat
    case conversation(id: String)
    case reports
    case report(id: String)
    case health
    case metric(TrackedMetric)
    case plans
    case planItem(id: String)
    case care
    case appointment(id: String)
    case timeline
    case profile
    case settings
    case account

    public init?(link: String?) {
        guard let link, link.hasPrefix("/"), !link.hasPrefix("//"),
              let components = URLComponents(string: link) else { return nil }
        let parts = components.path.split(separator: "/").map(String.init)
        guard parts.allSatisfy({ $0.range(of: #"^[\w-]+$"#, options: .regularExpression) != nil }) else { return nil }
        let query = components.queryItems ?? []
        switch (parts.first, parts.count) {
        case ("home", 1): self = .home
        case ("notifications", 1): self = .notifications
        case ("chat", 1):
            if let id = query.first(where: { $0.name == "c" })?.value, !id.isEmpty { self = .conversation(id: id) } else { self = .chat }
        case ("reports", 1): self = .reports
        case ("reports", 2): self = .report(id: parts[1])
        case ("health", 1): self = .health
        case ("health", 2):
            guard let metric = TrackedMetric(rawValue: parts[1]) else { return nil }
            self = .metric(metric)
        case ("plans", 1): self = .plans
        case ("plans", 2): self = .planItem(id: parts[1])
        case ("care", 1): self = .care
        case ("care", 3) where parts[1] == "appointments": self = .appointment(id: parts[2])
        case ("timeline", 1): self = .timeline
        case ("profile", 1): self = .profile
        case ("settings", 1): self = .settings
        case ("settings", 2) where parts[1] == "account": self = .account
        default: return nil
        }
    }

    /// Where a timeline entry opens: its report, conversation, appointment or metric; otherwise the timeline.
    public static func forTimeline(_ event: TimelineEventRecord) -> AppRoute {
        let id = event.sourceId.flatMap { $0.isEmpty ? nil : $0 }
        switch event.eventType {
        case "report", "image": return id.map { .report(id: $0) } ?? .reports
        case "chat": return id.map { .conversation(id: $0) } ?? .chat
        case "appointment": return id.map { .appointment(id: $0) } ?? .care
        case "measurement":
            if let kind = event.payload?["kind"].string, let metric = TrackedMetric(rawValue: kind) { return .metric(metric) }
            return .health
        case "medication": return .plans
        default: return .timeline
        }
    }

    /// The web path for this route (the format links use in the API).
    public var link: String {
        switch self {
        case .home: "/home"
        case .notifications: "/notifications"
        case .chat: "/chat"
        case .conversation(let id): "/chat?c=\(id)"
        case .reports: "/reports"
        case .report(let id): "/reports/\(id)"
        case .health: "/health"
        case .metric(let metric): "/health/\(metric.rawValue)"
        case .plans: "/plans"
        case .planItem(let id): "/plans/\(id)"
        case .care: "/care"
        case .appointment(let id): "/care/appointments/\(id)"
        case .timeline: "/timeline"
        case .profile: "/profile"
        case .settings: "/settings"
        case .account: "/settings/account"
        }
    }
}
