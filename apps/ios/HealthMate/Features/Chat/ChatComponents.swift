import HealthMateCore
import SwiftUI

/// Red (emergency) or orange (urgent) card with direct actions. Always placed
/// above any other content so urgent guidance is never buried (spec §17.3).
struct EscalationCard: View {
    let escalation: Escalation
    var onFindCare: () -> Void = {}

    @Environment(\.openURL) private var openURL

    private var tone: Tone { escalation.level == .emergency ? .red : .orange }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(escalation.title, systemImage: escalation.level == .emergency ? "exclamationmark.triangle.fill" : "exclamationmark.circle.fill")
                .font(.hmCardTitle)
                .foregroundStyle(tone.color)
            Text(escalation.body)
                .font(.hmBody)
                .foregroundStyle(HM.Colors.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            VStack(spacing: 8) {
                ForEach(escalation.actions, id: \.label) { action in
                    Button { perform(action) } label: {
                        Label(action.label, systemImage: icon(for: action.kind)).frame(maxWidth: .infinity)
                    }
                    .buttonStyle(action.kind == .callEmergency ? AnyButtonStyle(.hmPrimary(fullWidth: true, compact: true)) : AnyButtonStyle(.hmSecondary))
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: HM.Radius.lg, style: .continuous).fill(tone.softColor))
        .overlay(RoundedRectangle(cornerRadius: HM.Radius.lg, style: .continuous).strokeBorder(tone.color.opacity(0.5), lineWidth: 1.5))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(escalation.level == .emergency ? "Emergency guidance" : "Urgent guidance")
    }

    private func icon(for kind: EscalationAction.Kind) -> String {
        switch kind {
        case .callEmergency: return "phone.fill"
        case .crisisSupport: return "heart.text.square"
        case .contactClinician: return "stethoscope"
        case .findCare: return "mappin.and.ellipse"
        }
    }

    private func perform(_ action: EscalationAction) {
        switch action.kind {
        case .callEmergency:
            let number = SafetyEngine.emergencyNumber(regionCode: Locale.current.region?.identifier)
            if let url = URL(string: "tel://\(number)") { openURL(url) }
        case .crisisSupport:
            // International directory of free, confidential crisis lines.
            if let url = URL(string: "https://findahelpline.com") { openURL(url) }
        case .contactClinician, .findCare:
            onFindCare()
        }
    }
}

/// Type-erased button style so a view can choose between styles at runtime.
struct AnyButtonStyle: ButtonStyle {
    private let make: (Configuration) -> AnyView
    init<S: ButtonStyle>(_ style: S) { make = { AnyView(style.makeBody(configuration: $0)) } }
    func makeBody(configuration: Configuration) -> some View { make(configuration) }
}

/// Tappable answers for the assistant's follow-up question (reference: Mild / Moderate / Severe chips, symptom checkboxes).
struct FollowUpOptionsView: View {
    let followUp: FollowUpQuestion
    let enabled: Bool
    let onAnswer: (String) -> Void

    @State private var selected: Set<String> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if followUp.allowsMultiple {
                ForEach(followUp.options, id: \.self) { option in
                    Button {
                        if selected.contains(option) { selected.remove(option) } else { selected.insert(option) }
                    } label: {
                        HStack(spacing: 10) {
                            CheckBox(checked: selected.contains(option))
                            Text(option).font(.hmBody).foregroundStyle(HM.Colors.textPrimary)
                            Spacer()
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(selected.contains(option) ? AccessibilityTraits([.isButton, .isSelected]) : AccessibilityTraits.isButton)
                }
                Button("Send") { onAnswer(selected.isEmpty ? "None of these" : selected.sorted().joined(separator: ", ")) }
                    .buttonStyle(.hmPrimary(compact: true))
            } else {
                FlowLayout(spacing: 8) {
                    ForEach(followUp.options, id: \.self) { option in
                        Button(option) { onAnswer(option) }
                            .font(.hmBodyEmphasis)
                            .foregroundStyle(HM.Colors.primary)
                            .padding(.horizontal, 16)
                            .frame(minHeight: 38)
                            .background(Capsule().fill(HM.Colors.primarySoft))
                            .buttonStyle(PressableButtonStyle(scale: 0.94))
                    }
                }
            }
        }
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.5)
    }
}

/// Wraps chips onto multiple lines.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x + size.width > width, x > 0 { x = 0; y += rowHeight + spacing; rowHeight = 0 }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: width == .infinity ? x : width, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX, x > bounds.minX { x = bounds.minX; y += rowHeight + spacing; rowHeight = 0 }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

