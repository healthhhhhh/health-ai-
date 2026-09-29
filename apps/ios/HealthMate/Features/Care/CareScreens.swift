import HealthMateCore
import Observation
import SwiftUI

/// Loads the care team and all appointments for the care screens.
@MainActor
@Observable
final class CareModel {
    private(set) var providers: [CareProviderRecord] = []
    private(set) var appointments: [AppointmentRecord] = []
    private(set) var state: ScreenState? = .loading
    let api: APIClient

    init(api: APIClient) { self.api = api }

    var upcoming: [AppointmentRecord] { AppointmentList.split(appointments).upcoming }
    var past: [AppointmentRecord] { AppointmentList.split(appointments).past }

    func load() async {
        if providers.isEmpty && appointments.isEmpty { state = .loading }
        do {
            async let team = api.careProviders()
            async let all = api.appointments(when: "all")
            (providers, appointments) = try await (team, all)
            state = nil
        } catch {
            state = ScreenState.from(error)
        }
    }
}

/// Emergency help first, then appointments, the care team and finding care nearby. Mirrors web /care.
struct CareHubView: View {
    @State private var model: CareModel
    @State private var showFinder = false
    @State private var addAppointment = false
    @State private var addProvider = false
    @Environment(\.openURL) private var openURL

    init(api: APIClient) { _model = State(initialValue: CareModel(api: api)) }

    private var emergencyNumber: String { SafetyEngine.emergencyNumber(regionCode: Locale.current.region?.identifier) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: HM.Spacing.lg) {
                Button {
                    if let url = URL(string: "tel://\(emergencyNumber)") { openURL(url) }
                } label: {
                    Label("In an emergency, call \(emergencyNumber) now", systemImage: "phone.fill")
                        .font(.hmCardTitle)
                        .foregroundStyle(HM.Colors.error)
                        .padding(16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: HM.Radius.lg).fill(HM.Colors.errorSoft))
                        .overlay(RoundedRectangle(cornerRadius: HM.Radius.lg).strokeBorder(HM.Colors.error.opacity(0.5), lineWidth: 1.5))
                }
                .buttonStyle(PressableButtonStyle(scale: 0.98))

                if let state = model.state {
                    StateView(state: state, title: state == .loading ? nil : state == .offline ? nil : "Your care details couldn't load") {
                        if state != .loading { Button("Try again") { Task { await model.load() } }.buttonStyle(.hmSecondary) }
                    }
                    .hmCard()
                } else {
                    section("Upcoming appointments", destination: AppointmentsListView(model: model)) {
                        if model.upcoming.isEmpty {
                            Text("No upcoming appointments. Add one to keep the time, place and your questions together.")
                                .font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                        }
                        ForEach(model.upcoming.prefix(3)) { appointment in
                            NavigationLink { AppointmentDetailView(api: model.api, appointmentID: appointment.id) } label: { AppointmentRow(appointment: appointment) }
                        }
                        Button { addAppointment = true } label: { Label("Add appointment", systemImage: "plus") }.buttonStyle(.hmSecondary)
                    }
                    section("Your care team", destination: CareTeamView(model: model)) {
                        if model.providers.isEmpty {
                            Text("No one added yet. Add your doctor, clinic or pharmacy to have their details in one place.")
                                .font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                        }
                        ForEach(model.providers.prefix(3)) { provider in
                            NavigationLink { ProviderDetailView(model: model, providerID: provider.id) } label: { ProviderRow(provider: provider) }
                        }
                        Button { addProvider = true } label: { Label("Add to care team", systemImage: "plus") }.buttonStyle(.hmSecondary)
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Find care near you").font(.hmCardTitle)
                    Text("Search nearby emergency departments, urgent care, doctors and pharmacies. HealthMate doesn't rank, rate or endorse providers.")
                        .font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                    Button { showFinder = true } label: { Label("Find care nearby", systemImage: "map") }.buttonStyle(.hmSecondary)
                }
                .padding(HM.Spacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .hmCard()

                VStack(alignment: .leading, spacing: 6) {
                    Text("If you're struggling").font(.hmCardTitle)
                    Text("If you might act on thoughts of harming yourself, call your local emergency number now. Free, confidential crisis lines are listed at findahelpline.com.")
                        .font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                    Link("findahelpline.com", destination: URL(string: "https://findahelpline.com")!).font(.hmCaption.weight(.semibold))
                }
                .padding(HM.Spacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .hmCard()
                DisclaimerView()
            }
            .padding(HM.Spacing.lg)
        }
        .background(HM.Colors.background.ignoresSafeArea())
        .navigationTitle("Care")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load() }
        .refreshable { await model.load() }
        .sheet(isPresented: $showFinder) { CareFinderView() }
        .sheet(isPresented: $addAppointment, onDismiss: { Task { await model.load() } }) { AppointmentEditorView(model: model, existing: nil) }
        .sheet(isPresented: $addProvider, onDismiss: { Task { await model.load() } }) { ProviderEditorView(model: model, existing: nil) }
    }

    private func section<Destination: View, Content: View>(_ title: String, destination: Destination, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title).font(.hmCardTitle)
                Spacer()
                NavigationLink("See all") { destination }.font(.hmCaption.weight(.semibold))
            }
            content()
        }
        .padding(HM.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .hmCard()
    }
}

