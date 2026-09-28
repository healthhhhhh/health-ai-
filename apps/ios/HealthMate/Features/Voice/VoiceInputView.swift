import SwiftUI

/// Ask by voice: live transcript the person can correct before sending.
struct VoiceInputView: View {
    var onSend: (String) -> Void

    @State private var recognizer = SpeechRecognizer()
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.openURL) private var openURL

    private var trimmed: String { recognizer.transcript.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            VStack(spacing: 18) {
                micButton
                    .padding(.top, 8)
                Text(statusText)
                    .font(.hmCaption.weight(.medium))
                    .foregroundStyle(statusIsProblem ? HM.Colors.error : HM.Colors.textSecondary)
                    .multilineTextAlignment(.center)
                    .accessibilityAddTraits(.updatesFrequently)
                if case .denied = recognizer.state {
                    Button("Open Settings") {
                        if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                    }
                    .buttonStyle(.hmLink)
                }
                TextField("Your question will appear here", text: $recognizer.transcript, axis: .vertical)
                    .font(.hmBody)
                    .lineLimit(2...6)
                    .padding(14)
                    .background(RoundedRectangle(cornerRadius: HM.Radius.md, style: .continuous).fill(HM.Colors.card))
                    .overlay(RoundedRectangle(cornerRadius: HM.Radius.md, style: .continuous).strokeBorder(HM.Colors.separator))
                    .accessibilityLabel("Transcript")
                    .accessibilityHint("You can edit the text before sending")
                Button("Ask HealthMate") {
                    recognizer.stop()
                    onSend(trimmed)
                    dismiss()
                }
                .buttonStyle(.hmPrimary(fullWidth: true))
                .disabled(trimmed.isEmpty)
                Spacer(minLength: 0)
            }
            .padding(HM.Spacing.lg)
            .background(HM.Colors.background.ignoresSafeArea())
            .navigationTitle("Ask by voice")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        recognizer.stop()
                        dismiss()
                    }
                }
            }
        }
        .task { await recognizer.start() }
        .onDisappear { recognizer.stop() }
    }

    private var statusIsProblem: Bool {
        switch recognizer.state {
        case .denied, .failed: return true
        default: return false
        }
    }

    private var statusText: String {
        switch recognizer.state {
        case .idle: return trimmed.isEmpty ? "Tap the microphone and describe what's going on." : "Check the text, then ask."
        case .requestingPermission: return "Waiting for permission…"
        case .listening: return "Listening… tap to stop"
        case .denied(let message), .failed(let message): return message
        }
    }

    private var micButton: some View {
        Button {
            if recognizer.isListening { recognizer.stop() } else { Task { await recognizer.start() } }
        } label: {
            ZStack {
                Circle()
                    .fill(HM.Colors.primaryTint.opacity(0.45))
                    .frame(width: 112, height: 112)
                    .scaleEffect(reduceMotion ? 1 : 1 + recognizer.level * 0.35)
                    .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: recognizer.level)
                Circle()
                    .fill(recognizer.isListening ? HM.Colors.errorFill : HM.Colors.primaryFill)
                    .frame(width: 78, height: 78)
                    .hmShadow(HM.Shadow.raised)
                Image(systemName: recognizer.isListening ? "stop.fill" : "mic.fill")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(HM.Colors.onPrimary)
                    .contentTransition(.symbolEffect(.replace))
            }
        }
        .buttonStyle(PressableButtonStyle(scale: 0.93))
        .accessibilityLabel(recognizer.isListening ? "Stop listening" : "Start listening")
        .sensoryFeedback(.impact(weight: .light), trigger: recognizer.isListening)
    }
}
