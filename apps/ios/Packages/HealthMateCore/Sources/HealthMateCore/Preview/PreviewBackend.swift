import Foundation

/// Debug states for Preview mode (same set as the web Preview panel).
public enum PreviewState: String, CaseIterable, Identifiable, Sendable {
    case normal, loading, slow, empty, error, offline, permission
    case aiUnavailable = "ai_unavailable"

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .normal: return "Normal"
        case .loading: return "Loading"
        case .slow: return "Slow network"
        case .empty: return "Empty"
        case .error: return "Server error"
        case .offline: return "Offline"
        case .permission: return "Permissions off"
        case .aiUnavailable: return "AI unavailable"
        }
    }

    public var detail: String {
        switch self {
        case .normal: return "Sample account with realistic data"
        case .loading: return "Every request takes 3 seconds"
        case .slow: return "Every request takes about a second"
        case .empty: return "A new account with nothing added yet"
        case .error: return "Requests fail with a server error"
        case .offline: return "The app can't reach HealthMate"
        case .permission: return "Consents and Apple Health are turned off"
        case .aiUnavailable: return "The assistant can't answer; everything else works"
        }
    }

    /// Simulated network delay.
    public var latency: TimeInterval {
        switch self {
        case .loading: return 3
        case .slow: return 0.9
        default: return 0.12
        }
    }
}

/// An email HealthMate "sent" in Preview mode (shown in the Preview inbox).
public struct PreviewEmail: Identifiable, Equatable, Sendable {
    public let id: String
    public let to: String
    public let subject: String
    public let body: String
    /// In-app action, e.g. "verify-email?token=…" or "reset-password?token=…".
    public let action: String
    public let actionLabel: String
    public let sentAt: Date
}

public struct PreviewResponse: Sendable {
    public let status: Int
    public let body: Data?
}

/// The HealthMate REST API answered on the device from the sample account
/// (Preview mode, Phase 1). Same paths and response shapes as services/api
/// and the web Preview API, so screens don't change when Phase 2 switches to
/// the real server. Replies and analyses are fixed, labelled samples — never
/// a real AI or a real analysis.
public final class PreviewBackend: @unchecked Sendable {
    public static let shared = PreviewBackend()
    public static let sampleNotice = "Sample response in Preview mode — not a real AI and not medical advice."
    public static let sampleEmail = "alex.morgan@example.com"

    private struct Pending { let email: String; let firstName: String; let lastName: String; let token: String }

    private let lock = NSLock()
    private var sessions: [String: JSONValue] = [:]
    private var processing: [String: [String: Date]] = [:]
    /// Photo notes waiting for their sample result (document id → note), for the triage floor.
    private var imageNotes: [String: String] = [:]
    private var pending: [String: Pending] = [:]
    private var resets: [String: String] = [:]
    private var emails: [PreviewEmail] = []
    private let now: @Sendable () -> Date
    private let makeAccount: @Sendable () -> JSONValue

    public init(now: @escaping @Sendable () -> Date = { Date() }, makeAccount: @escaping @Sendable () -> JSONValue = { SampleAccount.load() }) {
        self.now = now
        self.makeAccount = makeAccount
    }

    /// Emails sent to an address, newest first.
    public func inbox(for email: String) -> [PreviewEmail] {
        lock.lock(); defer { lock.unlock() }
        let address = normalized(email)
        return emails.filter { $0.to == address }
    }

    /// All emails, newest first (the Preview inbox shows these).
    public var allEmails: [PreviewEmail] {
        lock.lock(); defer { lock.unlock() }
        return emails
    }

    /// Throws away changes: the next request starts from the sample account again.
    public func reset() {
        lock.lock(); defer { lock.unlock() }
        sessions.removeAll()
        processing.removeAll()
    }

    /// Handles one request. `path` is relative to `/v1`, e.g. "me" or "documents/<id>/process".
    public func handle(method: String, path: String, query: [String: String] = [:], body: Data?, authorization: String?, state: PreviewState) -> PreviewResponse {
        lock.lock(); defer { lock.unlock() }
        let segments = path.split(separator: "/").map { String($0).removingPercentEncoding ?? String($0) }
        let input = JSONValue.decode(body)
        let route = segments.joined(separator: "/")
        // "AI unavailable": the assistant can't answer; everything else (and on-device emergency triage) still works.
        if state == .aiUnavailable {
            if method == "GET", route == "meta" { return json(["apiVersion": 1, "ai": ["available": false, "demo": true], "preview": true]) }
            if method == "POST", route == "conversations" || (segments.first == "conversations" && segments.last == "messages") {
                return fail(503, "ai_unavailable", "The AI Health Assistant is unavailable right now. Please try again later.")
            }
        }
        if let response = publicRoute(method: method, segments: segments, input: input, query: query) { return response }
        if state == .error, !["me", "meta", "me/account"].contains(route) {
            return fail(500, "internal", "Something went wrong on our side. Please try again.")
        }
        guard let sid = sessionId(from: authorization) else { return fail(401, "unauthorized", "Please sign in again.") }
        if sessions[sid] == nil { sessions[sid] = makeAccount() } // rebuilt after an app restart
        settleProcessing(sid)
        var ctx = Context(sid: sid, account: sessions[sid]!, state: state, input: input, query: query, now: PreviewClock.iso(now()))
        let response = authedRoute(method: method, s: segments, ctx: &ctx) ?? fail(404, "not_found", "Not found.")
        if sessions[sid] != nil { sessions[sid] = ctx.account }
        return response
    }

    // MARK: - Helpers

    private struct Context {
        let sid: String
        var account: JSONValue
        let state: PreviewState
        let input: JSONValue
        let query: [String: String]
        let now: String
        var ended = false

        /// What reads see: the account, or an empty / permissions-off version of it.
        var view: JSONValue {
            switch state {
            case .empty:
                var v = account
                v["profile"]["conditions"] = []
                v["profile"]["allergies"] = []
                v["profile"]["medications"] = []
                for key in ["memories", "conversations", "documents", "timeline", "moods", "providers", "appointments", "symptoms", "notifications"] { v[key] = [] }
                v["measurements"] = ["latest": [], "daily": [:]]
                v["plan"]["items"] = []
                v["plan"]["completions"] = []
                v["healthKit"] = ["status": "never_connected", "deviceName": nil, "scopes": [], "connectedAt": nil, "disconnectedAt": nil, "lastSyncAt": nil]
                return v
            case .permission:
                var v = account
                v["consents"] = .array(account["consents"].array.map { var c = $0; c["granted"] = false; return c })
                v["healthKit"]["status"] = "disconnected"
                v["measurements"] = ["latest": [], "daily": [:]]
                return v
            default:
                return account
            }
        }
    }