struct AppointmentRow: View {
    let appointment: AppointmentRecord

    var body: some View {
        HStack(spacing: 12) {
            VStack(spacing: 0) {
                Text(appointment.startsAt.formatted(.dateTime.month(.abbreviated))).font(.hmMicro).textCase(.uppercase)
                Text(appointment.startsAt.formatted(.dateTime.day())).font(.hmCardTitle)
            }
            .foregroundStyle(HM.Colors.primary)
            .frame(width: 48, height: 48)
            .background(RoundedRectangle(cornerRadius: HM.Radius.md).fill(HM.Colors.primarySoft))
            VStack(alignment: .leading, spacing: 2) {
                Text(appointment.title).font(.hmBodyEmphasis).foregroundStyle(HM.Colors.textPrimary).strikethrough(appointment.status == .cancelled)
                Text([appointment.startsAt.formatted(date: .omitted, time: .shortened), appointment.providerName, appointment.mode?.label].compactMap { $0 }.joined(separator: " · "))
                    .font(.hmCaption).foregroundStyle(HM.Colors.textSecondary).lineLimit(2)
            }
            Spacer(minLength: 0)
            if appointment.status != .scheduled {
                Text(appointment.status == .cancelled ? "Cancelled" : "Completed").font(.hmMicro.weight(.semibold)).foregroundStyle(HM.Colors.textSecondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

struct ProviderRow: View {
    let provider: CareProviderRecord

    var body: some View {
        HStack(spacing: 12) {
            IconBadge(systemName: "stethoscope", tone: .teal)
            VStack(alignment: .leading, spacing: 2) {
                Text(provider.name).font(.hmBodyEmphasis).foregroundStyle(HM.Colors.textPrimary)
                if let specialty = provider.specialty { Text(specialty).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary) }
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Upcoming and past appointments. Mirrors web /care/appointments.
struct AppointmentsListView: View {
    let model: CareModel
    @State private var showPast = false
    @State private var adding = false

    var body: some View {
        let list = showPast ? model.past : model.upcoming
        List {
            Section {
                Picker("Show", selection: $showPast) {
                    Text("Upcoming").tag(false)
                    Text("Past").tag(true)
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
            }
            if let state = model.state {
                StateView(state: state).frame(maxWidth: .infinity).listRowBackground(Color.clear)
            } else if list.isEmpty {
                EmptyStateView(systemImage: "calendar", title: showPast ? "No past appointments" : "No upcoming appointments", message: showPast ? "Appointments move here after their time, including ones marked cancelled." : "Add one to keep the time, place and your questions together.")
                    .listRowBackground(Color.clear)
            } else {
                ForEach(list) { appointment in
                    NavigationLink { AppointmentDetailView(api: model.api, appointmentID: appointment.id) } label: { AppointmentRow(appointment: appointment) }
                }
            }
        }
        .navigationTitle("Appointments")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .primaryAction) { Button { adding = true } label: { Image(systemName: "plus") }.accessibilityLabel("Add appointment") } }
        .refreshable { await model.load() }
        .task { await model.load() }
        .sheet(isPresented: $adding, onDismiss: { Task { await model.load() } }) { AppointmentEditorView(model: model, existing: nil) }
    }
}

/// Add or edit an appointment (HealthMate's own record; it never books with the clinic).
struct AppointmentEditorView: View {
    let model: CareModel
    let existing: AppointmentRecord?
    var providerID: String?
    var onSaved: (String) -> Void = { _ in }

    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var careProviderId: String?
    @State private var start = Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: Date().addingTimeInterval(86_400)) ?? Date()
    @State private var minutes = 30
    @State private var mode: AppointmentRecord.Mode = .inPerson
    @State private var location = ""
    @State private var notes = ""
    @State private var prep: [PrepQuestion] = []
    @State private var error: String?
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("What is it? e.g. Annual check-up", text: $title)
                    Picker("With", selection: $careProviderId) {
                        Text("Not in my care team").tag(String?.none)
                        ForEach(model.providers) { Text($0.name).tag(Optional($0.id)) }
                    }
                }
                Section {
                    DatePicker("Date and time", selection: $start)
                    Picker("Length", selection: $minutes) {
                        Text("Not sure").tag(0)
                        ForEach([15, 20, 30, 45, 60, 90], id: \.self) { Text("\($0) min").tag($0) }
                    }
                    Picker("How", selection: $mode) {
                        ForEach(AppointmentRecord.Mode.allCases) { Text($0.label).tag($0) }
                    }
                    TextField("Where (optional)", text: $location)
                }
                Section {
                    TextField("Notes (optional)", text: $notes, axis: .vertical).lineLimit(2...6)
                } footer: {
                    Text("You can add questions to ask on the appointment's page.")
                }
                if let error {
                    Section { Label(error, systemImage: "exclamationmark.circle.fill").foregroundStyle(HM.Colors.error) }
                }
            }
            .navigationTitle(existing == nil ? "Add appointment" : "Edit appointment")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if saving { ProgressView() } else { Button("Save") { Task { await save() } }.accessibilityIdentifier("saveAppointment") }
                }
            }
            .onAppear(perform: fill)
        }
    }