/// Renders one assistant turn: escalation, answer, warning signs, care advice,
/// notices and memory suggestions — in that order of importance.
struct AssistantTurnView: View {
    let message: ChatMessageRecord
    let isLatest: Bool
    let savedSuggestions: Set<String>
    let onAnswer: (String) -> Void
    let onSaveSuggestion: (String) -> Void
    let onFindCare: () -> Void
    /// Preview mode: a fixed sample response, labelled as such (never presented as a real AI).
    var isSample = false

    var body: some View {
        switch message.payload {
        case .escalation(let escalation):
            EscalationCard(escalation: escalation, onFindCare: onFindCare)
        case .answer(let answer):
            VStack(alignment: .leading, spacing: 10) {
                if let escalation = answer.escalation { EscalationCard(escalation: escalation, onFindCare: onFindCare) }
                ChatBubble(author: .assistant, text: answer.answer) {
                    if let followUp = answer.followUp {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(followUp.question).font(.hmBodyEmphasis)
                            FollowUpOptionsView(followUp: followUp, enabled: isLatest, onAnswer: onAnswer)
                        }
                    }
                }
                if !answer.warningSigns.isEmpty {
                    InfoPanel(title: "Get help quickly if you notice", systemImage: "exclamationmark.triangle", tone: .orange, items: answer.warningSigns)
                }
                if let care = answer.careRecommendation {
                    Label(care.text, systemImage: "stethoscope")
                        .font(.hmCaption.weight(.medium))
                        .foregroundStyle(HM.Colors.textPrimary)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: HM.Radius.md).fill(HM.Colors.primarySoft))
                }
                // The per-answer label already says it's a sample, so the sample notice isn't repeated.
                if let notice = answer.notice, !(isSample && notice == PreviewBackend.sampleNotice) {
                    Label(notice, systemImage: "pills")
                        .font(.hmCaption)
                        .foregroundStyle(HM.Colors.textSecondary)
                }
                ForEach(answer.memorySuggestions, id: \.fact) { suggestion in
                    let saved = savedSuggestions.contains(suggestion.fact)
                    HStack(spacing: 8) {
                        Image(systemName: saved ? "checkmark.circle.fill" : "brain.head.profile").foregroundStyle(HM.Colors.purple)
                        Text(suggestion.fact).font(.hmCaption).foregroundStyle(HM.Colors.textPrimary)
                        Spacer(minLength: 6)
                        Button(saved ? "Saved" : "Remember") { onSaveSuggestion(suggestion.fact) }
                            .font(.hmCaption.weight(.semibold))
                            .disabled(saved)
                    }
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: HM.Radius.md).fill(HM.Colors.purpleSoft))
                    .accessibilityElement(children: .combine)
                    .accessibilityHint(saved ? "" : "Saves this to your health memory")
                }
                Label(footer(answer), systemImage: isSample ? "flask" : "sparkles")
                    .font(.hmMicro)
                    .foregroundStyle(HM.Colors.textMuted)
                    .padding(.leading, 38)
            }
        case .none:
            ChatBubble(author: .assistant, text: message.content)
        }
    }

    private func footer(_ answer: AssistantAnswer) -> String {
        let base = isSample ? "Sample response in Preview mode · not a real AI, not medical advice" : "AI-generated · not a diagnosis"
        return answer.safetyAdjusted ? "\(base) · A safety check replaced part of this answer." : base
    }
}

struct InfoPanel: View {
    let title: String
    let systemImage: String
    let tone: Tone
    let items: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: systemImage).font(.hmCaption.weight(.semibold)).foregroundStyle(tone.color)
            ForEach(items, id: \.self) { item in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("•").foregroundStyle(tone.color)
                    Text(item).font(.hmCaption).foregroundStyle(HM.Colors.textPrimary)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: HM.Radius.md).fill(tone.softColor))
        .accessibilityElement(children: .combine)
    }
}

/// Three pulsing dots while the assistant is working.
struct TypingIndicator: View {
    @State private var phase = 0.0

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            MascotView(size: 30, animated: false).accessibilityHidden(true)
            HStack(spacing: 5) {
                ForEach(0..<3, id: \.self) { i in
                    Circle()
                        .fill(HM.Colors.textMuted)
                        .frame(width: 7, height: 7)
                        .opacity(0.35 + 0.65 * max(0, sin(phase + Double(i) * 0.9)))
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 14)
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(HM.Colors.card).hmShadow())
            Spacer()
        }
        .onAppear { withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) { phase = .pi * 2 } }
        .accessibilityElement()
        .accessibilityLabel("HealthMate is thinking")
    }
}
