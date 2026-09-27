import Foundation

/// Client for the shared HealthMate REST API (same endpoints as the web app).
/// Authentication (Phase 2) will add a bearer token from the Keychain here.
/// Model/provider API keys never live in the app — AI goes through the backend AI Gateway.
public final class HTTPHealthDataService: HealthDataService {
    public let isSampleData = false
    private let baseURL: URL
    private let session: URLSession

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    public func homeSummary() async throws -> HomeSummary {
        try await request("me/home-summary")
    }

    public func setTask(id: String, completed: Bool) async throws -> PlanTask {
        try await request("tasks/\(id)/\(completed ? "complete" : "uncomplete")", method: "POST")
    }

    public func recordMood(_ mood: Mood) async throws -> MoodCheckIn {
        try await request("check-ins/mood", method: "POST", body: try JSONEncoder().encode(["mood": mood.rawValue]))
    }

    private func request<T: Decodable>(_ path: String, method: String = "GET", body: Data? = nil) async throws -> T {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = method
        req.httpBody = body
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("application/json", forHTTPHeaderField: "Accept")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw HealthDataError.network
        }
        guard let http = response as? HTTPURLResponse else { throw HealthDataError.network }
        switch http.statusCode {
        case 200..<300: break
        case 404: throw HealthDataError.notFound
        default: throw HealthDataError.server(status: http.statusCode)
        }
        do {
            return try JSONCoding.makeDecoder().decode(T.self, from: data)
        } catch {
            throw HealthDataError.decoding
        }
    }
}

/// JSON coding matching the web/backend contract (ISO-8601 dates, with or without fractional seconds).
public enum JSONCoding {
    public static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let string = try container.decode(String.self)
            if let date = parseISO8601(string) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid ISO-8601 date: \(string)")
        }
        return decoder
    }

    public static func parseISO8601(_ string: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: string) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: string)
    }
}