    private func fill() {
        guard let existing else {
            careProviderId = providerID
            return
        }
        title = existing.title
        careProviderId = existing.careProviderId
        start = existing.startsAt
        minutes = existing.endsAt.map { Int($0.timeIntervalSince(existing.startsAt) / 60) } ?? 0
        mode = existing.mode ?? .inPerson
        location = existing.location ?? ""
        let parsed = AppointmentPrep.parse(existing.notes)
        notes = parsed.notes
        prep = parsed.questions
    }

    private func save() async {
        let trim = { (s: String) -> String? in let t = s.trimmingCharacters(in: .whitespacesAndNewlines); return t.isEmpty ? nil : t }
        let draft = AppointmentDraft(
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            careProviderId: careProviderId,
            startsAt: start,
            endsAt: minutes > 0 ? start.addingTimeInterval(TimeInterval(minutes * 60)) : nil,
            mode: mode,
            location: trim(location),
            // The questions checklist lives in the notes; keep it when the notes are edited here.
            notes: AppointmentPrep.serialize(notes: notes, questions: prep)
        )
        if let problem = draft.problem { error = problem; return }
        saving = true
        defer { saving = false }
        do {
            let id = try await model.api.saveAppointment(id: existing?.id, draft)
            await model.load()
            dismiss()
            onSaved(id)
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "Couldn't save the appointment."
        }
    }
}

/// Questions to ask at an appointment, saved into its notes. Mirrors the web checklist.
struct PrepChecklistView: View {
    let api: APIClient
    let appointmentID: String
    let notes: String
    @State var questions: [PrepQuestion]
    @State private var draft = ""
    @State private var error: String?
    @State private var saved = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if questions.isEmpty {
                Text("No questions yet. Add your own, or start from a suggestion below.").font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
            }
            ForEach(questions, id: \.text) { question in
                HStack(spacing: 10) {
                    Button {
                        persist(questions.map { $0 == question ? PrepQuestion(text: $0.text, done: !$0.done) : $0 })
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: question.done ? "checkmark.square.fill" : "square").foregroundStyle(question.done ? HM.Colors.success : HM.Colors.textMuted)
                            Text(question.text).strikethrough(question.done).foregroundStyle(question.done ? HM.Colors.textSecondary : HM.Colors.textPrimary)
                            Spacer(minLength: 0)
                        }
                        .font(.hmBody)
                        .frame(minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(question.text)
                    .accessibilityValue(question.done ? "Asked" : "Not asked")
                    Button { persist(questions.filter { $0 != question }) } label: { Image(systemName: "xmark").foregroundStyle(HM.Colors.textMuted) }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Remove question: \(question.text)")
                }
            }
            HStack {
                TextField("Add a question", text: $draft).textFieldStyle(.roundedBorder).onSubmit { add(draft) }
                Button("Add") { add(draft) }.disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            let unused = AppointmentPrep.suggestions.filter { s in !questions.contains { $0.text == s } }
            if !unused.isEmpty {
                ForEach(unused, id: \.self) { suggestion in
                    Button { add(suggestion) } label: { Label(suggestion, systemImage: "plus").font(.hmCaption).multilineTextAlignment(.leading) }
                        .buttonStyle(.plain)
                        .foregroundStyle(HM.Colors.primary)
                }
            }
            if let error { Text(error).font(.hmCaption).foregroundStyle(HM.Colors.error) } else if saved { Text("Saved.").font(.hmCaption).foregroundStyle(HM.Colors.textSecondary) }
        }
    }

    private func add(_ text: String) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, !questions.contains(where: { $0.text == t }) else { return }
        persist(questions + [PrepQuestion(text: String(t.prefix(200)), done: false)])
        draft = ""
    }

    private func persist(_ next: [PrepQuestion]) {
        let previous = questions
        questions = next
        saved = false
        Task {
            do {
                try await api.setAppointmentNotes(appointmentID, AppointmentPrep.serialize(notes: notes, questions: next))
                error = nil
                saved = true
            } catch {
                questions = previous
                self.error = (error as? LocalizedError)?.errorDescription ?? "Couldn't save your questions."
            }
        }
    }
}