    private func json(_ value: JSONValue, _ status: Int = 200) -> PreviewResponse { PreviewResponse(status: status, body: value.encoded()) }
    private func noContent() -> PreviewResponse { PreviewResponse(status: 204, body: nil) }
    private func fail(_ status: Int, _ code: String, _ message: String) -> PreviewResponse { json(["error": ["code": .string(code), "message": .string(message)]], status) }
    private func newId() -> String { UUID().uuidString.lowercased() }
    private func randomToken() -> String { String(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(20)) }
    private func normalized(_ email: String) -> String { email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
    private func text(_ value: JSONValue, _ max: Int = 2000) -> String { String((value.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines).prefix(max)) }
    private func optionalText(_ value: JSONValue, _ max: Int = 2000) -> JSONValue {
        let t = text(value, max)
        return t.isEmpty ? .null : .string(t)
    }

    private func tokens(_ sid: String, userId: String) -> JSONValue {
        ["userId": .string(userId), "accessToken": .string("pv.\(sid)"), "refreshToken": .string("pvr.\(sid)"), "expiresIn": 604_800]
    }

    private func sessionId(from authorization: String?) -> String? {
        guard let token = authorization?.replacingOccurrences(of: "Bearer ", with: "") else { return nil }
        if token.hasPrefix("pv.") { return String(token.dropFirst(3)) }
        return nil
    }

    private func createSession(email: String? = nil, firstName: String? = nil, lastName: String? = nil, method: String? = nil, onboarded: Bool = true) -> (String, JSONValue) {
        let sid = randomToken()
        var account = makeAccount()
        if let email, !email.isEmpty { account["account"]["email"] = .string(normalized(email)) }
        if let firstName, !firstName.isEmpty {
            account["profile"]["profile"]["firstName"] = .string(firstName)
            account["profile"]["profile"]["lastName"] = .string(lastName ?? "")
        }
        if let method { account["account"]["signInMethods"] = [.string(method)] }
        account["account"]["onboardingCompleted"] = .bool(onboarded)
        if !onboarded {
            // A brand-new account picks its own goals and privacy choices during onboarding.
            account["profile"]["profile"]["goals"] = []
            account["consents"] = .array(account["consents"].array.map { var c = $0; c["granted"] = false; return c })
        }
        sessions[sid] = account
        return (sid, account)
    }

    private func sendEmail(to: String, subject: String, body: String, action: String, actionLabel: String) {
        emails.insert(PreviewEmail(id: newId(), to: normalized(to), subject: subject, body: body, action: action, actionLabel: actionLabel, sentAt: now()), at: 0)
        if emails.count > 50 { emails.removeLast() }
    }

    public static let failureReason = "We couldn't open this file. It may be damaged or password-protected. Try saving it again, or upload a photo of the pages."

    /// The real API's deterministic floor for photo checks: an emergency note always
    /// results in emergency guidance, and an urgent note in at least urgent guidance.
    static func withNoteTriage(_ result: JSONValue, note: String?) -> JSONValue {
        guard let note, !note.isEmpty else { return result }
        var result = result
        switch SafetyEngine.triage(note).level {
        case .emergency: result["careUrgency"] = "emergency"
        case .urgent where result["careUrgency"].string != "emergency": result["careUrgency"] = "urgent"
        default: break
        }
        return result
    }

    /// Sample analyses finish a few seconds after upload.
    private func settleProcessing(_ sid: String) {
        guard var pendingDocs = processing[sid], var account = sessions[sid] else { return }
        let current = now()
        for (id, readyAt) in pendingDocs where readyAt <= current {
            pendingDocs[id] = nil
            var docs = account["documents"].array
            guard let index = docs.firstIndex(where: { $0["id"].string == id }) else { continue }
            var doc = docs[index]
            let analyses = account["sampleAnalyses"]
            let filename = doc["filename"].string ?? ""
            // File names steer the sample outcome so every result state can be tried in Preview (same as web).
            let damaged = filename.range(of: "damaged|corrupt|fail", options: [.regularExpression, .caseInsensitive]) != nil
            let unclear = filename.range(of: "blur|unreadable|dark", options: [.regularExpression, .caseInsensitive]) != nil
            let isImage = doc["kind"].string == "image"
            if damaged {
                doc["status"] = "failed"
                doc["failureReason"] = .string(Self.failureReason)
            } else {
                doc["result"] = isImage ? Self.withNoteTriage(unclear ? analyses["poorImage"] : analyses["image"], note: imageNotes.removeValue(forKey: id)) : (unclear ? analyses["unreadableReport"] : analyses["report"])
                doc["status"] = "ready"
            }
            doc["processedAt"] = .string(PreviewClock.iso(current))
            docs[index] = doc
            account["documents"] = .array(docs)
            account["notifications"] = .array([[
                "id": .string(newId()), "category": "report",
                "title": .string(damaged ? "Couldn't read: \(filename)" : "Summary ready: \(filename)"),
                "body": .string(damaged ? "Tap to see what to try next." : "Tap to see the sample summary."),
                "createdAt": .string(PreviewClock.iso(current)), "readAt": nil, "link": .string("/reports/\(id)"), "aiGenerated": false,
            ]] + account["notifications"].array)
            account["timeline"] = .array([[
                "id": .string(newId()), "eventType": .string(isImage ? "image" : "report"), "title": .string("\(filename) \(isImage ? "checked" : "analysed")"),
                "occurredAt": .string(PreviewClock.iso(current)), "sourceType": "document", "sourceId": .string(id),
            ]] + account["timeline"].array)
        }
        processing[sid] = pendingDocs
        sessions[sid] = account
    }

    // MARK: - Public routes

    private func publicRoute(method: String, segments: [String], input: JSONValue, query: [String: String]) -> PreviewResponse? {
        let route = segments.joined(separator: "/")
        if method == "GET", route == "meta" { return json(["apiVersion": 1, "ai": ["available": true, "demo": true], "preview": true]) }
        guard method == "POST", segments.first == "auth" else { return nil }
        let email = normalized(text(input["email"], 254))
        let password = input["password"].string ?? ""

        switch route {
        case "auth/register":
            guard email.contains("@") else { return fail(400, "validation_failed", "Enter a valid email address.") }
            guard password.count >= 8 else { return fail(400, "validation_failed", "Use at least 8 characters for your password.") }
            guard email != Self.sampleEmail else { return fail(409, "conflict", "An account with this email already exists. Try signing in.") }
            let firstName = text(input["firstName"], 80).isEmpty ? "Alex" : text(input["firstName"], 80)
            let entry = Pending(email: email, firstName: firstName, lastName: text(input["lastName"], 80), token: randomToken())
            pending[email] = entry
            sendEmail(to: email, subject: "Confirm your email for HealthMate", body: "Hi \(firstName), confirm your email address to finish creating your HealthMate account.", action: "verify-email?token=\(entry.token)", actionLabel: "Confirm email address")
            return json(["confirmationRequired": true], 202)
        case "auth/resend-verification":
            if let entry = pending[email] {
                sendEmail(to: email, subject: "Confirm your email for HealthMate", body: "Here's a new link to confirm your email address.", action: "verify-email?token=\(entry.token)", actionLabel: "Confirm email address")
            }
            return json(["ok": true], 202)
        case "auth/verify-email":
            let token = text(input["token"], 200)
            guard let entry = pending.values.first(where: { $0.token == token }) else {
                return fail(400, "invalid_token", "This link is invalid or has already been used. Sign in, or request a new link.")
            }
            pending[entry.email] = nil
            let (sid, _) = createSession(email: entry.email, firstName: entry.firstName, lastName: entry.lastName, onboarded: false)
            return json(tokens(sid, userId: entry.email))
        case "auth/login":
            guard password.count >= 8, password != "wrong-password" else { return fail(401, "unauthorized", "Email or password is incorrect.") }
            guard pending[email] == nil else { return fail(401, "email_not_confirmed", "Confirm your email address first — check your inbox for the link.") }
            let (sid, _) = createSession(email: email.isEmpty ? Self.sampleEmail : email)
            return json(tokens(sid, userId: email))
        case "auth/oauth":
            guard let provider = input["provider"].string, ["google", "apple"].contains(provider) else { return fail(400, "validation_failed", "Unknown sign-in provider.") }
            let (sid, _) = createSession(method: provider, onboarded: false)
            var body = tokens(sid, userId: Self.sampleEmail)
            body["isNewUser"] = true
            return json(body)
        case "auth/refresh":
            let token = text(input["refreshToken"], 400)
            guard token.hasPrefix("pvr.") else { return fail(401, "unauthorized", "Please sign in again.") }
            let sid = String(token.dropFirst(4))
            return json(["accessToken": .string("pv.\(sid)"), "refreshToken": .string(token), "expiresIn": 604_800])
        case "auth/logout":
            return noContent()
        case "auth/password-reset":
            if email.contains("@") {
                let token = randomToken()
                resets[token] = email
                sendEmail(to: email, subject: "Reset your HealthMate password", body: "Someone asked to reset the password for this account. If it was you, choose a new password.", action: "reset-password?token=\(token)", actionLabel: "Choose a new password")
            }
            return json(["ok": true], 202)
        case "auth/password-reset/complete":
            guard password.count >= 8 else { return fail(400, "validation_failed", "Choose a longer or less common password.") }
            let token = text(input["accessToken"], 400)
            guard resets.removeValue(forKey: token) != nil else { return fail(401, "unauthorized", "This reset link is invalid or has expired. Request a new one.") }
            return noContent()
        default:
            return nil
        }
    }

    // MARK: - Age (production rules)

    /// Routes a restricted account can still use (the API's `@AgeExempt` routes).
    private static let ageExemptRoutes: Set<String> = ["me/account", "me/age", "me/consents", "me/export", "me/delete", "me/identities", "me/devices", "auth/change-password"]
    private static let ageRefusals = [
        "age_required": "Add your date of birth to continue.",
        "age_review": "We need to check your age before you can continue. Please contact support.",
        "age_not_eligible": "HealthMate isn't available for your age.",
    ]

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    /// Stand-in for POST /v1/me/age: the band comes from the date, under-13s are restricted,
    /// and a restricted account that answers again with an older date is held for review.
    private func assessAge(_ value: JSONValue, ctx: inout Context) -> PreviewResponse {
        let day = value.string ?? ""
        guard day.count == 10, let date = Self.dayFormatter.date(from: day), Self.dayFormatter.string(from: date) == day else {
            return fail(400, "validation_failed", "Enter a real date of birth as YYYY-MM-DD.")
        }
        let today = now()
        if date > today { return fail(400, "validation_failed", "A date of birth can't be in the future.") }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
        let years = calendar.dateComponents([.year], from: date, to: today).year ?? 0
        if years > 130 { return fail(400, "validation_failed", "Check the date of birth — it's too far in the past.") }
        let band = years < 13 ? "under_13" : years < 16 ? "13_15" : years < 18 ? "16_17" : "adult"
        let current = ctx.account["account"]["ageEligibility"].string
        let restricted = current == "age_not_eligible" || current == "age_review"
        let assessedAt = JSONValue.string(ctx.now)
        if restricted, band != "under_13" {
            ctx.account["account"]["ageStatus"] = "review"
            ctx.account["account"]["ageEligibility"] = "age_review"
        } else if band == "under_13" {
            ctx.account["account"]["ageBand"] = "under_13"
            ctx.account["account"]["ageStatus"] = "blocked_under_13"
            ctx.account["account"]["ageEligibility"] = "age_not_eligible"
            if ctx.account["account"]["ageDeletionScheduledAt"].isNull {
                ctx.account["account"]["ageDeletionScheduledAt"] = .string(PreviewClock.iso(today.addingTimeInterval(72 * 3600)))
            }
        } else {
            ctx.account["account"]["ageBand"] = .string(band)
            ctx.account["account"]["ageStatus"] = "in_scope"
            ctx.account["account"]["ageEligibility"] = "eligible"
        }
        ctx.account["account"]["ageAssessedAt"] = assessedAt
        let summary = ctx.account["account"]
        return json([
            "ageBand": summary["ageBand"],
            "ageStatus": summary["ageStatus"],
            "assessedAt": assessedAt,
            "outcome": .string(restricted && band != "under_13" ? "review" : "applied"),
            "eligibility": summary["ageEligibility"],
            "deletionScheduledAt": summary["ageDeletionScheduledAt"],
        ])
    }

    // MARK: - Signed-in routes

    // swiftlint:disable:next cyclomatic_complexity function_body_length
    private func authedRoute(method: String, s: [String], ctx: inout Context) -> PreviewResponse? {
        let a = s.first ?? "", b = s.count > 1 ? s[1] : nil, c = s.count > 2 ? s[2] : nil
        let input = ctx.input
        let view = ctx.view

        // Age gate (production's AGE_ENFORCEMENT=enforce): a restricted account can only use account controls.
        if let eligibility = ctx.account["account"]["ageEligibility"].string, eligibility != "eligible",
           !Self.ageExemptRoutes.contains(s.prefix(2).joined(separator: "/")) {
            return fail(403, eligibility, Self.ageRefusals[eligibility] ?? "HealthMate isn't available for your age.")
        }
        if a == "me", b == "age", method == "POST" { return assessAge(input["dateOfBirth"], ctx: &ctx) }

        // Account & profile
        if a == "auth", b == "change-password", method == "POST" {
            if input["currentPassword"].string == "wrong-password" { return fail(403, "forbidden", "Your current password is incorrect.") }
            if text(input["newPassword"]).count < 8 { return fail(400, "validation_failed", "Use at least 8 characters for your new password.") }
            return noContent()
        }
        if a == "me" {
            if b == nil, method == "GET" { return json(view["profile"]) }
            if b == "account", method == "GET" {
                var summary = ctx.account["account"]
                summary["firstName"] = ctx.account["profile"]["profile"]["firstName"]
                summary["lastName"] = ctx.account["profile"]["profile"]["lastName"]
                return json(summary)
            }
            if b == "onboarding", method == "POST" { ctx.account["account"]["onboardingCompleted"] = true; return noContent() }
            if b == "profile", method == "PATCH" {
                for key in ["firstName", "lastName"] where input[key].string != nil { ctx.account["profile"]["profile"][key] = .string(text(input[key], 80)) }
                for key in ["dateOfBirth", "sex", "timeZone"] where input.object[key] != nil { ctx.account["profile"]["profile"][key] = optionalText(input[key], 64) }
                if input.object["heightCm"] != nil { ctx.account["profile"]["profile"]["heightCm"] = input["heightCm"].double.map { .number($0) } ?? .null }
                if case .array(let goals) = input["goals"] { ctx.account["profile"]["profile"]["goals"] = .array(Array(goals.filter { $0.string != nil }.prefix(10))) }
                if let units = input["unitSystem"].string, ["metric", "imperial"].contains(units) { ctx.account["profile"]["profile"]["unitSystem"] = .string(units) }
                return json(ctx.account["profile"]["profile"])
            }
            if b == "conditions", c == nil, method == "POST" {
                let id = newId()
                ctx.account["profile"]["conditions"].items.append(["id": .string(id), "name": .string(text(input["name"], 120)), "status": .string(input["status"].string == "resolved" ? "resolved" : "active"), "source": "user_reported", "notes": optionalText(input["notes"], 500)])
                return json(["id": .string(id)], 201)
            }
            if b == "allergies", c == nil, method == "POST" {
                let id = newId()
                ctx.account["profile"]["allergies"].items.append(["id": .string(id), "substance": .string(text(input["substance"], 120)), "reaction": optionalText(input["reaction"], 200), "severity": optionalText(input["severity"], 20), "source": "user_reported"])
                return json(["id": .string(id)], 201)
            }
            if b == "medications", c == nil, method == "POST" {
                let id = newId()
                // Stored exactly as entered — never generated or changed.
                ctx.account["profile"]["medications"].items.append(["id": .string(id), "name": .string(text(input["name"], 120)), "instruction": .string(input["instruction"].string ?? ""), "source": .string(input["source"].string == "clinician_provided" ? "clinician_provided" : "user_reported"), "active": true])
                return json(["id": .string(id)], 201)
            }
            if b == "medications", let id = c, method == "PATCH" {
                guard let index = ctx.account["profile"]["medications"].array.firstIndex(where: { $0["id"].string == id }) else { return fail(404, "not_found", "Medication not found.") }
                ctx.account["profile"]["medications"].items[index]["active"] = .bool(input["active"].bool == true)
                return noContent()
            }
            if let collection = b, ["conditions", "allergies", "medications"].contains(collection), let id = c, method == "DELETE" {
                guard let index = ctx.account["profile"][collection].array.firstIndex(where: { $0["id"].string == id }) else { return fail(404, "not_found", "Not found.") }
                ctx.account["profile"][collection].items.remove(at: index)
                return noContent()
            }
            if b == "consents", method == "GET" { return json(.array(view["consents"].array.map { var x = $0; x["updatedAt"] = .string(ctx.now); return x })) }
            if b == "consents", method == "POST" {
                guard let index = ctx.account["consents"].array.firstIndex(where: { $0["kind"] == input["kind"] }) else { return fail(400, "validation_failed", "Unknown consent.") }
                ctx.account["consents"].items[index]["granted"] = .bool(input["granted"].bool == true)
                return noContent()
            }
            if b == "notification-preferences", method == "GET" { return json(ctx.account["notificationPreferences"]) }
            if b == "notification-preferences", method == "PUT" {
                for (key, value) in input.object { ctx.account["notificationPreferences"][key] = value }
                return json(ctx.account["notificationPreferences"])
            }
            if b == "export", method == "GET" {
                var data = ctx.account.object
                for key in ["replies", "fallbackReply", "sampleAnalyses"] { data[key] = nil }
                data["exportedAt"] = .string(ctx.now)
                data["format"] = "healthmate-export-v2"
                data["preview"] = true
                return json(.object(data))
            }
            if b == "delete", method == "POST" {
                // Like the API: accounts without a password (Google / Apple only) may type DELETE instead.
                if input["confirm"].string == "DELETE" {
                    if ctx.account["account"]["signInMethods"].array.contains(.string("password")) {
                        return fail(403, "forbidden", "Confirm with your password instead.")
                    }
                    sessions[ctx.sid] = nil
                    return noContent()
                }
                let password = input["password"].string ?? ""
                if password == "wrong-password" || password.count < 8 { return fail(403, "forbidden", "Password is incorrect.") }
                sessions[ctx.sid] = nil
                return noContent()
            }
        }

        // Health memory
        if a == "memories" {
            // Same lifecycle as the API (Phase 2C): temporal status is derived; excluded facts are kept.
            let today = String(ctx.now.prefix(10))
            func withStatus(_ memory: JSONValue) -> JSONValue {
                var m = memory
                let ended = m["endedOn"].string.map { $0 <= today } ?? false
                m["temporalStatus"] = .string(m["status"].string == "superseded" ? "superseded" : ended ? "historical" : "current")
                if m["aiExcluded"].bool == nil { m["aiExcluded"] = .bool(false) }
                return m
            }
            if b == nil, method == "GET" {
                let q = (ctx.query["q"] ?? "").lowercased()
                let status = ctx.query["status"]
                return json(.array(view["memories"].array.map(withStatus).filter {
                    (q.isEmpty || ($0["fact"].string ?? "").lowercased().contains(q)) && (status == nil || status == "all" || $0["temporalStatus"].string == status)
                }))
            }
            if b == nil, method == "POST" {
                let memory: JSONValue = ["id": .string(newId()), "fact": .string(text(input["fact"], 500)), "source": .string(text(input["source"], 40).isEmpty ? "user_entry" : text(input["source"], 40)), "status": .string(input["status"].string == "user_confirmed" ? "user_confirmed" : "user_reported"), "createdAt": .string(ctx.now)]
                ctx.account["memories"].items.insert(memory, at: 0)
                return json(withStatus(memory), 201)
            }
            if b == nil, method == "DELETE" {
                guard input["confirm"].string == "delete all memories" else { return fail(400, "validation_failed", "Check these fields: confirm.") }
                let removed = ctx.account["memories"].array.count
                ctx.account["memories"] = .array([])
                return json(["removed": .number(Double(removed))])
            }
            if let id = b {
                guard let index = ctx.account["memories"].array.firstIndex(where: { $0["id"].string == id }) else { return fail(404, "not_found", "Memory not found.") }
                if c == "end", method == "POST" {
                    ctx.account["memories"].items[index]["endedOn"] = .string(input["endedOn"].string ?? today)
                    return json(withStatus(ctx.account["memories"].array[index]))
                }
                if c == nil, method == "PATCH" {
                    if let fact = input["fact"].string, !fact.isEmpty { ctx.account["memories"].items[index]["fact"] = .string(text(input["fact"], 500)) }
                    // Only the person's explicit action confirms a memory; choosing whether the AI uses it doesn't.
                    if input["confirm"].bool == true || input["fact"].string != nil { ctx.account["memories"].items[index]["status"] = "user_confirmed" }
                    if let excluded = input["aiExcluded"].bool { ctx.account["memories"].items[index]["aiExcluded"] = .bool(excluded) }
                    return json(withStatus(ctx.account["memories"].array[index]))
                }
                if method == "DELETE" { ctx.account["memories"].items.remove(at: index); return noContent() }
            }
        }

        // Chat
        if a == "conversations" {
            if b == nil, method == "GET" {
                let list = view["conversations"].array.map { $0["conversation"] }.sorted { ($0["updatedAt"].string ?? "") > ($1["updatedAt"].string ?? "") }
                return json(.array(list))
            }
            if b == nil, method == "POST" {
                let message = text(input["message"], 4000)
                guard !message.isEmpty else { return fail(400, "validation_failed", "Type a message first.") }
                let title = String(message.split(whereSeparator: \.isWhitespace).joined(separator: " ").prefix(60))
                let id = newId()
                let detail: JSONValue = ["conversation": ["id": .string(id), "title": .string(title), "createdAt": .string(ctx.now), "updatedAt": .string(ctx.now)], "messages": .array(exchange(ctx.account, message, now: ctx.now))]
                ctx.account["conversations"].items.insert(detail, at: 0)
                ctx.account["timeline"].items.insert(["id": .string(newId()), "eventType": "chat", "title": .string("AI chat: \(title)"), "occurredAt": .string(ctx.now), "sourceType": "user_entered", "sourceId": .string(id)], at: 0)
                return json(detail, 201)
            }
            if let id = b {
                guard let index = view["conversations"].array.firstIndex(where: { $0["conversation"]["id"].string == id }) else { return fail(404, "not_found", "Conversation not found.") }
                if c == nil, method == "GET" { return json(view["conversations"].array[index]) }
                if c == "messages", method == "POST" {
                    let message = text(input["message"], 4000)
                    guard !message.isEmpty else { return fail(400, "validation_failed", "Type a message first.") }
                    let messages = exchange(ctx.account, message, now: ctx.now)
                    ctx.account["conversations"].items[index]["messages"].items.append(contentsOf: messages)
                    ctx.account["conversations"].items[index]["conversation"]["updatedAt"] = .string(ctx.now)
                    return json(["messages": .array(messages)], 201)
                }
                if c == nil, method == "PATCH" {
                    let title = text(input["title"], 80)
                    if !title.isEmpty { ctx.account["conversations"].items[index]["conversation"]["title"] = .string(title) }
                    return json(ctx.account["conversations"].array[index]["conversation"])
                }
                if c == nil, method == "DELETE" { ctx.account["conversations"].items.remove(at: index); return noContent() }
            }
        }

        // Reports & photos
        if a == "documents" {
            if b == nil, method == "GET" {
                let kind = ctx.query["kind"]
                let list = view["documents"].array.filter { kind == nil || $0["kind"].string == kind }.sorted { ($0["createdAt"].string ?? "") > ($1["createdAt"].string ?? "") }
                return json(.array(list))
            }
            if b == nil, method == "POST" {
                let kind = input["kind"].string == "image" ? "image" : "report"
                let contentType = text(input["contentType"], 100)
                let allowed = kind == "image" ? ["image/jpeg", "image/png"] : ["application/pdf", "image/jpeg", "image/png"]
                guard allowed.contains(contentType) else { return fail(415, "unsupported_media_type", kind == "image" ? "Upload a JPG or PNG photo." : "Upload a PDF, JPG or PNG.") }
                let byteSize = input["byteSize"].double ?? 0
                guard byteSize > 0, byteSize <= 20 * 1024 * 1024 else { return fail(413, "payload_too_large", "Files must be smaller than 20 MB.") }
                let id = newId()
                let doc: JSONValue = [
                    "id": .string(id), "kind": .string(kind), "purpose": kind == "image" ? (input["purpose"].isNull ? "other" : input["purpose"]) : .null,
                    "filename": .string(text(input["filename"], 255).isEmpty ? "upload" : text(input["filename"], 255)), "contentType": .string(contentType),
                    "byteSize": .number(byteSize), "status": "awaiting_upload", "failureReason": nil, "result": nil, "createdAt": .string(ctx.now), "processedAt": nil,
                ]
                ctx.account["documents"].items.insert(doc, at: 0)
                return json(["document": doc, "upload": ["method": "PUT", "url": .string("preview-upload://\(id)"), "headers": ["Content-Type": .string(contentType)]]], 201)
            }
            if let id = b {
                guard let index = view["documents"].array.firstIndex(where: { $0["id"].string == id }) else { return fail(404, "not_found", "File not found.") }
                if c == "process", method == "POST" {
                    ctx.account["documents"].items[index]["status"] = "processing"
                    processing[ctx.sid, default: [:]][id] = now().addingTimeInterval(4)
                    if let note = input["note"].string, !note.isEmpty { imageNotes[id] = String(note.prefix(500)) }
                    return json(ctx.account["documents"].array[index], 202)
                }
                if c == "file", method == "GET" {
                    let isImage = (view["documents"].array[index]["contentType"].string ?? "").hasPrefix("image/")
                    return json(["url": .string(isImage ? "https://preview.healthmate.local/files/example-photo.png" : "https://preview.healthmate.local/files/example-report.pdf"), "expiresIn": 300])
                }
                if c == nil, method == "GET" { return json(view["documents"].array[index]) }
                if c == nil, method == "DELETE" { ctx.account["documents"].items.remove(at: index); return noContent() }
            }
        }

        // Health data & HealthKit
        if a == "health-data" {
            if b == "latest", method == "GET" { return json(view["measurements"]["latest"]) }
            if b == "trends", method == "GET" { return json(trend(view, query: ctx.query)) }
            if b == "measurements", method == "POST" {
                let list = input["measurements"].array
                for m in list {
                    var latest = ctx.account["measurements"]["latest"].array
                    let unit = latest.first(where: { $0["kind"] == m["kind"] })?["unit"] ?? ""
                    latest.removeAll { $0["kind"] == m["kind"] }
                    latest.append(["kind": m["kind"], "value": m["value"], "unit": unit, "recordedAt": m["recordedAt"], "source": m["source"]])
                    ctx.account["measurements"]["latest"] = .array(latest)
                }
                return json(["inserted": .number(Double(list.count))], 201)
            }
            if b == "apple-health", method == "DELETE" { ctx.account["healthKit"]["status"] = "disconnected"; ctx.account["healthKit"]["disconnectedAt"] = .string(ctx.now); return json(["removed": 0]) }
            // Daily records (Phase 2B): accepted and counted; the sample series stays the source of what's shown.
            if b == "daily", method == "PUT" {
                let records = input["records"].array
                guard !records.isEmpty, records.count <= 500 else { return fail(400, "validation_failed", "Check these fields: records.") }
                ctx.account["healthKit"]["lastSyncAt"] = .string(ctx.now)
                return json(["upserted": .number(Double(records.count)), "unchanged": 0, "ignoredOlder": 0])
            }
            if b == "daily", method == "GET" {
                let from = ctx.query["from"] ?? "", to = ctx.query["to"] ?? ""
                let kinds = ctx.query["kinds"].map { $0.split(separator: ",").map(String.init) }
                var records: [JSONValue] = []
                for (kind, series) in view["measurements"]["daily"].object where kinds?.contains(kind) ?? true {
                    let unit = view["measurements"]["latest"].array.first(where: { $0["kind"].string == kind })?["unit"] ?? ""
                    for point in series.array {
                        guard let day = point["date"].string.map({ String($0.prefix(10)) }), day >= from, day <= to else { continue }
                        records.append(["day": .string(day), "kind": .string(kind), "unit": unit, "value": point["value"], "min": nil, "max": nil, "sampleCount": nil, "source": "apple_health", "isComplete": true, "timeZone": "UTC"])
                    }
                }
                return json(["records": .array(records.sorted { ($0["day"].string ?? "", $0["kind"].string ?? "") < ($1["day"].string ?? "", $1["kind"].string ?? "") })])
            }
        }
        if a == "healthkit", b == "sync-runs" {
            if c == nil, method == "POST" { return json(["id": .string(newId())], 201) }
            if c != nil, method == "PATCH" {
                if input["status"].string != "failed" { ctx.account["healthKit"]["lastSyncAt"] = .string(ctx.now) }
                if input["historyComplete"].bool == true { ctx.account["healthKit"]["history"] = ["status": "complete", "from": input["oldestDay"], "daysRequested": nil] }
                return json(ctx.account["healthKit"])
            }
        }
        if a == "healthkit", b == "connection" {
            if method == "GET" { return json(view["healthKit"]) }
            if method == "PUT" {
                ctx.account["healthKit"]["status"] = "connected"
                if let name = input["deviceName"].string, !name.isEmpty { ctx.account["healthKit"]["deviceName"] = .string(name) }
                if !input["scopes"].array.isEmpty { ctx.account["healthKit"]["scopes"] = input["scopes"] }
                ctx.account["healthKit"]["connectedAt"] = .string(ctx.now)
                ctx.account["healthKit"]["disconnectedAt"] = nil
                ctx.account["healthKit"]["lastSyncAt"] = .string(ctx.now)
                return json(ctx.account["healthKit"])
            }
            if method == "DELETE" { ctx.account["healthKit"]["status"] = "disconnected"; ctx.account["healthKit"]["disconnectedAt"] = .string(ctx.now); return json(["removed": 0]) }
        }

        // Timeline
        if a == "timeline" {
            if b == nil, method == "GET" {
                let before = ctx.query["before"]
                let types = ctx.query["types"]?.split(separator: ",").map(String.init) ?? []
                let limit = min(Int(ctx.query["limit"] ?? "") ?? 50, 100)
                let events = view["timeline"].array
                    .sorted { ($0["occurredAt"].string ?? "") > ($1["occurredAt"].string ?? "") }
                    .filter { e in (before.map { (e["occurredAt"].string ?? "") < $0 } ?? true) && (types.isEmpty || types.contains(e["eventType"].string ?? "")) }
                let page = Array(events.prefix(limit))
                return json(["events": .array(page), "nextCursor": events.count > limit ? (page.last?["occurredAt"] ?? nil) : nil])
            }
            if b == nil, method == "POST" {
                let id = newId()
                let occurredAt = optionalText(input["occurredAt"], 40)
                ctx.account["timeline"].items.insert(["id": .string(id), "eventType": input["eventType"].isNull ? "note" : input["eventType"], "title": .string(text(input["title"], 200)), "occurredAt": occurredAt.isNull ? .string(ctx.now) : occurredAt, "sourceType": "user_entered", "sourceId": nil, "payload": optionalText(input["details"], 1000).isNull ? input["payload"] : ["details": optionalText(input["details"], 1000)]], at: 0)
                return json(["id": .string(id)], 201)
            }
            if let id = b {
                guard let index = ctx.account["timeline"].array.firstIndex(where: { $0["id"].string == id }) else { return fail(404, "not_found", "Entry not found.") }
                if method == "GET" { return json(ctx.account["timeline"].array[index]) }
                // Editing is Preview-only for now (the Phase 2 API adds it); only entries the person added can change.
                if method == "PATCH" {
                    guard ctx.account["timeline"].array[index]["sourceType"].string == "user_entered" else { return fail(403, "forbidden", "Only entries you added can be edited.") }
                    let title = text(input["title"], 200)
                    if !title.isEmpty { ctx.account["timeline"].items[index]["title"] = .string(title) }
                    if let when = input["occurredAt"].string, JSONCoding.parseISO8601(when) != nil { ctx.account["timeline"].items[index]["occurredAt"] = .string(when) }
                    if input.object["details"] != nil {
                        let details = optionalText(input["details"], 1000)
                        var payload = ctx.account["timeline"].array[index]["payload"].object
                        payload["details"] = details.isNull ? nil : details
                        ctx.account["timeline"].items[index]["payload"] = payload.isEmpty ? .null : .object(payload)
                    }
                    return json(ctx.account["timeline"].array[index])
                }
                if method == "DELETE" {
                    guard ctx.account["timeline"].array[index]["sourceType"].string == "user_entered" else { return fail(403, "forbidden", "Only entries you added can be deleted.") }
                    ctx.account["timeline"].items.remove(at: index)
                    return noContent()
                }
            }
        }

        // Plan, reminders, mood
        if a == "plan", b == nil {
            if method == "GET" { return json(view["plan"]) }
            if method == "PUT" {
                guard input["baseRevision"].int == ctx.account["plan"]["revision"].int else { return fail(409, "plan_conflict", "Your plan was changed somewhere else. Reload and try again.") }
                ctx.account["plan"] = ["revision": .number(Double((ctx.account["plan"]["revision"].int ?? 0) + 1)), "items": input["items"].isNull ? [] : input["items"], "completions": input["completions"].isNull ? [] : input["completions"]]
                return json(ctx.account["plan"])
            }
        }
        if a == "reminders", b == nil, method == "GET" {
            return json(.array(view["plan"]["items"].array.map { ["id": .string("r-\($0["id"].string ?? "")"), "planItemId": $0["id"], "title": $0["title"], "time": $0["time"], "enabled": $0["reminderEnabled"], "channel": "device"] }))
        }
        if a == "check-ins", b == "mood" {
            if c == nil, method == "POST" {
                let checkIn: JSONValue = ["mood": input["mood"], "recordedAt": .string(ctx.now)]
                ctx.account["moods"].items.insert(checkIn, at: 0)
                return json(checkIn, 201)
            }
            if c == "latest", method == "GET" { return json(["checkIn": view["moods"].array.first ?? .null]) }
        }

        // Care
        if a == "care", b == "providers" {
            if c == nil, method == "GET" { return json(view["providers"]) }
            if c == nil, method == "POST" {
                let id = newId()
                var provider: JSONValue = ["id": .string(id), "name": .string(text(input["name"], 160)), "createdAt": .string(ctx.now)]
                for key in ["specialty", "phone", "address", "website", "notes"] { provider[key] = optionalText(input[key], 1000) }
                ctx.account["providers"].items.append(provider)
                return json(["id": .string(id)], 201)
            }
            if let id = c {
                guard let index = view["providers"].array.firstIndex(where: { $0["id"].string == id }) else { return fail(404, "not_found", "Care provider not found.") }
                if method == "GET" { return json(view["providers"].array[index]) }
                if method == "PATCH" {
                    for key in ["name", "specialty", "phone", "address", "website", "notes"] where input.object[key] != nil { ctx.account["providers"].items[index][key] = input[key] }
                    return json(ctx.account["providers"].array[index])
                }
                if method == "DELETE" { ctx.account["providers"].items.remove(at: index); return noContent() }
            }
        }
        if a == "care", b == "appointments" {
            if c == nil, method == "GET" {
                let when = ctx.query["when"] ?? "upcoming"
                let list = view["appointments"].array.filter { x in
                    let starts = x["startsAt"].string ?? ""
                    return when == "all" || (when == "past" ? starts < ctx.now : starts >= ctx.now)
                }
                return json(.array(list.sorted { when == "past" ? ($0["startsAt"].string ?? "") > ($1["startsAt"].string ?? "") : ($0["startsAt"].string ?? "") < ($1["startsAt"].string ?? "") }))
            }
            if c == nil, method == "POST" {
                let id = newId()
                let providerId = optionalText(input["careProviderId"], 40)
                let providerName = ctx.account["providers"].array.first(where: { $0["id"] == providerId })?["name"] ?? .null
                let appointment: JSONValue = [
                    "id": .string(id), "title": .string(text(input["title"], 200)), "careProviderId": providerId, "providerName": providerName,
                    "startsAt": .string(text(input["startsAt"], 40)), "endsAt": optionalText(input["endsAt"], 40), "location": optionalText(input["location"], 300),
                    "mode": input["mode"], "status": "scheduled", "notes": optionalText(input["notes"], 1000),
                ]
                ctx.account["appointments"].items.append(appointment)
                ctx.account["timeline"].items.insert(["id": .string(newId()), "eventType": "appointment", "title": appointment["title"], "occurredAt": appointment["startsAt"], "sourceType": "user_entered", "sourceId": .string(id)], at: 0)
                return json(["id": .string(id)], 201)
            }
            if let id = c {
                guard let index = view["appointments"].array.firstIndex(where: { $0["id"].string == id }) else { return fail(404, "not_found", "Appointment not found.") }
                if method == "GET" { return json(view["appointments"].array[index]) }
                if method == "PATCH" {
                    for key in ["title", "status", "startsAt", "endsAt", "location", "mode", "notes", "careProviderId"] where input.object[key] != nil { ctx.account["appointments"].items[index][key] = input[key] }
                    let providerId = ctx.account["appointments"].array[index]["careProviderId"]
                    if let name = ctx.account["providers"].array.first(where: { $0["id"] == providerId })?["name"] { ctx.account["appointments"].items[index]["providerName"] = name }
                    return json(ctx.account["appointments"].array[index])
                }
                if method == "DELETE" { ctx.account["appointments"].items.remove(at: index); return noContent() }
            }
        }

        // Symptoms
        if a == "symptoms" {
            if b == nil, method == "GET" {
                let status = ctx.query["status"]
                return json(.array(view["symptoms"].array.filter { status == nil || $0["status"].string == status }.map { var x = $0; x["events"] = nil; return x }))
            }
            if b == nil, method == "POST" {
                let name = text(input["name"], 120)
                if let index = ctx.account["symptoms"].array.firstIndex(where: { ($0["name"].string ?? "").lowercased() == name.lowercased() }) {
                    ctx.account["symptoms"].items[index]["status"] = "active"
                    return json(["id": ctx.account["symptoms"].array[index]["id"]], 201)
                }
                let id = newId()
                ctx.account["symptoms"].items.insert(["id": .string(id), "name": .string(name), "bodyArea": optionalText(input["bodyArea"], 80), "status": "active", "notes": optionalText(input["notes"], 1000), "firstNotedOn": optionalText(input["firstNotedOn"], 10), "createdAt": .string(ctx.now), "lastLoggedAt": nil, "lastSeverity": nil, "events": []], at: 0)
                return json(["id": .string(id)], 201)
            }
            if let id = b {
                guard let index = view["symptoms"].array.firstIndex(where: { $0["id"].string == id }) else { return fail(404, "not_found", "Symptom not found.") }
                if c == "events", method == "GET" { return json(view["symptoms"].array[index]["events"]) }
                if c == "events", method == "POST" {
                    let name = ctx.account["symptoms"].array[index]["name"].string ?? ""
                    let notes = optionalText(input["notes"], 1000)
                    let result = SafetyEngine.triage([name, notes.string ?? ""].joined(separator: ". "))
                    let occurredAt = optionalText(input["occurredAt"], 40).isNull ? .string(ctx.now) : optionalText(input["occurredAt"], 40)
                    let eventId = newId()
                    ctx.account["symptoms"].items[index]["events"].items.insert(["id": .string(eventId), "severity": input["severity"], "occurredAt": occurredAt, "notes": notes, "triageLevel": .string(result.level.rawValue)], at: 0)
                    ctx.account["symptoms"].items[index]["lastLoggedAt"] = occurredAt
                    ctx.account["symptoms"].items[index]["lastSeverity"] = input["severity"]
                    ctx.account["timeline"].items.insert(["id": .string(newId()), "eventType": "symptom", "title": .string(name), "occurredAt": occurredAt, "sourceType": "user_entered", "sourceId": .string(eventId), "payload": input["severity"].isNull ? .null : ["severity": input["severity"]]], at: 0)
                    return json(["id": .string(eventId), "triageLevel": .string(result.level.rawValue), "escalation": encode(SafetyEngine.escalation(for: result))], 201)
                }
                if c == nil, method == "PATCH" {
                    if let status = input["status"].string, ["active", "resolved"].contains(status) { ctx.account["symptoms"].items[index]["status"] = .string(status) }
                    if input.object["notes"] != nil { ctx.account["symptoms"].items[index]["notes"] = optionalText(input["notes"], 1000) }
                    return noContent()
                }
                if c == nil, method == "DELETE" { ctx.account["symptoms"].items.remove(at: index); return noContent() }
            }
        }

        // Notifications
        if a == "notifications" {
            if b == nil, method == "GET" {
                let list = view["notifications"].array.sorted { ($0["createdAt"].string ?? "") > ($1["createdAt"].string ?? "") }
                return json(["notifications": .array(list), "unreadCount": .number(Double(list.filter { $0["readAt"].isNull }.count))])
            }
            if b == "read-all", method == "POST" {
                ctx.account["notifications"] = .array(ctx.account["notifications"].array.map { var n = $0; if n["readAt"].isNull { n["readAt"] = .string(ctx.now) }; return n })
                return noContent()
            }
            if let id = b {
                guard let index = ctx.account["notifications"].array.firstIndex(where: { $0["id"].string == id }) else { return fail(404, "not_found", "Notification not found.") }
                if method == "PATCH" {
                    let read = input["read"].bool != false
                    let current = ctx.account["notifications"].array[index]["readAt"]
                    ctx.account["notifications"].items[index]["readAt"] = read ? (current.isNull ? .string(ctx.now) : current) : .null
                    return json(ctx.account["notifications"].array[index])
                }
                if method == "DELETE" { ctx.account["notifications"].items.remove(at: index); return noContent() }
            }
        }
        return nil
    }

    private func encode<T: Encodable>(_ value: T?) -> JSONValue {
        guard let value, let data = try? JSONEncoder().encode(value) else { return .null }
        return JSONValue.decode(data)
    }

    private func trend(_ view: JSONValue, query: [String: String]) -> JSONValue {
        let kind = query["kind"] ?? "steps"
        let days = max(1, min(Int(query["days"] ?? "") ?? 7, 90))
        let series = view["measurements"]["daily"][kind].array
        let points = Array(series.suffix(days))
        let previous = Array(series.dropLast(days).suffix(days))
        func average(_ list: [JSONValue]) -> JSONValue {
            let values = list.compactMap { $0["value"].double }
            return values.isEmpty ? .null : .number(values.reduce(0, +) / Double(values.count))
        }
        let unit = view["measurements"]["latest"].array.first(where: { $0["kind"].string == kind })?["unit"] ?? ""
        return ["kind": .string(kind), "unit": unit, "points": .array(points), "average": average(points), "previousAverage": average(previous)]
    }

    /// The same safety order as the real AI Gateway: deterministic triage
    /// first (emergencies get fixed guidance), then a fixed sample reply.
    private func exchange(_ account: JSONValue, _ message: String, now: String) -> [JSONValue] {
        let result = SafetyEngine.triage(message)
        let user: JSONValue = ["id": .string(newId()), "role": "user", "content": .string(message), "payload": nil, "triageLevel": .string(result.level.rawValue), "createdAt": .string(now)]
        let escalation = encode(SafetyEngine.escalation(for: result))
        var payload: JSONValue
        if result.level == .emergency, !escalation.isNull {
            payload = ["kind": "escalation", "escalation": escalation]
        } else if result.medicationChangeRequest {
            payload = account["fallbackReply"]
            payload["answer"] = .string(SafetyEngine.medicationChangeNotice)
            payload["followUp"] = nil
            payload["notice"] = .string(Self.sampleNotice)
            payload["escalation"] = escalation
            payload["safetyAdjusted"] = true
        } else {
            let lower = message.lowercased()
            let reply = account["replies"].array.first { r in r["keywords"].array.contains { lower.contains($0.string ?? "\u{0}") } }?["answer"]
            payload = reply ?? account["fallbackReply"]
            payload["escalation"] = escalation
        }
        let content: String = payload["kind"].string == "escalation"
            ? "\(payload["escalation"]["title"].string ?? "")\n\n\(payload["escalation"]["body"].string ?? "")"
            : (payload["answer"].string ?? "")
        let assistant: JSONValue = ["id": .string(newId()), "role": "assistant", "content": .string(content), "payload": payload, "triageLevel": .string(result.level.rawValue), "createdAt": .string(now)]
        return [user, assistant]
    }
}
