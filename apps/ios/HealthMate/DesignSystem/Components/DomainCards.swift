import HealthMateCore
import SwiftUI

/// An appointment: date tile, title, provider, time, mode and status.
struct AppointmentCard: View {
    enum Mode: String { case inPerson = "in_person", video, phone }

    let title: String
    var providerName: String?
    let startsAt: Date
    var mode: Mode?
    var location: String?
    var status = "scheduled"

    private var cancelled: Bool { status == "cancelled" }

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(spacing: 0) {
                Text(startsAt, format: .dateTime.month(.abbreviated)).font(.hmMicro).textCase(.uppercase)
                Text(startsAt, format: .dateTime.day()).font(.hmSectionHeading.monospacedDigit())
                Text(startsAt, format: .dateTime.weekday(.abbreviated)).font(.hmMicro)
            }
            .foregroundStyle(cancelled ? HM.Colors.textMuted : HM.Colors.primary)
            .frame(width: 54)
            .padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: HM.Radius.md, style: .continuous).fill(cancelled ? HM.Colors.cardMuted : HM.Colors.primarySoft))

            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.hmBodyEmphasis).foregroundStyle(HM.Colors.textPrimary).strikethrough(cancelled, color: HM.Colors.textMuted)
                if let providerName { Text(providerName).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary) }
                HStack(spacing: 10) {
                    Text(startsAt, format: .dateTime.hour().minute())
                    if let mode {
                        Label(mode == .inPerson ? "In person" : mode == .video ? "Video call" : "Phone call", systemImage: mode == .inPerson ? "mappin" : mode == .video ? "video" : "phone")
                    }
                }
                .font(.hmCaption)
                .foregroundStyle(HM.Colors.textSecondary)
                if let location, mode == .inPerson { Text(location).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary).lineLimit(1) }
            }
            Spacer(minLength: 0)
            if cancelled { StatusBadge(status: .neutral, text: "Cancelled") }
            if status == "completed" { StatusBadge(status: .success, text: "Completed") }
        }
        .hmCard(padding: 14)
        .accessibilityElement(children: .combine)
    }
}

/// A clinician, clinic or pharmacy in the person's care team.
struct ProviderCard: View {
    let name: String
    var specialty: String?
    var address: String?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            IconBadge(systemName: "stethoscope", tone: .teal)
            VStack(alignment: .leading, spacing: 3) {
                Text(name).font(.hmBodyEmphasis).foregroundStyle(HM.Colors.textPrimary)
                if let specialty { Text(specialty).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary) }
                if let address {
                    Label(address, systemImage: "mappin").font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(HM.Colors.textMuted).accessibilityHidden(true)
        }
        .hmCard(padding: 14)
        .accessibilityElement(children: .combine)
    }
}

/// One notification; unread ones have a dot and bold title (never colour alone).
struct NotificationRow: View {
    let category: NotificationCategory
    let title: String
    let message: String
    let createdAt: Date
    let read: Bool
    var aiGenerated = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            IconBadge(systemName: category.systemImage, tone: category.tone, size: .small)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    if !read { Circle().fill(HM.Colors.primaryFill).frame(width: 8, height: 8) }
                    Text(title).font(read ? .hmBody : .hmBodyEmphasis).foregroundStyle(HM.Colors.textPrimary)
                }
                Text(message).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                Text("\(createdAt.formatted(.relative(presentation: .named)))\(aiGenerated ? " · AI-generated" : "")")
                    .font(.hmMicro)
                    .foregroundStyle(HM.Colors.textMuted)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(read ? "" : "Unread: ")\(title). \(message)")
    }
}

/// A medication exactly as recorded, with the last 7 days. Never suggests a dose change.
struct MedicationCard: View {
    let name: String
    let instruction: String
    let sourceLabel: String
    var schedule: String?
    var takenToday = false
    var active = true
    /// Oldest first: true taken, false missed, nil not scheduled.
    var lastSevenDays: [Bool?] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                IconBadge(systemName: "pills", tone: active ? .blue : .purple)
                VStack(alignment: .leading, spacing: 3) {
                    Text(name).font(.hmBodyEmphasis).foregroundStyle(HM.Colors.textPrimary)
                    Text("“\(instruction)”").font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                    Text([sourceLabel, schedule].compactMap { $0 }.joined(separator: " · ")).font(.hmMicro).foregroundStyle(HM.Colors.textMuted)
                }
                Spacer(minLength: 0)
                if !active {
                    StatusBadge(status: .neutral, text: "Stopped")
                } else if takenToday {
                    StatusBadge(status: .success, text: "Taken today")
                }
            }
            if !lastSevenDays.isEmpty {
                HStack(spacing: 5) {
                    ForEach(Array(lastSevenDays.enumerated()), id: \.offset) { _, day in
                        Capsule()
                            .fill(day == true ? HM.Colors.successFill : day == false ? HM.Colors.warningSoft : HM.Colors.cardMuted)
                            .frame(height: 6)
                    }
                }
                .accessibilityElement()
                .accessibilityLabel("Last 7 days: \(lastSevenDays.filter { $0 == true }.count) of \(lastSevenDays.filter { $0 != nil }.count) doses logged")
            }
        }
        .hmCard(padding: 14)
    }
}
