import Foundation

private struct Message: Encodable { let message: String }

/// One function per API route, so views and view models never build requests by hand.
extension APIClient {
    // MARK: Meta & auth

    public func meta() async throws -> APIMeta {
        try await send(Endpoint("GET", "meta", authenticated: false))
    }

    public func register(email: String, password: String, firstName: String, lastName: String, timeZone: String) async throws -> RegisterOutcome {
        struct Body: Encodable { let email, password, firstName, lastName, timeZone: String }
        let response: RegisterWire = try await send(.json("POST", "auth/register", Body(email: email, password: password, firstName: firstName, lastName: lastName, timeZone: timeZone), authenticated: false))
        guard let userId = response.userId, let access = response.accessToken, let refresh = response.refreshToken, let expiresIn = response.expiresIn else {
            return .confirmationRequired
        }
        await store(TokenPair(accessToken: access, refreshToken: refresh, expiresIn: expiresIn))
        return .signedIn(userId: userId)
    }

    /// Confirms an email address with the token from the confirmation email, then signs in.
    public func verifyEmail(token: String) async throws -> AuthResponse {
        struct Body: Encodable { let token: String }
        let response: AuthResponse = try await send(.json("POST", "auth/verify-email", Body(token: token), authenticated: false))
        await store(response.tokens)
        return response
    }

    /// Sends the confirmation email again.
    public func resendVerification(email: String) async throws {
        struct Body: Encodable { let email: String }
        try await sendNoContent(.json("POST", "auth/resend-verification", Body(email: email), authenticated: false))
    }

    /// Continue with Apple or Google. Phase 1 (Preview mode) signs in to the sample account; real OAuth is Phase 2.
    public func signIn(with provider: String) async throws -> AuthResponse {
        struct Body: Encodable { let provider: String; let timeZone: String }
        let response: AuthResponse = try await send(.json("POST", "auth/oauth", Body(provider: provider, timeZone: TimeZone.current.identifier), authenticated: false))
        await store(response.tokens)
        return response
    }

    /// Sets a new password with the token from the reset email.
    public func completePasswordReset(token: String, password: String) async throws {
        struct Body: Encodable { let accessToken: String; let password: String }
        try await sendNoContent(.json("POST", "auth/password-reset/complete", Body(accessToken: token, password: password), authenticated: false))
    }

    /// Emails a reset link if the account exists (the server never says whether it does).
    public func requestPasswordReset(email: String) async throws {
        struct Body: Encodable { let email: String }
        try await sendNoContent(.json("POST", "auth/password-reset", Body(email: email), authenticated: false))
    }

    public func login(email: String, password: String) async throws -> AuthResponse {
        struct Body: Encodable { let email, password: String }
        let response: AuthResponse = try await send(.json("POST", "auth/login", Body(email: email, password: password), authenticated: false))
        await store(response.tokens)
        return response
    }

    /// Revokes the session server-side (best effort) and always clears local tokens.
    public func logout() async {
        if let refresh = await refreshTokenValue() {
            struct Body: Encodable { let refreshToken: String }
            try? await sendNoContent(.json("POST", "auth/logout", Body(refreshToken: refresh), authenticated: false))
        }
        await clearSession()
    }

    // MARK: Profile & account

    public func healthProfile() async throws -> HealthProfile {
        try await send(Endpoint("GET", "me"))
    }

    public func updateProfile(_ details: ProfileDetails) async throws -> ProfileDetails {
        try await send(.json("PATCH", "me/profile", details))
    }

    public func addCondition(name: String, source: ProfileSource) async throws {
        struct Body: Encodable { let name: String; let source: ProfileSource }
        let _: [String: String] = try await send(.json("POST", "me/conditions", Body(name: name, source: source)))
    }

    public func addAllergy(substance: String, reaction: String?, source: ProfileSource) async throws {
        struct Body: Encodable { let substance: String; let reaction: String?; let source: ProfileSource }
        let _: [String: String] = try await send(.json("POST", "me/allergies", Body(substance: substance, reaction: reaction, source: source)))
    }

    /// The instruction is sent exactly as the person typed it.
    public func addMedication(name: String, instruction: String, source: ProfileSource) async throws {
        struct Body: Encodable { let name: String; let instruction: String; let source: ProfileSource }
        let _: [String: String] = try await send(.json("POST", "me/medications", Body(name: name, instruction: instruction, source: source)))
    }

    public func removeProfileItem(_ collection: String, id: String) async throws {
        try await sendNoContent(Endpoint("DELETE", "me/\(collection)/\(id)"))
    }

    public func exportData() async throws -> Data {
        try await rawData(Endpoint("GET", "me/export"))
    }

