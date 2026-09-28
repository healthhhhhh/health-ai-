import HealthMateCore
import SwiftUI

struct HomeHeader: View {
    let user: UserProfile
    let unreadNotifications: Int

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            TimelineView(.everyMinute) { context in
                VStack(alignment: .leading, spacing: 2) {
                    Text(HealthFormat.greeting(hour: Calendar.current.component(.hour, from: context.date), firstName: user.firstName))
                        .font(.hmPageHeading)
                        .foregroundStyle(HM.Colors.textPrimary)
                        .accessibilityAddTraits(.isHeader)
                    Text("How are you feeling today?")
                        .font(.hmBody)
                        .foregroundStyle(HM.Colors.textSecondary)
                }
            }
            Spacer()
            IconButton(
                systemName: "bell",
                label: unreadNotifications > 0 ? "Notifications, \(unreadNotifications) unread" : "Notifications",
                showsBadge: unreadNotifications > 0
            ) {}
            AvatarView(name: user.fullName, size: 42)
        }
    }
}

struct AssistantHeroCard: View {
    let firstName: String
    let onStart: () -> Void

    var body: some View {
        HStack(alignment: .bottom, spacing: 6) {
            MascotView(size: 136, withBackdrop: true)
                .frame(width: 112, height: 150, alignment: .bottom)
                .offset(y: 16)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 8) {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Hi \(firstName), I'm your")
                    Text("AI Health Assistant")
                }
                .font(.system(.headline, design: .default, weight: .bold))
                .foregroundStyle(HM.Colors.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                Text("I can help you understand symptoms, analyze reports, and guide you toward better care.")
                    .font(.caption)
                    .foregroundStyle(HM.Colors.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button(action: onStart) {
                    HStack(spacing: 6) {
                        Text("Start a Conversation")
                        Image(systemName: "arrow.right")
                    }
                }
                .buttonStyle(.hmPrimary(compact: true))
                .padding(.top, 2)
            }
            .padding(.vertical, 18)
            .padding(.trailing, 14)
        }
        .padding(.leading, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: HM.Radius.lg, style: .continuous).fill(HMGradient.hero))
        .clipShape(RoundedRectangle(cornerRadius: HM.Radius.lg, style: .continuous))
    }
}

struct MoodCheckInCard: View {
    let mood: Mood?
    let onSelect: (Mood) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("How are you feeling today?").font(.hmCardTitle).foregroundStyle(HM.Colors.textPrimary)
            MoodSelector(selection: mood, onSelect: onSelect)
            if let mood {
                Text(MoodPresenter.followUp(mood))
                    .font(.hmCaption)
                    .foregroundStyle(HM.Colors.textSecondary)
                    .id(mood)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .animation(HMMotion.spring, value: mood)
        .hmCard()
    }
}

struct TodaysHealthGrid: View {
    let metrics: [HealthMetric]
    let onSeeAll: () -> Void

    private let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "Today's Health", actionTitle: "See All", action: onSeeAll)
            if metrics.isEmpty {
                EmptyStateView(systemImage: "heart.text.square", title: "No health data yet", message: "Connect Apple Health or add a measurement to see your daily snapshot.")
                    .hmCard()
            } else {
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(Array(metrics.enumerated()), id: \.element.id) { index, metric in
                        Button(action: onSeeAll) {
                            MetricCard(presentation: MetricPresenter.present(metric), systemImage: metric.kind.systemImage, beats: metric.kind == .heartRate, showsContext: false)
                        }
                        .buttonStyle(PressableButtonStyle())
                        .appearAnimation(delay: 0.15 + Double(index) * HMMotion.stagger)
                    }
                }
            }
        }
    }
}

