import Foundation

/// Builds the Home summary from the person's real data: Apple Health daily
/// values, their profile name, today's mood check-in and their timeline.
/// Nothing is invented — sections without data are left empty.
public enum HomeSummaryBuilder {
    public struct Inputs: Sendable {
        public var firstName: String?
        public var lastName: String?
        public var timeZone: String
        /// Recent daily values per metric (at least the last 14 days for trends); nil when Apple Health isn't connected.
        public var dailyValues: [TrackedMetric: [DailyValue]]?
        public var todayMood: MoodCheckIn?
        public var timeline: [TimelineEventRecord]
        /// Appointments from Care; nil when the server has none (then timeline appointments are used).
        public var careAppointments: [AppointmentRecord]?
        public var unreadNotifications = 0

        public init(firstName: String? = nil, lastName: String? = nil, timeZone: String = TimeZone.current.identifier, dailyValues: [TrackedMetric: [DailyValue]]? = nil, todayMood: MoodCheckIn? = nil, timeline: [TimelineEventRecord] = []) {
            self.firstName = firstName
            self.lastName = lastName
            self.timeZone = timeZone
            self.dailyValues = dailyValues
            self.todayMood = todayMood
            self.timeline = timeline
        }
    }

    /// Metrics shown on Home, in display order.
    static let homeMetrics: [(TrackedMetric, MetricKind)] = [
        (.heartRate, .heartRate),
        (.steps, .steps),
        (.sleep, .sleep),
        (.activeEnergy, .calories),
    ]

    public static func build(_ inputs: Inputs, now: Date, calendar: Calendar = .current) -> HomeSummary {
        let user = UserProfile(id: "me", firstName: inputs.firstName ?? "", lastName: inputs.lastName ?? "", timeZone: inputs.timeZone)
        return HomeSummary(
            user: user,
            metrics: metrics(inputs.dailyValues ?? [:], now: now, calendar: calendar),
            todayMood: inputs.todayMood.flatMap { calendar.isDate($0.recordedAt, inSameDayAs: now) ? $0 : nil },
            tasks: [],
            recentActivity: recentActivity(inputs.timeline, now: now),
            upcomingAppointments: inputs.careAppointments.map { appointments($0, now: now) } ?? appointments(inputs.timeline, now: now),
            insight: nil,
            unreadNotifications: inputs.unreadNotifications
        )
    }

    /// Today's value per metric (last night for sleep), with the trend of the
    /// last 7 days against the 7 before — the same comparison as the Health tab.
    static func metrics(_ values: [TrackedMetric: [DailyValue]], now: Date, calendar: Calendar) -> [HealthMetric] {
        let today = calendar.startOfDay(for: now)
        return homeMetrics.compactMap { tracked, kind in
            let series = values[tracked] ?? []
            guard let todays = series.first(where: { calendar.isDate($0.date, inSameDayAs: today) }) else { return nil }
            let parts = TrendAnalysis.split(series, days: 7, now: now, calendar: calendar)
            let trend = TrendAnalysis.summarize(recent: parts.recent, baseline: parts.baseline).trend
            // Shown in the person's units (weight may be pounds); the trend compares stored values.
            let value = tracked.displayValue(todays.value)
            let shownUnit = tracked == .weight ? (tracked.displayUnit ?? unit(for: kind)) : unit(for: kind)
            return HealthMetric(kind: kind, value: value, unit: shownUnit, recordedAt: now, source: .appleHealth, trend: trend)
        }
    }

    static func unit(for kind: MetricKind) -> String {
        switch kind {
        case .heartRate: return "bpm"
        case .steps: return "steps"
        case .sleep: return "min"
        case .calories: return "kcal"
        case .water: return "glasses"
        case .weight: return "kg"
        case .bloodPressure: return "mmHg"
        }
    }

    static func recentActivity(_ timeline: [TimelineEventRecord], now: Date, limit: Int = 4) -> [ActivityEvent] {
        timeline
            .filter { $0.occurredAt <= now }
            .sorted { $0.occurredAt > $1.occurredAt }
            .prefix(limit)
            .map { ActivityEvent(id: $0.id, kind: activityKind($0.eventType), title: $0.title, occurredAt: $0.occurredAt, source: dataSource($0.sourceType), link: AppRoute.forTimeline($0).link) }
    }

    /// Scheduled Care appointments that haven't started yet, soonest first.
    static func appointments(_ records: [AppointmentRecord], now: Date, limit: Int = 3) -> [Appointment] {
        records
            .filter { $0.status == .scheduled && $0.startsAt > now }
            .sorted { $0.startsAt < $1.startsAt }
            .prefix(limit)
            .map { record in
                let mode: Appointment.Mode = switch record.mode {
                case .video: .video
                case .phone: .phone
                default: .inPerson
                }
                return Appointment(id: record.id, title: record.title, clinicianName: record.providerName ?? "", specialty: record.location ?? "", startsAt: record.startsAt, mode: mode, isCareAppointment: true)
            }
    }

    /// Appointments the person added to their timeline with a future date.
    static func appointments(_ timeline: [TimelineEventRecord], now: Date, limit: Int = 3) -> [Appointment] {
        timeline
            .filter { $0.eventType == "appointment" && $0.occurredAt > now }
            .sorted { $0.occurredAt < $1.occurredAt }
            .prefix(limit)
            .map { Appointment(id: $0.id, title: $0.title, clinicianName: "", specialty: "", startsAt: $0.occurredAt, mode: .inPerson) }
    }

    static func activityKind(_ eventType: String) -> ActivityKind {
        switch eventType {
        case "report": return .report
        case "image": return .image
        case "medication": return .medication
        case "chat": return .chat
        case "symptom": return .symptom
        case "measurement": return .measurement
        case "appointment": return .appointment
        default: return .note
        }
    }

    static func dataSource(_ sourceType: String) -> DataSource {
        switch sourceType {
        case "device": return .appleHealth
        case "document": return .documentExtracted
        case "clinician": return .clinicianProvided
        case "ai_summary": return .aiInferred
        default: return .userReported
        }
    }
}
