import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Routes the app's API traffic to `PreviewBackend` (Preview mode, Phase 1):
/// no server, no network. The app uses `PreviewURLProtocol.baseURL` and
/// `makeSession()` instead of the real API; everything else is unchanged.
public final class PreviewURLProtocol: URLProtocol, @unchecked Sendable {
    public static let host = "preview.healthmate.local"
    public static let baseURL = URL(string: "https://preview.healthmate.local/v1")!

    /// The backend and debug state in use (replaceable in tests).
    nonisolated(unsafe) public static var backend: PreviewBackend = .shared
    nonisolated(unsafe) public static var state: @Sendable () -> PreviewState = { .normal }

    public static func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [PreviewURLProtocol.self]
        return URLSession(configuration: configuration)
    }

    override public class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == host || request.url?.scheme == "preview-upload"
    }

    override public class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    private var cancelled = false

    override public func startLoading() {
        let state = Self.state()
        let request = self.request
        let backend = Self.backend
        DispatchQueue.global().asyncAfter(deadline: .now() + state.latency) { [weak self] in
            guard let self, !self.cancelled, let url = request.url else { return }
            if state == .offline {
                self.client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
                return
            }
            let response = Self.respond(to: request, url: url, backend: backend, state: state)
            let http = HTTPURLResponse(url: url, statusCode: response.status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": response.contentType])!
            self.client?.urlProtocol(self, didReceive: http, cacheStoragePolicy: .notAllowed)
            if let body = response.body { self.client?.urlProtocol(self, didLoad: body) }
            self.client?.urlProtocolDidFinishLoading(self)
        }
    }

    override public func stopLoading() { cancelled = true }

    private struct Reply { let status: Int; let body: Data?; let contentType: String }

    private static func respond(to request: URLRequest, url: URL, backend: PreviewBackend, state: PreviewState) -> Reply {
        // Uploads to the "signed URL": the file stays on the device; nothing is stored or analysed.
        if url.scheme == "preview-upload" { return Reply(status: 200, body: nil, contentType: "application/json") }
        // Original files: a sample PDF (clearly marked as an example).
        if url.path.hasPrefix("/files/") {
            let data = Bundle.module.url(forResource: "example-report", withExtension: "pdf").flatMap { try? Data(contentsOf: $0) }
            return Reply(status: data == nil ? 404 : 200, body: data, contentType: "application/pdf")
        }
        var path = url.path
        if path.hasPrefix("/v1/") { path.removeFirst(4) } else if path == "/v1" { path = "" }
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let query = Dictionary((components?.queryItems ?? []).map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { $1 })
        let response = backend.handle(
            method: request.httpMethod ?? "GET",
            path: path,
            query: query,
            body: body(of: request),
            authorization: request.value(forHTTPHeaderField: "Authorization"),
            state: state
        )
        return Reply(status: response.status, body: response.body, contentType: "application/json")
    }

    /// URLSession moves bodies into a stream before protocols see them.
    private static func body(of request: URLRequest) -> Data? {
        if let data = request.httpBody { return data }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 16_384)
        while stream.hasBytesAvailable {
            let read = stream.read(&buffer, maxLength: buffer.count)
            if read <= 0 { break }
            data.append(buffer, count: read)
        }
        return data
    }
}