struct TodaysPlanCard: View {
    let tasks: [PlanTask]
    let progress: PlanPresenter.Progress
    let celebrationCount: Int
    let onToggle: (String) -> Void
    let onViewPlan: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Today's Plan").font(.hmCardTitle).foregroundStyle(HM.Colors.textPrimary)
                    Text("\(progress.done) of \(progress.total) completed")
                        .font(.hmCaption.weight(.semibold))
                        .foregroundStyle(HM.Colors.success)
                        .contentTransition(.numericText())
                }
                Spacer()
                ProgressRing(value: progress.ratio, lineWidth: 6, accessibilityText: "Today's plan progress") {
                    Text("\(Int((progress.ratio * 100).rounded()))%")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(HM.Colors.textPrimary)
                        .contentTransition(.numericText())
                }
                .frame(width: 48, height: 48)
                .overlay { CelebrationBurst(trigger: celebrationCount) }
            }
            HMProgressBar(value: progress.ratio, label: "Today's plan progress")
                .accessibilityHidden(true)
            if tasks.isEmpty {
                EmptyStateView(systemImage: "checklist", tone: .green, title: "Nothing planned today", message: "Tasks from your care plan and habits you add will show up here.")
            } else {
                VStack(spacing: 0) {
                    ForEach(tasks) { task in
                        TaskRow(
                            title: task.title,
                            detail: task.detail,
                            sourceLabel: PlanPresenter.sourceLabel(task),
                            time: HealthFormat.clockTime(task.scheduledTime, locale: .current),
                            completed: task.completed
                        ) { onToggle(task.id) }
                        if task.id != tasks.last?.id { Divider().overlay(HM.Colors.separator) }
                    }
                }
            }
            Button("View full plan", action: onViewPlan)
                .font(.hmBodyEmphasis)
                .foregroundStyle(HM.Colors.primary)
                .frame(maxWidth: .infinity)
                .padding(.top, 2)
        }
        .animation(HMMotion.spring, value: progress.done)
        .hmCard()
    }
}

struct AppointmentsCard: View {
    let appointments: [Appointment]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Upcoming Appointments").font(.hmCardTitle).foregroundStyle(HM.Colors.textPrimary)
            if appointments.isEmpty {
                Text("No upcoming appointments.").font(.hmBody).foregroundStyle(HM.Colors.textSecondary)
            }
            ForEach(appointments) { appointment in
                HStack(spacing: 12) {
                    IconBadge(systemName: "calendar", tone: .blue, size: .small)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(appointment.title).font(.hmBodyEmphasis).foregroundStyle(HM.Colors.textPrimary)
                        Text("\(appointment.clinicianName) · \(appointment.specialty)")
                            .font(.hmCaption)
                            .foregroundStyle(HM.Colors.textSecondary)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 6)
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(appointment.startsAt, format: .dateTime.weekday(.abbreviated).month(.abbreviated).day())
                            .font(.hmCaption.weight(.semibold))
                            .foregroundStyle(HM.Colors.textPrimary)
                        Label(appointment.mode == .video ? "Video" : "In person", systemImage: appointment.mode == .video ? "video" : "mappin")
                            .font(.hmMicro)
                            .foregroundStyle(HM.Colors.textSecondary)
                    }
                }
                .padding(10)
                .background(RoundedRectangle(cornerRadius: HM.Radius.md, style: .continuous).fill(HM.Colors.cardMuted))
                .accessibilityElement(children: .combine)
            }
        }
        .hmCard()
    }
}

struct RecentActivityCard: View {
    let events: [ActivityEvent]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Recent Activity").font(.hmCardTitle).foregroundStyle(HM.Colors.textPrimary)
            if events.isEmpty {
                Text("Uploads, check-ins and synced data will appear here.").font(.hmBody).foregroundStyle(HM.Colors.textSecondary)
            }
            TimelineView(.everyMinute) { context in
                VStack(spacing: 0) {
                    ForEach(events) { event in
                        TimelineItem(
                            systemImage: event.kind.systemImage,
                            tone: event.kind.tone,
                            title: event.title,
                            time: HealthFormat.relative(event.occurredAt, now: context.date),
                            isLast: event.id == events.last?.id
                        )
                    }
                }
            }
        }
        .hmCard()
    }
}

/// Transient error message that slides up from the bottom.
struct ToastView: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "exclamationmark.circle.fill")
            .font(.hmCaption.weight(.medium))
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(Capsule().fill(Color(hex: 0x1B2336)).hmShadow(HM.Shadow.raised))
            .accessibilityAddTraits(.isStaticText)
    }
}
