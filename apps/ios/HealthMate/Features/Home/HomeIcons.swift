import HealthMateCore

extension MetricKind {
    var systemImage: String {
        switch self {
        case .heartRate: return "heart.fill"
        case .steps: return "figure.walk"
        case .sleep: return "moon.fill"
        case .calories: return "flame.fill"
        case .water: return "drop.fill"
        case .weight: return "scalemass"
        case .bloodPressure: return "waveform.path.ecg"
        }
    }
}

extension ActivityKind {
    var systemImage: String {
        switch self {
        case .report: return "doc.text"
        case .image: return "photo"
        case .medication: return "pills"
        case .chat: return "message"
        case .sync: return "arrow.triangle.2.circlepath"
        case .symptom: return "stethoscope"
        case .measurement: return "waveform.path.ecg"
        case .note: return "note.text"
        case .appointment: return "calendar"
        }
    }

    var tone: Tone {
        switch self {
        case .report: return .red
        case .medication, .symptom: return .orange
        case .chat: return .blue
        case .sync: return .purple
        case .measurement: return .green
        case .image: return .purple
        case .note: return .blue
        case .appointment: return .teal
        }
    }
}
