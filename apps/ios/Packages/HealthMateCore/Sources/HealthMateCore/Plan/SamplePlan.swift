import Foundation

/// SAMPLE plan offered on first launch so the screen isn't empty in demo mode.
/// Generic wording only — never a real medication name, dose or instruction.
public enum SamplePlan {
    public static func document(today: DayKey, now: Date) -> PlanDocument {
        func item(_ title: String, _ kind: PlanItemKind, _ h: Int, _ m: Int, notes: String? = nil, instruction: String? = nil) -> PlanItem {
            PlanItem(title: title, notes: notes, kind: kind, time: TimeOfDay(hour: h, minute: m), repeatRule: .daily, reminderEnabled: false, source: .sample, instruction: instruction, startDay: today, createdAt: now)
        }
        let medication = item("Morning medication", .medication, 8, 0, instruction: "As prescribed · after breakfast")
        let water = item("Drink water", .habit, 9, 0, notes: "5 glasses through the day")
        let pressure = item("Log blood pressure", .task, 10, 0, notes: "Take a reading")
        let walk = item("Evening walk", .habit, 18, 0, notes: "30 minutes")
        let sleep = item("Wind down for sleep", .habit, 22, 30, notes: "Target 7–8 hours")
        return PlanDocument(
            items: [medication, water, pressure, walk, sleep],
            completions: [
                PlanCompletion(itemId: medication.id, day: today, completedAt: now),
                PlanCompletion(itemId: pressure.id, day: today, completedAt: now),
            ],
            seeded: true
        )
    }
}
