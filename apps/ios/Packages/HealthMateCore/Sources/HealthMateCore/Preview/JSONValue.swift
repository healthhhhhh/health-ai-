import Foundation

/// A JSON document the Preview backend can read and edit in place. Keeping
/// the sample account as JSON (instead of typed models) means the Preview API
/// returns exactly the wire format of the real API.
public enum JSONValue: Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public subscript(key: String) -> JSONValue {
        get {
            if case .object(let object) = self { return object[key] ?? .null }
            return .null
        }
        set {
            guard case .object(var object) = self else { return }
            object[key] = newValue
            self = .object(object)
        }
    }

    public var string: String? { if case .string(let v) = self { return v }; return nil }
    public var double: Double? { if case .number(let v) = self { return v }; return nil }
    public var int: Int? { double.map { Int($0) } }
    public var bool: Bool? { if case .bool(let v) = self { return v }; return nil }
    public var array: [JSONValue] { if case .array(let v) = self { return v }; return [] }
    public var object: [String: JSONValue] { if case .object(let v) = self { return v }; return [:] }
    public var isNull: Bool { self == .null }

    /// Array elements, editable in place.
    public var items: [JSONValue] {
        get { array }
        set { self = .array(newValue) }
    }
}

extension JSONValue: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let v = try? container.decode(Bool.self) { self = .bool(v) }
        else if let v = try? container.decode(Double.self) { self = .number(v) }
        else if let v = try? container.decode(String.self) { self = .string(v) }
        else if let v = try? container.decode([JSONValue].self) { self = .array(v) }
        else { self = .object(try container.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let v): try container.encode(v)
        case .number(let v):
            // Whole numbers stay integers on the wire (revision: 12, not 12.0).
            if v.rounded() == v, abs(v) < 9_007_199_254_740_992 { try container.encode(Int64(v)) } else { try container.encode(v) }
        case .string(let v): try container.encode(v)
        case .array(let v): try container.encode(v)
        case .object(let v): try container.encode(v)
        }
    }
}

extension JSONValue: ExpressibleByStringLiteral, ExpressibleByBooleanLiteral, ExpressibleByIntegerLiteral, ExpressibleByFloatLiteral, ExpressibleByNilLiteral, ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral {
    public init(stringLiteral value: String) { self = .string(value) }
    public init(booleanLiteral value: Bool) { self = .bool(value) }
    public init(integerLiteral value: Int) { self = .number(Double(value)) }
    public init(floatLiteral value: Double) { self = .number(value) }
    public init(nilLiteral: ()) { self = .null }
    public init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
    public init(dictionaryLiteral elements: (String, JSONValue)...) { self = .object(Dictionary(elements, uniquingKeysWith: { $1 })) }
}

extension JSONValue {
    /// Optional strings become `null`.
    public static func from(_ value: String?) -> JSONValue { value.map { .string($0) } ?? .null }

    public func encoded() -> Data { (try? JSONEncoder().encode(self)) ?? Data("null".utf8) }

    public static func decode(_ data: Data?) -> JSONValue {
        guard let data, !data.isEmpty else { return .object([:]) }
        return (try? JSONDecoder().decode(JSONValue.self, from: data)) ?? .object([:])
    }
}
