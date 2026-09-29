import HealthMateCore
import Observation
import SwiftUI

@MainActor
@Observable
final class TimelineViewModel {
    enum State: Equatable { case idle, loading, loaded, failed(String) }

    private(set) var state: State = .idle
    private(set) var events: [TimelineEventRecord] = []
    private(set) var nextCursor: String?
    private(set) var loadingMore = false
    var filter: TimelineFilter = .all
    var errorMessage: String?

    private let api: APIClient
    private let onSessionEnded: @MainActor (Error) -> Void

    init(api: APIClient, onSessionEnded: @escaping @MainActor (Error) -> Void) {
        self.api = api
        self.onSessionEnded = onSessionEnded
    }

    /// Events grouped by local day, newest first.
    struct DaySection: Identifiable {
        let day: Date
        let events: [TimelineEventRecord]
        var id: Date { day }
    }

    var sections: [DaySection] {
        let calendar = Calendar.current
        let groups = Dictionary(grouping: events) { calendar.startOfDay(for: $0.occurredAt) }
        return groups.keys.sorted(by: >).map { day in
            DaySection(day: day, events: (groups[day] ?? []).sorted { $0.occurredAt > $1.occurredAt })
        }
    }

    /// "Today", "Yesterday" or the full date.
    static func dayTitle(_ day: Date, calendar: Calendar = .current) -> String {
        if calendar.isDateInToday(day) { return "Today" }
        if calendar.isDateInYesterday(day) { return "Yesterday" }
        return day.formatted(.dateTime.weekday(.wide).day().month().year())
    }

    func load() async {
        if events.isEmpty { state = .loading }
        do {
            let page = try await api.timeline(types: filter.eventTypes)
            events = page.events
            nextCursor = page.nextCursor
            state = .loaded
        } catch {
            onSessionEnded(error)
            if events.isEmpty || state != .loaded {
                state = .failed(error as? APIError == .network ? "You're offline. Your timeline will load when you're back online." : (error as? LocalizedError)?.errorDescription ?? "Couldn't load your timeline.")
            }
        }
    }

    func select(_ next: TimelineFilter) async {
        guard next != filter else { return }
        filter = next
        events = []
        nextCursor = nil
        await load()
    }

    func loadMore() async {
        guard let cursor = nextCursor, !loadingMore else { return }
        loadingMore = true
        defer { loadingMore = false }
        if let page = try? await api.timeline(before: cursor, types: filter.eventTypes) {
            events.append(contentsOf: page.events.filter { new in !events.contains { $0.id == new.id } })
            nextCursor = page.nextCursor
        }
    }

    func add(type: String, title: String, occurredAt: Date, details: String?) async -> Bool {
        do {
            try await api.addTimelineEntry(type: type, title: title, occurredAt: occurredAt, details: details)
            await load()
            return true
        } catch {
            onSessionEnded(error)
            errorMessage = (error as? LocalizedError)?.errorDescription
            return false
        }
    }

    func update(_ event: TimelineEventRecord, title: String, occurredAt: Date, details: String?) async -> Bool {
        do {
            try await api.updateTimelineEntry(event.id, title: title, occurredAt: occurredAt, details: details)
            await load()
            return true
        } catch APIError.server(let status, _, _) where status == 404 || status == 405 {
            errorMessage = "Editing entries isn't available on this server yet. You can delete it and add it again."
            return false
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription
            return false
        }
    }

    func delete(_ event: TimelineEventRecord) async -> Bool {
        guard event.isEditable else { return false }
        do {
            try await api.deleteTimelineEntry(event.id)
            events.removeAll { $0.id == event.id }
            return true
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription
            return false
        }
    }

    func event(_ id: String) -> TimelineEventRecord? { events.first { $0.id == id } }

    static func style(for type: String) -> (String, Tone) {
        switch type {
        case "symptom": return ("waveform.path.ecg", .orange)
        case "medication": return ("pills", .teal)
        case "measurement": return ("heart.text.square", .red)
        case "report": return ("doc.text", .blue)
        case "image": return ("photo", .purple)
        case "chat": return ("bubble.left.and.bubble.right", .blue)
        case "appointment": return ("calendar", .green)
        default: return ("note.text", .blue)
        }
    }

    static func typeLabel(_ type: String) -> String {
        switch type {
        case "report": "Report"
        case "image": "Photo"
        case "chat": "Conversation"
        case "symptom": "Symptom"
        case "medication": "Medication"
        case "measurement": "Reading"
        case "appointment": "Appointment"
        default: "Note"
        }
    }

    /// Where an entry came from (spec: the timeline distinguishes sources).
    static func sourceLabel(_ source: String) -> String {
        switch source {
        case "user_entered": return "Added by you"
        case "device": return "From a device"
        case "document": return "From a report"
        case "clinician": return "From your clinician"
        case "ai_summary": return "AI-generated summary"
        default: return source
        }
    }
}

/// Health timeline: every report, conversation, symptom, reading and note in order.
struct HealthTimelineView: View {
    @State private var model: TimelineViewModel
    @State private var showAdd = false
    let session: SessionStore?
    let reader: (any HealthDataReading)?

