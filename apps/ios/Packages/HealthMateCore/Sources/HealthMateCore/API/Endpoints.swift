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

    /// Continue with Google using the ID token that Google Sign-In returned on this device (Phase 2D).
    /// `nonce`: the value the app asked Google to embed, if any. Apple answers 501 until it's set up.
    public func signIn(with provider: String, idToken: String, nonce: String?) async throws -> AuthResponse {
        struct Body: Encodable { let provider: String; let idToken: String; let nonce: String?; let timeZone: String }
        let response: AuthResponse = try await send(.json("POST", "auth/oauth", Body(provider: provider, idToken: idToken, nonce: nonce, timeZone: TimeZone.current.identifier), authenticated: false))
        await store(response.tokens)
        return response
    }

    /// Continue with Apple or Google without a provider token. Preview mode signs in to the sample account;
    /// the real API answers 501 ("isn't available on this server yet").
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

    /// Saves the preferred units with the account (the device keeps its own display choice too).
    public func setUnitSystem(_ system: UnitSystem) async throws {
        struct Body: Encodable { let unitSystem: UnitSystem }
        let _: ProfileDetails = try await send(.json("PATCH", "me/profile", Body(unitSystem: system)))
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

    /// Changes the password for an email-and-password account.
    public func changePassword(current: String, new: String) async throws {
        struct Body: Encodable { let currentPassword, newPassword: String }
        try await sendNoContent(.json("POST", "auth/change-password", Body(currentPassword: current, newPassword: new)))
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

    // MARK: Push devices (Phase 2D; the server logs pushes until APNs is configured)

    public func pushDevices() async throws -> [PushDevice] {
        let list: PushDeviceList = try await send(Endpoint("GET", "me/devices"))
        return list.devices
    }

    /// Registers this device's APNs token (hex). `environment`: "sandbox" or "production".
    public func registerPushDevice(token: String, environment: String, appVersion: String?) async throws -> PushDevice {
        struct Body: Encodable { let platform: String; let token: String; let environment: String; let appVersion: String? }
        return try await send(.json("POST", "me/devices", Body(platform: "ios", token: token, environment: environment, appVersion: appVersion)))
    }

    /// Forgets this device's token (before signing out on it).
    public func unregisterPushDevice(token: String) async throws {
        struct Body: Encodable { let token: String }
        try await sendNoContent(.json("DELETE", "me/devices", Body(token: token)))
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

    public func careProviders() async throws -> [CareProviderRecord] {
        try await send(Endpoint("GET", "care/providers"))
    }

    /// Adds (`id == nil`) or edits a care team member; returns its id.
    @discardableResult
    public func saveCareProvider(id: String?, _ draft: CareProviderDraft) async throws -> String {
        if let id {
            try await sendNoContent(.json("PATCH", "care/providers/\(id)", draft))
            return id
        }
        struct Created: Decodable { let id: String }
        return try await send(.json("POST", "care/providers", draft), as: Created.self).id
    }

    public func deleteCareProvider(_ id: String) async throws {
        try await sendNoContent(Endpoint("DELETE", "care/providers/\(id)"))
    }

    /// Adds (`id == nil`) or edits an appointment in HealthMate's record; returns its id.
    @discardableResult
    public func saveAppointment(id: String?, _ draft: AppointmentDraft) async throws -> String {
        if let id {
            try await sendNoContent(.json("PATCH", "care/appointments/\(id)", draft))
            return id
        }
        struct Created: Decodable { let id: String }
        return try await send(.json("POST", "care/appointments", draft), as: Created.self).id
    }

    /// Saves the appointment's notes (including its questions checklist).
    public func setAppointmentNotes(_ id: String, _ notes: String?) async throws {
        struct Body: Encodable {
            let notes: String?
            func encode(to encoder: Encoder) throws {
                var c = encoder.container(keyedBy: CodingKeys.self)
                try c.encode(notes, forKey: .notes)
            }
            enum CodingKeys: String, CodingKey { case notes }
        }
        try await sendNoContent(.json("PATCH", "care/appointments/\(id)", Body(notes: notes)))
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

    /// Keeps a fact but stops (or restarts) the AI Health Assistant using it. Doesn't confirm or change it.
    public func setMemoryAIExcluded(_ id: String, excluded: Bool) async throws -> MemoryRecord {
        struct Body: Encodable { let aiExcluded: Bool }
        return try await send(.json("PATCH", "memories/\(id)", Body(aiExcluded: excluded)))
    }

    /// "No longer true": the fact becomes history (not a correction). Today when no date is given.
    public func endMemory(_ id: String, on day: String? = nil) async throws -> MemoryRecord {
        struct Body: Encodable { let endedOn: String? }
        return try await send(.json("POST", "memories/\(id)/end", Body(endedOn: day)))
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

    // MARK: Daily health data & Apple Health sync (Phase 2B)

    /// Registers the connection and what the person chose to share (needs the health_data_sync consent).
    @discardableResult
    public func connectHealthKit(deviceName: String?, deviceId: String, scopes: [String], historyDays: Int) async throws -> HealthKitConnectionRecord {
        struct Body: Encodable { let deviceName: String?; let deviceId: String; let scopes: [String]; let historyDays: Int }
        return try await send(.json("PUT", "healthkit/connection", Body(deviceName: deviceName, deviceId: deviceId, scopes: scopes, historyDays: historyDays)))
    }

    public func healthKitConnection() async throws -> HealthKitConnectionRecord {
        try await send(Endpoint("GET", "healthkit/connection"))
    }

    /// One value per day and metric (Apple Health preferred). At most 400 days per call.
    public func dailyHealth(from: String, to: String, kinds: [String] = []) async throws -> [DailyHealthRecord] {
        struct Page: Decodable { let records: [DailyHealthRecord] }
        var query = [URLQueryItem(name: "from", value: from), URLQueryItem(name: "to", value: to)]
        if !kinds.isEmpty { query.append(URLQueryItem(name: "kinds", value: kinds.joined(separator: ","))) }
        let page: Page = try await send(Endpoint("GET", "health-data/daily", query: query))
        return page.records
    }

    public func disconnectAppleHealth() async throws {
        struct Result: Decodable { let removed: Int }
        let _: Result = try await send(Endpoint("DELETE", "health-data/apple-health"))
    }

    public func timeline(before: String? = nil, types: [String] = []) async throws -> TimelinePage {
        var query = before.map { [URLQueryItem(name: "before", value: $0)] } ?? []
        if !types.isEmpty { query.append(URLQueryItem(name: "types", value: types.joined(separator: ","))) }
        return try await send(Endpoint("GET", "timeline", query: query))
    }

    /// Edits an entry the person added (device, document and AI entries can't be edited).
    public func updateTimelineEntry(_ id: String, title: String, occurredAt: Date, details: String?) async throws {
        struct Body: Encodable { let title: String; let occurredAt: Date; let details: String? }
        let _: TimelineEventRecord = try await send(.json("PATCH", "timeline/\(id)", Body(title: title, occurredAt: occurredAt, details: details ?? "")))
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


extension APIClient: DailyHealthUploader {
    public func startHealthSyncRun(kind: HealthSyncRunKind, deviceId: String) async throws -> String {
        struct Body: Encodable { let kind: HealthSyncRunKind; let deviceId: String }
        struct Created: Decodable { let id: String }
        let created: Created = try await send(.json("POST", "healthkit/sync-runs", Body(kind: kind, deviceId: deviceId)))
        return created.id
    }

    public func uploadDailyHealth(_ records: [DailyRecordUpload], timeZone: String, sourceDevice: String?, syncRunId: String?) async throws -> DailyUploadResult {
        struct Body: Encodable { let timeZone: String; let sourceDevice: String?; let syncRunId: String?; let records: [DailyRecordUpload] }
        return try await send(.json("PUT", "health-data/daily", Body(timeZone: timeZone, sourceDevice: sourceDevice, syncRunId: syncRunId, records: records)))
    }

    public func finishHealthSyncRun(_ id: String, report: HealthSyncReport) async throws {
        let _: HealthKitConnectionRecord = try await send(.json("PATCH", "healthkit/sync-runs/\(id)", report))
    }
}
