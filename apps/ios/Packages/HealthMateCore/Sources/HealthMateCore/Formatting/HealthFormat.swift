import Foundation

/// Pure formatting helpers shared by all screens. Mirrors apps/web/src/lib/format.ts.
public enum HealthFormat {
    public enum DayPart: String, Sendable { case morning, afternoon, evening }

    public static func dayPart(hour: Int) -> DayPart {
        switch hour {
        case 5..<12: return .morning
        case 12..<17: return .afternoon
        default: return .evening
        }
    }

    public static func greeting(hour: Int, firstName: String? = nil) -> String {
        let base = "Good \(dayPart(hour: hour).rawValue.capitalized)"
        guard let firstName, !firstName.isEmpty else { return base }
        return "\(base), \(firstName)"
    }

    /// 432 → "7h 12m"; 45 → "45m"; 120 → "2h".
    public static func duration(minutes: Double) -> String {
        let total = max(0, Int(minutes.rounded()))
        let hours = total / 60
        let rest = total % 60
        if hours == 0 { return "\(rest)m" }
        return rest == 0 ? "\(hours)h" : "\(hours)h \(rest)m"
    }

    public static func number(_ value: Double, locale: Locale = Locale(identifier: "en_US")) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 1
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    /// "08:00" → "8:00 AM" (locale-aware). Returns the input unchanged if malformed.
    public static func clockTime(_ hhmm: String, locale: Locale = Locale(identifier: "en_US")) -> String {
        let parts = hhmm.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2, (0..<24).contains(parts[0]), (0..<60).contains(parts[1]) else { return hhmm }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        guard let date = calendar.date(from: DateComponents(year: 2000, month: 1, day: 1, hour: parts[0], minute: parts[1])) else { return hhmm }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = calendar.timeZone
        formatter.setLocalizedDateFormatFromTemplate("jmm")
        return formatter.string(from: date)
    }

    /// Relative time with an explicit `now`, e.g. "2 hours ago", "in 3 days".
    public static func relative(_ date: Date, now: Date) -> String {
        let diff = now.timeIntervalSince(date)
        let future = diff < 0
        let minutes = Int((abs(diff) / 60).rounded())
        func wrap(_ s: String) -> String { future ? "in \(s)" : "\(s) ago" }
        if minutes < 1 { return "just now" }
        if minutes < 60 { return wrap("\(minutes) min") }
        let hours = Int((Double(minutes) / 60).rounded())
        if hours < 24 { return wrap("\(hours) hour\(hours == 1 ? "" : "s")") }
        let days = Int((Double(hours) / 24).rounded())
        if days == 1 { return future ? "tomorrow" : "yesterday" }
        return wrap("\(days) days")
    }
}