    init(api: APIClient, onSessionEnded: @escaping @MainActor (Error) -> Void, session: SessionStore? = nil, reader: (any HealthDataReading)? = nil) {
        _model = State(initialValue: TimelineViewModel(api: api, onSessionEnded: onSessionEnded))
        self.session = session
        self.reader = reader
    }

    var body: some View {
        List {
            Section {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(TimelineFilter.allCases) { filter in
                            let selected = model.filter == filter
                            Button(filter.label) { Task { await model.select(filter) } }
                                .font(.hmCaption.weight(.semibold))
                                .padding(.horizontal, 14)
                                .frame(height: 34)
                                .foregroundStyle(selected ? HM.Colors.onPrimary : HM.Colors.textSecondary)
                                .background(Capsule().fill(selected ? HM.Colors.primaryFill : HM.Colors.card))
                                .overlay(Capsule().strokeBorder(selected ? Color.clear : HM.Colors.separator))
                                .buttonStyle(.plain)
                                .accessibilityAddTraits(selected ? .isSelected : [])
                        }
                    }
                    .padding(.horizontal, 16)
                }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            }

            switch model.state {
            case .idle, .loading:
                StateView(state: .loading).frame(maxWidth: .infinity).listRowBackground(Color.clear)
            case .failed(let message):
                EmptyStateView(systemImage: "wifi.exclamationmark", tone: .orange, title: "Couldn't load your timeline", message: message) {
                    Button("Try again") { Task { await model.load() } }.buttonStyle(.hmPrimary)
                }
                .listRowBackground(Color.clear)
            case .loaded where model.events.isEmpty:
                EmptyStateView(systemImage: "clock", title: model.filter == .all ? "Your timeline is empty" : "No \(model.filter.label.lowercased()) yet", message: model.filter.emptyMessage) {
                    if model.filter != .all {
                        Button("Show everything") { Task { await model.select(.all) } }.buttonStyle(.hmSecondary)
                    }
                }
                .listRowBackground(Color.clear)
            case .loaded:
                ForEach(model.sections) { section in
                    Section(TimelineViewModel.dayTitle(section.day)) {
                        ForEach(section.events) { event in
                            NavigationLink {
                                TimelineEntryView(model: model, eventID: event.id, session: session, reader: reader)
                            } label: {
                                let style = TimelineViewModel.style(for: event.eventType)
                                TimelineItem(
                                    systemImage: style.0,
                                    tone: style.1,
                                    title: event.title,
                                    meta: [TimelineViewModel.sourceLabel(event.sourceType), event.details].compactMap { $0 }.joined(separator: " · "),
                                    time: event.occurredAt.formatted(date: .omitted, time: .shortened),
                                    showsConnector: false
                                )
                            }
                        }
                    }
                }
                if model.nextCursor != nil {
                    HStack { Spacer(); ProgressView(); Spacer() }
                        .listRowBackground(Color.clear)
                        .task { await model.loadMore() }
                }
            }
        }
        .navigationTitle("Timeline")
        .refreshable { await model.load() }
        .task { if model.state == .idle { await model.load() } }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { showAdd = true } label: { Image(systemName: "plus") }.accessibilityLabel("Add entry")
            }
        }
        .sheet(isPresented: $showAdd) { TimelineEntryEditor(model: model, editing: nil) }
        .alert("Something went wrong", isPresented: Binding(get: { model.errorMessage != nil && !showAdd }, set: { if !$0 { model.errorMessage = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.errorMessage ?? "")
        }
    }
}