/// The care team. Mirrors web /care/team.
struct CareTeamView: View {
    let model: CareModel
    @State private var adding = false

    var body: some View {
        List {
            if let state = model.state {
                StateView(state: state).frame(maxWidth: .infinity).listRowBackground(Color.clear)
            } else if model.providers.isEmpty {
                EmptyStateView(systemImage: "stethoscope", title: "No one added yet", message: "Add your doctor, clinic or pharmacy to have their phone number and address to hand, and link them to appointments.")
                    .listRowBackground(Color.clear)
            } else {
                ForEach(model.providers.sorted { $0.name < $1.name }) { provider in
                    NavigationLink { ProviderDetailView(model: model, providerID: provider.id) } label: { ProviderRow(provider: provider) }
                }
            }
        }
        .navigationTitle("Care team")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .primaryAction) { Button { adding = true } label: { Image(systemName: "plus") }.accessibilityLabel("Add to care team") } }
        .refreshable { await model.load() }
        .sheet(isPresented: $adding, onDismiss: { Task { await model.load() } }) { ProviderEditorView(model: model, existing: nil) }
    }
}

/// One care team member: contact actions, notes and appointments with them.
struct ProviderDetailView: View {
    let model: CareModel
    let providerID: String
    @State private var editing = false
    @State private var addAppointment = false
    @State private var confirmRemove = false
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    var body: some View {
        Group {
            if let provider = model.providers.first(where: { $0.id == providerID }) {
                content(provider)
            } else {
                EmptyStateView(systemImage: "stethoscope", title: "Not in your care team", message: "They may have been removed.").padding(.top, 60)
            }
        }
        .background(HM.Colors.background.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
    }

    private func content(_ provider: CareProviderRecord) -> some View {
        let appointments = AppointmentList.split(model.appointments.filter { $0.careProviderId == provider.id })
        return ScrollView {
            VStack(alignment: .leading, spacing: HM.Spacing.lg) {
                HStack(spacing: 14) {
                    IconBadge(systemName: "stethoscope", tone: .teal, size: .large)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(provider.name).font(.hmPageHeading)
                        if let specialty = provider.specialty { Text(specialty).font(.hmBody).foregroundStyle(HM.Colors.textSecondary) }
                    }
                }
                VStack(alignment: .leading, spacing: 10) {
                    if let address = provider.address { Label(address, systemImage: "mappin").font(.hmBody) }
                    if let phone = provider.phone, let url = URL(string: "tel:\(phone.filter { !$0.isWhitespace })") {
                        Button { openURL(url) } label: { Label("Call \(phone)", systemImage: "phone.fill") }.buttonStyle(.hmPrimary)
                    }
                    if let address = provider.address, let url = URL(string: "http://maps.apple.com/?q=\(address.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")") {
                        Button { openURL(url) } label: { Label("Directions", systemImage: "arrow.triangle.turn.up.right.diamond") }.buttonStyle(.hmSecondary)
                    }
                    if let website = provider.website, let url = URL(string: website) {
                        Button { openURL(url) } label: { Label("Website", systemImage: "safari") }.buttonStyle(.hmSecondary)
                    }
                    if provider.phone == nil && provider.address == nil && provider.website == nil {
                        Text("No contact details yet. Add them with Edit.").font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                    }
                    if let notes = provider.notes {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Your notes").font(.hmCaption.weight(.semibold)).foregroundStyle(HM.Colors.textSecondary)
                            Text(notes).font(.hmBody)
                        }
                    }
                }
                .padding(HM.Spacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .hmCard()

                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("Appointments").font(.hmCardTitle)
                        Spacer()
                        Button { addAppointment = true } label: { Label("Add", systemImage: "calendar.badge.plus") }.font(.hmCaption.weight(.semibold))
                    }
                    let list = appointments.upcoming + appointments.past.prefix(5)
                    if list.isEmpty { Text("No appointments with \(provider.name) yet.").font(.hmCaption).foregroundStyle(HM.Colors.textSecondary) }
                    ForEach(list) { appointment in
                        NavigationLink { AppointmentDetailView(api: model.api, appointmentID: appointment.id) } label: { AppointmentRow(appointment: appointment) }
                    }
                }
                .padding(HM.Spacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .hmCard()

                Button(role: .destructive) { confirmRemove = true } label: { Label("Remove from care team", systemImage: "trash") }.buttonStyle(.hmLink)
                if let error { Text(error).font(.hmCaption).foregroundStyle(HM.Colors.error) }
            }
            .padding(HM.Spacing.lg)
        }
        .navigationTitle(provider.name)
        .toolbar { ToolbarItem(placement: .primaryAction) { Button("Edit") { editing = true } } }
        .sheet(isPresented: $editing) { ProviderEditorView(model: model, existing: provider) }
        .sheet(isPresented: $addAppointment) { AppointmentEditorView(model: model, existing: nil, providerID: provider.id) }
        .confirmationDialog("Remove “\(provider.name)”?", isPresented: $confirmRemove, titleVisibility: .visible) {
            Button("Remove", role: .destructive) {
                Task {
                    do {
                        try await model.api.deleteCareProvider(provider.id)
                        await model.load()
                        dismiss()
                    } catch {
                        self.error = (error as? LocalizedError)?.errorDescription ?? "Couldn't remove them."
                    }
                }
            }
        } message: {
            Text("Their details are removed from HealthMate. Appointments with them stay, without the link to this contact.")
        }
    }
}