    public func deleteAccount(password: String) async throws {
        struct Body: Encodable { let password: String }
        try await sendNoContent(.json("POST", "me/delete", Body(password: password)))
        await clearSession()
    }

    public func accountSummary() async throws -> AccountSummary {
        try await send(Endpoint("GET", "me/account"))
    }

    /// Marks first-run setup as done for this account (on every device).
    public func completeOnboarding() async throws {
        try await sendNoContent(Endpoint("POST", "me/onboarding"))
    }

    public func notificationPreferences() async throws -> NotificationPreferences {
        try await send(Endpoint("GET", "me/notification-preferences"))
    }

    public func updateNotificationPreferences(_ preferences: NotificationPreferences) async throws {
        try await sendNoContent(.json("PUT", "me/notification-preferences", preferences))
    }

    // MARK: Notifications

    public func notifications() async throws -> NotificationList {
        try await send(Endpoint("GET", "notifications"))
    }

    public func setNotificationRead(_ id: String, read: Bool) async throws {
        struct Body: Encodable { let read: Bool }
        try await sendNoContent(.json("PATCH", "notifications/\(id)", Body(read: read)))
    }

    public func markAllNotificationsRead() async throws {
        try await sendNoContent(Endpoint("POST", "notifications/read-all"))
    }

    public func deleteNotification(_ id: String) async throws {
        try await sendNoContent(Endpoint("DELETE", "notifications/\(id)"))
    }

    // MARK: Care

    /// `when`: "upcoming", "past" or "all".
    public func appointments(when: String = "upcoming") async throws -> [AppointmentRecord] {
        try await send(Endpoint("GET", "care/appointments", query: [URLQueryItem(name: "when", value: when)]))
    }

    public func appointment(_ id: String) async throws -> AppointmentRecord {
        try await send(Endpoint("GET", "care/appointments/\(id)"))
    }

    /// Updates HealthMate's record only; it never contacts the clinic.
    public func setAppointmentStatus(_ id: String, _ status: AppointmentRecord.Status) async throws {
        struct Body: Encodable { let status: AppointmentRecord.Status }
        try await sendNoContent(.json("PATCH", "care/appointments/\(id)", Body(status: status)))
    }

    public func careProvider(_ id: String) async throws -> CareProviderRecord {
        try await send(Endpoint("GET", "care/providers/\(id)"))
    }

    public func consents() async throws -> [ConsentRecord] {
        try await send(Endpoint("GET", "me/consents"))
    }

    public func setConsent(_ kind: String, granted: Bool) async throws {
        struct Body: Encodable { let kind: String; let granted: Bool }
        try await sendNoContent(.json("POST", "me/consents", Body(kind: kind, granted: granted)))
    }

    // MARK: Chat & memory

    public func conversations() async throws -> [ConversationRecord] {
        try await send(Endpoint("GET", "conversations"))
    }

    public func conversation(_ id: String) async throws -> ConversationDetail {
        try await send(Endpoint("GET", "conversations/\(id)"))
    }

    public func startConversation(_ text: String) async throws -> ConversationStart {
        try await send(.json("POST", "conversations", Message(message: text)))
    }

    public func sendMessage(_ text: String, in conversationId: String) async throws -> [ChatMessageRecord] {
        let response: MessagesResponse = try await send(.json("POST", "conversations/\(conversationId)/messages", Message(message: text)))
        return response.messages
    }

    @discardableResult
    public func renameConversation(_ id: String, title: String) async throws -> ConversationRecord {
        struct Body: Encodable { let title: String }
        return try await send(.json("PATCH", "conversations/\(id)", Body(title: title)))
    }

    public func deleteConversation(_ id: String) async throws {
        try await sendNoContent(Endpoint("DELETE", "conversations/\(id)"))
    }

    public func memories(query: String? = nil) async throws -> [MemoryRecord] {
        try await send(Endpoint("GET", "memories", query: query.map { [URLQueryItem(name: "q", value: $0)] } ?? []))
    }

    /// Saves a fact the person confirmed (e.g. a suggestion from chat). Never AI-inferred.
    public func saveMemory(_ fact: String, fromConversation conversationId: String? = nil) async throws -> MemoryRecord {
        struct Body: Encodable { let fact: String; let status: String; let source: String; let sourceId: String? }
        return try await send(.json("POST", "memories", Body(fact: fact, status: "user_confirmed", source: conversationId == nil ? "user_entry" : "user_conversation", sourceId: conversationId)))
    }

    public func updateMemory(_ id: String, fact: String) async throws -> MemoryRecord {
        struct Body: Encodable { let fact: String }
        return try await send(.json("PATCH", "memories/\(id)", Body(fact: fact)))
    }

