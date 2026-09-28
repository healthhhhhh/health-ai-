import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Stored session tokens. The app keeps them in the Keychain.
public struct SessionTokens: Codable, Equatable, Sendable {
    public var accessToken: String
    public var refreshToken: String
    public var accessExpiresAt: Date

    public init(accessToken: String, refreshToken: String, accessExpiresAt: Date) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.accessExpiresAt = accessExpiresAt
    }
}

public protocol TokenStore: Sendable {
    func load() async -> SessionTokens?
    func save(_ tokens: SessionTokens) async
    func clear() async
}

/// In-memory token store for tests and previews.
public actor InMemoryTokenStore: TokenStore {
    private var tokens: SessionTokens?
    public init(_ tokens: SessionTokens? = nil) { self.tokens = tokens }
    public func load() async -> SessionTokens? { tokens }
    public func save(_ tokens: SessionTokens) async { self.tokens = tokens }
    public func clear() async { tokens = nil }
}

public enum APIError: Error, Equatable, LocalizedError, Sendable {
    /// The session ended; the person needs to sign in again.
    case unauthorized
    case network
    /// The AI couldn't produce an answer. The app must say so rather than improvise.
    case aiUnavailable(String)
    case server(status: Int, code: String, message: String)
    case decoding

    public var errorDescription: String? {
        switch self {
        case .unauthorized: return "Your session has ended. Please sign in again."
        case .network: return "We couldn't reach HealthMate. Check your connection and try again."
        case .aiUnavailable(let message): return message
        case .server(_, _, let message): return message
        case .decoding: return "We received an unexpected response. Please try again."
        }
    }
}

/// HTTP method + path + optional JSON body.
public struct Endpoint: Sendable {
    public var method: String
    public var path: String
    public var query: [URLQueryItem] = []
    public var body: Data?
    public var authenticated = true

    public init(_ method: String, _ path: String, query: [URLQueryItem] = [], body: Data? = nil, authenticated: Bool = true) {
        self.method = method
        self.path = path
        self.query = query
        self.body = body
        self.authenticated = authenticated
    }

    public static func json<T: Encodable>(_ method: String, _ path: String, _ value: T, authenticated: Bool = true) -> Endpoint {
        Endpoint(method, path, body: try? JSONCoding.makeEncoder().encode(value), authenticated: authenticated)
    }
}

/// Typed client for the HealthMate API. Refreshes the access token once on a
/// 401 (single-flight, so parallel requests don't race to rotate the token).
public actor APIClient {
    public let baseURL: URL
    private let session: URLSession
    private let tokens: any TokenStore
    private let now: @Sendable () -> Date
    private var refreshTask: Task<SessionTokens?, Never>?

    public init(baseURL: URL, tokens: any TokenStore, session: URLSession = .shared, now: @escaping @Sendable () -> Date = Date.init) {
        self.baseURL = baseURL
        self.session = session
        self.tokens = tokens
        self.now = now
    }

    public var isSignedIn: Bool {
        get async { await tokens.load() != nil }
    }

    public func store(_ pair: TokenPair) async {
        await tokens.save(SessionTokens(accessToken: pair.accessToken, refreshToken: pair.refreshToken, accessExpiresAt: now().addingTimeInterval(TimeInterval(pair.expiresIn))))
    }

    public func clearSession() async {
        await tokens.clear()
    }

    public func refreshTokenValue() async -> String? {
        await tokens.load()?.refreshToken
    }

    public func send<T: Decodable>(_ endpoint: Endpoint, as type: T.Type = T.self) async throws -> T {
        let data = try await perform(endpoint)
        do {
            return try JSONCoding.makeDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decoding
        }
    }

    public func sendNoContent(_ endpoint: Endpoint) async throws {
        _ = try await perform(endpoint)
    }

    /// Response body as-is (e.g. the data export file).
    public func rawData(_ endpoint: Endpoint) async throws -> Data {
        try await perform(endpoint)
    }

    /// Raw upload to a signed URL (no auth header — the URL is the grant).
    public func upload(_ data: Data, to url: URL, headers: [String: String]) async throws {
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
        let response: URLResponse
        do {
            (_, response) = try await session.upload(for: request, from: data)
        } catch {
            throw APIError.network
        }
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.server(status: (response as? HTTPURLResponse)?.statusCode ?? 0, code: "upload_failed", message: "The upload didn't complete. Please try again.")
        }
    }

    private func perform(_ endpoint: Endpoint, allowRefresh: Bool = true) async throws -> Data {
        var request = try buildRequest(endpoint)
        if endpoint.authenticated {
            guard let current = await validTokens() else { throw APIError.unauthorized }
            request.setValue("Bearer \(current.accessToken)", forHTTPHeaderField: "Authorization")
        }
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.network
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.network }
        if http.statusCode == 401, endpoint.authenticated, allowRefresh {
            guard await refresh() != nil else {
                await tokens.clear()
                throw APIError.unauthorized
            }
            return try await perform(endpoint, allowRefresh: false)
        }
        guard (200..<300).contains(http.statusCode) else { throw Self.mapError(status: http.statusCode, data: data) }
        return data
    }

    private func buildRequest(_ endpoint: Endpoint) throws -> URLRequest {
        var components = URLComponents(url: baseURL.appendingPathComponent(endpoint.path), resolvingAgainstBaseURL: false)
        if !endpoint.query.isEmpty { components?.queryItems = endpoint.query }
        guard let url = components?.url else { throw APIError.network }
        var request = URLRequest(url: url, timeoutInterval: 150)
        request.httpMethod = endpoint.method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body = endpoint.body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return request
    }

    /// Current tokens, refreshed proactively when the access token is about to expire.
    private func validTokens() async -> SessionTokens? {
        guard let current = await tokens.load() else { return nil }
        if current.accessExpiresAt.timeIntervalSince(now()) > 30 { return current }
        return await refresh()
    }

    private func refresh() async -> SessionTokens? {
        if let task = refreshTask { return await task.value }
        let task = Task<SessionTokens?, Never> { [tokens, session, baseURL, now] in
            guard let current = await tokens.load() else { return nil }
            var request = URLRequest(url: baseURL.appendingPathComponent("auth/refresh"))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONEncoder().encode(["refreshToken": current.refreshToken])
            guard let (data, response) = try? await session.data(for: request),
                  let http = response as? HTTPURLResponse, http.statusCode == 200,
                  let pair = try? JSONCoding.makeDecoder().decode(TokenPair.self, from: data)
            else { return nil }
            let next = SessionTokens(accessToken: pair.accessToken, refreshToken: pair.refreshToken, accessExpiresAt: now().addingTimeInterval(TimeInterval(pair.expiresIn)))
            await tokens.save(next)
            return next
        }
        refreshTask = task
        let result = await task.value
        refreshTask = nil
        return result
    }

    static func mapError(status: Int, data: Data) -> APIError {
        struct Envelope: Decodable { struct Body: Decodable { let code: String; let message: String }; let error: Body }
        guard let envelope = try? JSONDecoder().decode(Envelope.self, from: data) else {
            return .server(status: status, code: "unknown", message: "Something went wrong. Please try again.")
        }
        if status == 401 { return .unauthorized }
        if envelope.error.code == "ai_unavailable" || envelope.error.code == "ai_invalid_output" || envelope.error.code == "ai_declined" {
            return .aiUnavailable(envelope.error.message)
        }
        return .server(status: status, code: envelope.error.code, message: envelope.error.message)
    }
}

extension JSONCoding {
    public static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}
