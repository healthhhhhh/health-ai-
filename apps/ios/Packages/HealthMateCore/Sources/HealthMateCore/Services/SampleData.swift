import Foundation

/// SAMPLE DATA — for UI development only. Mirrors apps/web/src/lib/data/sample-data.ts.
///
/// Values match the design reference so screens can be compared visually. They
/// are not medical guidance or real user data. Task wording is deliberately
/// generic: the app never invents medication names, doses or clinician instructions.
public enum SampleData {
    public static func homeSummary(now: Date) -> HomeSummary {
        func ago(_ minutes: Double) -> Date { now.addingTimeInterval(-minutes * 60) }
        func ahead(_ minutes: Double) -> Date { now.addingTimeInterval(minutes * 60) }

        return HomeSummary(
            user: UserProfile(id: "sample-user", firstName: "Alex", lastName: "Morgan", timeZone: TimeZone.current.identifier),
            metrics: [
                HealthMetric(kind: .heartRate, value: 72, unit: "bpm", recordedAt: ago(20), source: .sample, trend: .inUsualRange),
                HealthMetric(kind: .steps, value: 6428, unit: "steps", recordedAt: ago(15), source: .sample, trend: .inUsualRange, goal: 10000),
                HealthMetric(kind: .sleep, value: 432, unit: "min", recordedAt: ago(600), source: .sample, trend: .inUsualRange),
                HealthMetric(kind: .calories, value: 420, unit: "kcal", recordedAt: ago(15), source: .sample, trend: .noBaseline),
            ],
            todayMood: nil,
            tasks: [
                PlanTask(id: "t1", title: "Morning medication", detail: "As prescribed · after breakfast", category: .medication, scheduledTime: "08:00", completed: true, source: .sample),
                PlanTask(id: "t2", title: "Drink water", detail: "3 of 5 glasses", category: .hydration, scheduledTime: "09:00", completed: false, source: .sample),
                PlanTask(id: "t3", title: "Log blood pressure", detail: "Take a reading", category: .measurement, scheduledTime: "10:00", completed: true, source: .sample),
                PlanTask(id: "t4", title: "Evening walk", detail: "30 minutes", category: .activity, scheduledTime: "18:00", completed: false, source: .sample),
                PlanTask(id: "t5", title: "Wind down for sleep", detail: "Target 7–8 hours", category: .sleep, scheduledTime: "22:30", completed: false, source: .sample),
            ],
            recentActivity: [
                ActivityEvent(id: "a1", kind: .report, title: "Blood test report analyzed", occurredAt: ago(120), source: .sample),
                ActivityEvent(id: "a2", kind: .medication, title: "Morning medication completed", occurredAt: ago(240), source: .sample),
                ActivityEvent(id: "a3", kind: .chat, title: "AI chat: headache follow-up", occurredAt: ago(360), source: .sample),
                ActivityEvent(id: "a4", kind: .sync, title: "Sleep data synced from Apple Health", occurredAt: ago(480), source: .sample),
            ],
            upcomingAppointments: [
                Appointment(id: "ap1", title: "Annual check-up", clinicianName: "Dr. Sam Lee", specialty: "General practice", startsAt: ahead(60 * 24 * 3 + 90), mode: .inPerson),
                Appointment(id: "ap2", title: "Follow-up call", clinicianName: "Dr. Rivera", specialty: "Dermatology", startsAt: ahead(60 * 24 * 9), mode: .video),
            ],
            insight: AIInsight(
                id: "i1",
                message: "You've slept about 25 minutes longer on average this week than last week, and your step count is trending up.",
                basedOn: "your sleep and activity data from the last 14 days",
                generatedAt: ago(30),
                source: .sample
            ),
            unreadNotifications: 2
        )
    }
}
