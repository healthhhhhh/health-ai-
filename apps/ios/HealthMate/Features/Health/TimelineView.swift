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
    var errorMessage: String?

    private let api: APIClient
    private let onSessionEnded: @MainActor (Error) -> Void

    init(api: APIClient, onSessionEnded: @escaping @MainActor (Error) -> Void) {
        self.api = api
        self.onSessionEnded = onSessionEnded
    }

    /// Events grouped by local day, newest first.
    var sections: [(day: Date, events: [TimelineEventRecord])] {
        let calendar = Calendar.current
        let groups = Dictionary(grouping: events) { calendar.startOfDay(for: $0.occurredAt) }
        return groups.keys.sorted(by: >).map { ($0, groups[$0]!.sorted { $0.occurredAt > $1.occurredAt }) }
    }

    func load() async {
        if events.isEmpty { state = .loading }
        do {
            let page = try await api.timeline()
            events = page.events
            nextCursor = page.nextCursor
            state = .loaded
        } catch {
            onSessionEnded(error)
            if events.isEmpty { state = .failed((error as? LocalizedError)?.errorDescription ?? "Couldn't load your timeline.") }
        }
    }

    func loadMore() async {
        guard let cursor = nextCursor, !loadingMore else { return }
        loadingMore = true
        defer { loadingMore = false }
        if let page = try? await api.timeline(before: cursor) {
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

    func delete(_ event: TimelineEventRecord) async {
        guard event.sourceType == "user_entered" else { return }
        do {
            try await api.deleteTimelineEntry(event.id)
            events.removeAll { $0.id == event.id }
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription
        }
    }

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

/// Health timeline: every report, conversation, symptom and note in order.
struct HealthTimelineView: View {
    @State private var model: TimelineViewModel
    @State private var showAdd = false

    init(api: APIClient, onSessionEnded: @escaping @MainActor (Error) -> Void) {
        _model = State(initialValue: TimelineViewModel(api: api, onSessionEnded: onSessionEnded))
    }

    var body: some View {
        List {
            switch model.state {
            case .idle, .loading:
                ProgressView().frame(maxWidth: .infinity).listRowBackground(Color.clear)
            case .failed(let message):
                EmptyStateView(systemImage: "wifi.exclamationmark", tone: .orange, title: "Couldn't load your timeline", message: message) {
                    Button("Try again") { Task { await model.load() } }.buttonStyle(.hmPrimary)
                }
                .listRowBackground(Color.clear)
            case .loaded where model.events.isEmpty:
                EmptyStateView(systemImage: "clock", title: "Your timeline is empty", message: "Reports you upload, conversations and anything you add here will appear in order.")
                    .listRowBackground(Color.clear)
            case .loaded:
                ForEach(model.sections, id: \.day) { section in
                    Section {
                        ForEach(section.events) { event in
                            let style = TimelineViewModel.style(for: event.eventType)
                            TimelineItem(
                                systemImage: style.0,
                                tone: style.1,
                                title: event.title,
                                meta: TimelineViewModel.sourceLabel(event.sourceType),
                                time: event.occurredAt.formatted(date: .omitted, time: .shortened),
                                showsConnector: false
                            )
                            .swipeActions {
                                if event.sourceType == "user_entered" {
                                    Button("Delete", role: .destructive) { Task { await model.delete(event) } }
                                }
                            }
                        }
                    } header: {
                        Text(section.day, format: .dateTime.weekday(.wide).day().month().year())
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
        .task { await model.load() }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { showAdd = true } label: { Image(systemName: "plus") }.accessibilityLabel("Add entry")
            }
        }
        .sheet(isPresented: $showAdd) { AddTimelineEntryView(model: model) }
    }
}

private struct AddTimelineEntryView: View {
    let model: TimelineViewModel
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
                Picker("Type", selection: $type) {
                    Text("Symptom").tag("symptom")
                    Text("Note").tag("note")
                    Text("Appointment").tag("appointment")
                }
                .pickerStyle(.segmented)
                TextField(type == "symptom" ? "e.g. Headache, mild" : "Title", text: $title)
                TextField("Details (optional)", text: $details, axis: .vertical).lineLimit(2...5)
                DatePicker("When", selection: $occurredAt, in: ...Date())
            }
            .navigationTitle("Add to timeline")
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
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let trimmedDetails = details.trimmingCharacters(in: .whitespacesAndNewlines)
        if await model.add(type: type, title: title.trimmingCharacters(in: .whitespacesAndNewlines), occurredAt: occurredAt, details: trimmedDetails.isEmpty ? nil : trimmedDetails) {
            dismiss()
        }
    }
}