/// Add or edit a care team member.
struct ProviderEditorView: View {
    let model: CareModel
    let existing: CareProviderRecord?

    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var specialty = ""
    @State private var phone = ""
    @State private var address = ""
    @State private var website = ""
    @State private var notes = ""
    @State private var error: String?
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name, e.g. Dr. Rivera", text: $name)
                    TextField("Role or specialty (optional)", text: $specialty)
                }
                Section("Contact") {
                    TextField("Phone (optional)", text: $phone).keyboardType(.phonePad)
                    TextField("Website (optional), https://", text: $website).keyboardType(.URL).textInputAutocapitalization(.never)
                    TextField("Address (optional)", text: $address, axis: .vertical)
                }
                Section {
                    TextField("Notes (optional), e.g. opening hours", text: $notes, axis: .vertical).lineLimit(2...5)
                }
                if let error {
                    Section { Label(error, systemImage: "exclamationmark.circle.fill").foregroundStyle(HM.Colors.error) }
                }
            }
            .navigationTitle(existing == nil ? "Add to care team" : "Edit")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if saving { ProgressView() } else { Button("Save") { Task { await save() } } }
                }
            }
            .onAppear {
                guard let existing else { return }
                name = existing.name
                specialty = existing.specialty ?? ""
                phone = existing.phone ?? ""
                address = existing.address ?? ""
                website = existing.website ?? ""
                notes = existing.notes ?? ""
            }
        }
    }

    private func save() async {
        let trim = { (s: String) -> String? in let t = s.trimmingCharacters(in: .whitespacesAndNewlines); return t.isEmpty ? nil : t }
        let draft = CareProviderDraft(name: name.trimmingCharacters(in: .whitespacesAndNewlines), specialty: trim(specialty), phone: trim(phone), address: trim(address), website: trim(website), notes: trim(notes))
        if let problem = draft.problem { error = problem; return }
        saving = true
        defer { saving = false }
        do {
            try await model.api.saveCareProvider(id: existing?.id, draft)
            await model.load()
            dismiss()
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "Couldn't save."
        }
    }
}
