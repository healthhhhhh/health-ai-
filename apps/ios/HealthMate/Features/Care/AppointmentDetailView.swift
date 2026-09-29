import HealthMateCore
import SwiftUI

/// One appointment: when and where, notes, the provider, prepare with the
/// assistant, and marking it cancelled (HealthMate's record only).
struct AppointmentDetailView: View {
    let api: APIClient
    let appointmentID: String
    var onAsk: (String) -> Void = { _ in }

    @State private var appointment: AppointmentRecord?
    @State private var provider: CareProviderRecord?
    @State private var state: ScreenState? = .loading
    @State private var confirmCancel = false
    @State private var errorMessage: String?
    @Environment(\.openURL) private var openURL

    var body: some View {
        ScrollView {
            if let state {
                StateView(state: state, title: state == .empty ? "Appointment not found" : nil, message: state == .empty ? "It may have been removed." : nil) {
                    if state != .loading && state != .empty {
                        Button("Try again") { Task { await load() } }.buttonStyle(.hmSecondary)
                    }
                }
                .padding(.top, 60)
            } else if let appointment {
                content(appointment)
            }
        }
        .background(HM.Colors.background.ignoresSafeArea())
        .navigationTitle("Appointment")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .confirmationDialog("Mark “\(appointment?.title ?? "this appointment")” as cancelled?", isPresented: $confirmCancel, titleVisibility: .visible) {
            Button("Mark as cancelled", role: .destructive) { Task { await cancel() } }
        } message: {
            Text("This only updates HealthMate and stops its reminders. It doesn't contact the clinic — call them to cancel or rearrange.")
        }
        .alert("Something went wrong", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private func content(_ appointment: AppointmentRecord) -> some View {
        let upcoming = appointment.status == .scheduled && appointment.startsAt > Date()
        return VStack(alignment: .leading, spacing: HM.Spacing.lg) {
            VStack(alignment: .leading, spacing: 6) {
                Text(appointment.title)
                    .font(.hmPageHeading)
                    .foregroundStyle(HM.Colors.textPrimary)
                    .strikethrough(appointment.status == .cancelled)
                    .accessibilityAddTraits(.isHeader)
                if let name = appointment.providerName {
                    Text("With \(name)").font(.hmBody).foregroundStyle(HM.Colors.textSecondary)
                }
                switch appointment.status {
                case .cancelled: StatusPill(text: "Cancelled", color: HM.Colors.textSecondary)
                case .completed: StatusPill(text: "Completed", color: HM.Colors.success)
                case .scheduled: if upcoming { StatusPill(text: "Upcoming", color: HM.Colors.primary) }
                }
            }

            VStack(alignment: .leading, spacing: 14) {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(appointment.startsAt, format: .dateTime.weekday(.wide).month(.wide).day().year()).font(.hmBodyEmphasis)
                        Text(timeText(appointment)).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                    }
                } icon: {
                    Image(systemName: "clock").foregroundStyle(HM.Colors.primary)
                }
                if let mode = appointment.mode {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(mode == .inPerson ? "In person" : mode == .video ? "Video call" : "Phone call").font(.hmBodyEmphasis)
                            if let location = appointment.location { Text(location).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary) }
                        }
                    } icon: {
                        Image(systemName: mode == .inPerson ? "mappin" : mode == .video ? "video" : "phone").foregroundStyle(HM.Colors.primary)
                    }
                }
                if let notes = appointment.notes, !notes.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Your notes").font(.hmCaption.weight(.semibold)).foregroundStyle(HM.Colors.textSecondary)
                        Text(notes).font(.hmBody).foregroundStyle(HM.Colors.textPrimary)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: HM.Radius.md, style: .continuous).fill(HM.Colors.cardMuted))
                }
                if let location = appointment.location, appointment.mode == .inPerson,
                   let url = URL(string: "http://maps.apple.com/?q=\(location.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")") {
                    Button {
                        openURL(url)
                    } label: {
                        Label("Directions", systemImage: "arrow.triangle.turn.up.right.diamond")
                    }
                    .buttonStyle(.hmSecondary)
                }
            }
            .foregroundStyle(HM.Colors.textPrimary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .hmCard()

            if upcoming {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Prepare for this visit").font(.hmCardTitle).foregroundStyle(HM.Colors.textPrimary)
                    Text("Write down questions and what you'd like to mention, with help from the AI Health Assistant.")
                        .font(.hmCaption)
                        .foregroundStyle(HM.Colors.textSecondary)
                    Button {
                        onAsk("Help me prepare questions for my appointment: \(appointment.title).")
                    } label: {
                        Label("Prepare with the assistant", systemImage: "sparkles")
                    }
                    .buttonStyle(.hmSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .hmCard()
            }

            if let provider {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Provider").font(.hmCardTitle).foregroundStyle(HM.Colors.textPrimary)
                    ProviderCard(name: provider.name, specialty: provider.specialty, address: provider.address)
                    if let phone = provider.phone, let url = URL(string: "tel:\(phone.filter { !$0.isWhitespace })") {
                        Button {
                            openURL(url)
                        } label: {
                            Label("Call \(phone)", systemImage: "phone")
                        }
                        .buttonStyle(.hmSecondary)
                    }
                }
            }

            if upcoming {
                Button(role: .destructive) { confirmCancel = true } label: {
                    Label("Mark as cancelled", systemImage: "calendar.badge.minus")
                }
                .buttonStyle(.hmLink)
            }
            DisclaimerView(text: "HealthMate keeps your own record of appointments. For changes, contact the clinic directly.")
        }
        .padding(HM.Spacing.lg)
    }

    private func timeText(_ appointment: AppointmentRecord) -> String {
        let time = appointment.startsAt.formatted(date: .omitted, time: .shortened)
        guard let end = appointment.endsAt else { return time }
        return "\(time) · \(Int(end.timeIntervalSince(appointment.startsAt) / 60)) min"
    }

    private func load() async {
        if appointment == nil { state = .loading }
        do {
            let record = try await api.appointment(appointmentID)
            appointment = record
            state = nil
            if let id = record.careProviderId { provider = try? await api.careProvider(id) }
        } catch APIError.server(404, _, _) {
            state = .empty
        } catch {
            state = ScreenState.from(error)
        }
    }

    private func cancel() async {
        do {
            try await api.setAppointmentStatus(appointmentID, .cancelled)
            appointment?.status = .cancelled
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Couldn't update the appointment."
        }
    }
}

private struct StatusPill: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.hmCaption.weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(Capsule().fill(color.opacity(0.12)))
    }
}