/// One timeline entry: what, when, where it came from, its details and the item it came from.
struct TimelineEntryView: View {
    let model: TimelineViewModel
    let eventID: String
    let session: SessionStore?
    let reader: (any HealthDataReading)?
    @State private var editing = false
    @State private var confirmDelete = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            if let event = model.event(eventID) {
                VStack(alignment: .leading, spacing: HM.Spacing.lg) {
                    let style = TimelineViewModel.style(for: event.eventType)
                    HStack(alignment: .top, spacing: 14) {
                        IconBadge(systemName: style.0, tone: style.1, size: .large)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(TimelineViewModel.typeLabel(event.eventType)).font(.hmCaption.weight(.semibold)).foregroundStyle(HM.Colors.textSecondary)
                            Text(event.title).font(.hmPageHeading).foregroundStyle(HM.Colors.textPrimary).accessibilityAddTraits(.isHeader)
                            Text(event.occurredAt.formatted(date: .complete, time: .shortened)).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                            Text(TimelineViewModel.sourceLabel(event.sourceType))
                                .font(.hmMicro.weight(.semibold))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(Capsule().fill(HM.Colors.cardMuted))
                        }
                    }

                    if let details = event.details {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Details").font(.hmCaption.weight(.semibold)).foregroundStyle(HM.Colors.textSecondary)
                            Text(details).font(.hmBody).foregroundStyle(HM.Colors.textPrimary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .hmCard()
                    }
                    if let severity = event.payload?["severity"].double {
                        Text("How strong (your rating): \(Int(severity)) of 5").font(.hmBody).frame(maxWidth: .infinity, alignment: .leading).hmCard()
                    }

                    related(event)

                    if event.isEditable {
                        HStack {
                            Button("Edit entry") { editing = true }.buttonStyle(.hmSecondary)
                            Button(role: .destructive) { confirmDelete = true } label: { Label("Delete", systemImage: "trash") }
                                .buttonStyle(.hmLink)
                        }
                    } else {
                        Text("\(TimelineViewModel.sourceLabel(event.sourceType)) — it can't be edited here.")
                            .font(.hmCaption)
                            .foregroundStyle(HM.Colors.textSecondary)
                    }
                }
                .padding(HM.Spacing.lg)
                .sheet(isPresented: $editing) { TimelineEntryEditor(model: model, editing: event) }
                .confirmationDialog("Delete this entry?", isPresented: $confirmDelete, titleVisibility: .visible) {
                    Button("Delete", role: .destructive) {
                        Task { if await model.delete(event) { dismiss() } }
                    }
                } message: {
                    Text("“\(event.title)” will be removed from your timeline.")
                }
            } else {
                StateView(state: .empty, title: "Entry not found", message: "It may have been deleted.").padding(.top, 60)
            }
        }
        .background(HM.Colors.background.ignoresSafeArea())
        .navigationTitle("Entry")
        .navigationBarTitleDisplayMode(.inline)
    }

    /// Opens the report, reading or appointment the entry came from, when there's a screen for it here.
    @ViewBuilder
    private func related(_ event: TimelineEventRecord) -> some View {
        switch AppRoute.forTimeline(event) {
        case .report(let id):
            if let session { relatedLink("Open the report") { ReportDestination(session: session, documentID: id) } }
        case .metric(let metric):
            if let reader, let session { relatedLink("See this reading over time") { MetricDestination(metric: metric, reader: reader, api: session.api) } }
        case .appointment(let id):
            if let session { relatedLink("Open the appointment") { AppointmentDetailView(api: session.api, appointmentID: id) } }
        case .conversation:
            Text("From a conversation — open it from Chat › Past conversations.").font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
        default:
            EmptyView()
        }
    }

    private func relatedLink<Destination: View>(_ title: String, @ViewBuilder destination: @escaping () -> Destination) -> some View {
        NavigationLink(destination: destination) {
            Label(title, systemImage: "arrow.up.right.square").frame(maxWidth: .infinity)
        }
        .buttonStyle(.hmSecondary)
    }
}

/// Add or edit an entry. Emergencies are flagged as they're typed.
private struct TimelineEntryEditor: View {
    let model: TimelineViewModel
    let editing: TimelineEventRecord?
    @Environment(\.dismiss) private var dismiss
    @State private var type = "symptom"
    @State private var title = ""
    @State private var details = ""
    @State private var occurredAt = Date()
    @State private var saving = false
    @State private var escalation: Escalation?

    var body: some View {
        NavigationStack {
            Form {
                if let escalation {
                    Section { EscalationCard(escalation: escalation) }
                        .listRowInsets(EdgeInsets())
                }
                if editing == nil {
                    Picker("Type", selection: $type) {
                        Text("Symptom").tag("symptom")
                        Text("Note").tag("note")
                        Text("Appointment").tag("appointment")
                    }
                    .pickerStyle(.segmented)
                }
                TextField(type == "symptom" ? "e.g. Headache, mild" : "Title", text: $title)
                TextField("Details (optional)", text: $details, axis: .vertical).lineLimit(2...5)
                if type == "appointment" {
                    DatePicker("When", selection: $occurredAt)
                } else {
                    DatePicker("When", selection: $occurredAt, in: ...Date())
                }
                if let error = model.errorMessage {
                    Text(error).font(.hmCaption).foregroundStyle(HM.Colors.error)
                }
            }
            .navigationTitle(editing == nil ? "Add to timeline" : "Edit entry")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || saving)
                }
            }
            .onChange(of: title + " " + details) { _, text in
                // Logging a symptom is not a way to reach help — flag emergencies right here.
                let triage = SafetyEngine.triage(text)
                escalation = triage.level >= .urgent ? SafetyEngine.escalation(for: triage) : nil
            }
            .onAppear {
                model.errorMessage = nil
                if let editing {
                    type = editing.eventType
                    title = editing.title
                    details = editing.details ?? ""
                    occurredAt = editing.occurredAt
                }
            }
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedDetails = details.trimmingCharacters(in: .whitespacesAndNewlines)
        let ok: Bool
        if let editing {
            ok = await model.update(editing, title: trimmedTitle, occurredAt: occurredAt, details: trimmedDetails.isEmpty ? nil : trimmedDetails)
        } else {
            ok = await model.add(type: type, title: trimmedTitle, occurredAt: occurredAt, details: trimmedDetails.isEmpty ? nil : trimmedDetails)
        }
        if ok { dismiss() }
    }
}
