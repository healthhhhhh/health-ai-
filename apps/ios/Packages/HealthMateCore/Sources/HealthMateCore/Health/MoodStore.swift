import Foundation

/// Mood check-ins stay on this device.
public protocol MoodStoring: Sendable {
    func latest() async -> MoodCheckIn?
    func save(_ checkIn: MoodCheckIn) async
}

public actor UserDefaultsMoodStore: MoodStoring {
    private let defaults: UserDefaults
    private let key: String

    public init(defaults: UserDefaults = .standard, key: String = "hm.mood.latest") {
        self.defaults = defaults
        self.key = key
    }

    public func latest() -> MoodCheckIn? {
        guard let data = defaults.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(MoodCheckIn.self, from: data)
    }

    public func save(_ checkIn: MoodCheckIn) {
        if let data = try? JSONEncoder().encode(checkIn) { defaults.set(data, forKey: key) }
    }
}
