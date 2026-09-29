import Foundation

/// The Preview-mode sample account (packages/sample-data, generated JSON).
/// Seven variants, one per weekday; the one matching today's weekday is
/// shifted to today so weekday habits and "3 days ago" line up. Times of day
/// are read in the device's time zone.
public enum SampleAccount {
    /// Loads the account as of `now` in `timeZone`.
    public static func load(now: Date = Date(), timeZone: TimeZone = .current) -> JSONValue {
        guard let url = Bundle.module.url(forResource: "sample-account", withExtension: "json"),
              let data = try? Data(contentsOf: url)
        else { return .object([:]) }
        let file = JSONValue.decode(data)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let weekday = calendar.component(.weekday, from: now) // 1 = Sunday
        let isoWeekday = weekday == 1 ? 7 : weekday - 1
        let variant = file["variants"][String(isoWeekday)]
        guard let generatedFor = variant["generatedFor"].string, let anchor = day(generatedFor, calendar: calendar) else { return variant }
        let today = calendar.startOfDay(for: now)
        let shift = calendar.dateComponents([.day], from: anchor, to: today).day ?? 0
        var account = shifted(variant, key: nil, days: shift, calendar: calendar)
        account["profile"]["profile"]["timeZone"] = .string(timeZone.identifier)
        return account
    }

    private static let timestamp = try! NSRegularExpression(pattern: #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$"#)
    private static let dayOnly = try! NSRegularExpression(pattern: #"^\d{4}-\d{2}-\d{2}$"#)

    private static func matches(_ regex: NSRegularExpression, _ s: String) -> Bool {
        regex.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
    }

    private static func shifted(_ value: JSONValue, key: String?, days: Int, calendar: Calendar) -> JSONValue {
        switch value {
        case .object(let object):
            return .object(Dictionary(uniqueKeysWithValues: object.map { ($0.key, shifted($0.value, key: $0.key, days: days, calendar: calendar)) }))
        case .array(let array):
            return .array(array.map { shifted($0, key: key, days: days, calendar: calendar) })
        case .string(let s) where key != "dateOfBirth":
            if matches(timestamp, s) { return .string(shiftTimestamp(s, days: days, calendar: calendar)) }
            if matches(dayOnly, s), let date = day(s, calendar: calendar), let moved = calendar.date(byAdding: .day, value: days, to: date) {
                return .string(dayString(moved, calendar: calendar))
            }
            return value
        default:
            return value
        }
    }

    /// "2026-01-12T08:00:00" (local wall time) → UTC ISO 8601, `days` later.
    private static func shiftTimestamp(_ s: String, days: Int, calendar: Calendar) -> String {
        let parts = s.split(whereSeparator: { $0 == "-" || $0 == "T" || $0 == ":" }).compactMap { Int($0) }
        guard parts.count == 6 else { return s }
        var components = DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: parts[3], minute: parts[4], second: parts[5])
        components.timeZone = calendar.timeZone
        guard let date = calendar.date(from: components), let moved = calendar.date(byAdding: .day, value: days, to: date) else { return s }
        return PreviewClock.iso(moved)
    }

    static func day(_ s: String, calendar: Calendar) -> Date? {
        let parts = s.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    static func dayString(_ date: Date, calendar: Calendar) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}

/// Timestamps in the Preview API's wire format (UTC, milliseconds), which
/// also sort correctly as strings.
public enum PreviewClock {
    public static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter.string(from: date)
    }
}