    public func deleteMemory(_ id: String) async throws {
        try await sendNoContent(Endpoint("DELETE", "memories/\(id)"))
    }

    // MARK: Documents

    /// Creates the record, uploads the bytes to the signed URL, then starts processing.
    public func submitDocument(kind: DocumentKind, data: Data, filename: String, contentType: String, purpose: ImagePurpose? = nil, note: String? = nil) async throws -> DocumentRecord {
        struct Create: Encodable { let kind: DocumentKind; let filename: String; let contentType: String; let byteSize: Int; let purpose: ImagePurpose? }
        struct Process: Encodable { let note: String? }
        let created: DocumentCreation = try await send(.json("POST", "documents", Create(kind: kind, filename: filename, contentType: contentType, byteSize: data.count, purpose: purpose)))
        try await upload(data, to: created.upload.url, headers: created.upload.headers)
        return try await send(.json("POST", "documents/\(created.document.id)/process", Process(note: note)))
    }

    public func documents(kind: DocumentKind? = nil) async throws -> [DocumentRecord] {
        try await send(Endpoint("GET", "documents", query: kind.map { [URLQueryItem(name: "kind", value: $0.rawValue)] } ?? []))
    }

    public func document(_ id: String) async throws -> DocumentRecord {
        try await send(Endpoint("GET", "documents/\(id)"))
    }

    /// A 5-minute signed link to the original file (never a public URL).
    public func documentFile(_ id: String) async throws -> DocumentFileLink {
        try await send(Endpoint("GET", "documents/\(id)/file"))
    }

    public func deleteDocument(_ id: String) async throws {
        try await sendNoContent(Endpoint("DELETE", "documents/\(id)"))
    }

    // MARK: Health data & timeline

    public func uploadMeasurements(_ measurements: [MeasurementUpload]) async throws -> Int {
        struct Body: Encodable { let measurements: [MeasurementUpload] }
        struct Result: Decodable { let inserted: Int }
        let result: Result = try await send(.json("POST", "health-data/measurements", Body(measurements: measurements)))
        return result.inserted
    }

    public func trend(kind: String, days: Int) async throws -> TrendResponse {
        try await send(Endpoint("GET", "health-data/trends", query: [URLQueryItem(name: "kind", value: kind), URLQueryItem(name: "days", value: String(days))]))
    }

    public func disconnectAppleHealth() async throws {
        struct Result: Decodable { let removed: Int }
        let _: Result = try await send(Endpoint("DELETE", "health-data/apple-health"))
    }

    public func timeline(before: String? = nil) async throws -> TimelinePage {
        try await send(Endpoint("GET", "timeline", query: before.map { [URLQueryItem(name: "before", value: $0)] } ?? []))
    }

    /// Only entries the person added themselves can be deleted.
    public func deleteTimelineEntry(_ id: String) async throws {
        try await sendNoContent(Endpoint("DELETE", "timeline/\(id)"))
    }

    public func addTimelineEntry(type: String, title: String, occurredAt: Date, details: String?) async throws {
        struct Body: Encodable { let eventType: String; let title: String; let occurredAt: Date; let details: String? }
        let _: [String: String] = try await send(.json("POST", "timeline", Body(eventType: type, title: title, occurredAt: occurredAt, details: details)))
    }
}

// MARK: Plan sync

extension APIClient: PlanSyncTransport {
    public func fetchPlan() async throws -> PlanRecord? {
        guard await isSignedIn else { return nil }
        return try await send(Endpoint("GET", "plan"))
    }

    public func pushPlan(_ plan: PlanRecord) async throws -> PlanRecord {
        struct Body: Encodable { let baseRevision: Int; let items: [PlanItemWire]; let completions: [PlanCompletionWire] }
        do {
            return try await send(.json("PUT", "plan", Body(baseRevision: plan.revision, items: plan.items, completions: plan.completions)))
        } catch APIError.server(status: 409, code: "plan_conflict", message: _) {
            throw PlanSyncError.conflict
        }
    }

    /// Mood check-ins are also stored in the account when signed in.
    public func recordMood(_ mood: Mood) async throws {
        struct Body: Encodable { let mood: Mood }
        struct Result: Decodable {}
        let _: Result = try await send(.json("POST", "check-ins/mood", Body(mood: mood)))
    }

    public func latestMood() async throws -> MoodCheckIn? {
        struct Response: Decodable { let checkIn: MoodCheckIn? }
        let response: Response = try await send(Endpoint("GET", "check-ins/mood/latest"))
        return response.checkIn
    }
}
