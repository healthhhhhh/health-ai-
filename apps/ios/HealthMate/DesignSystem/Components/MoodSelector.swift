import HealthMateCore
import SwiftUI

extension Mood {
    var systemImage: String {
        switch self {
        case .great: return "sun.max"
        case .good: return "cloud.sun"
        case .okay: return "cloud"
        case .low: return "cloud.drizzle"
        case .unwell: return "thermometer.medium"
        }
    }

    var tone: Tone {
        switch self {
        case .great: return .green
        case .good: return .teal
        case .okay: return .blue
        case .low: return .orange
        case .unwell: return .red
        }
    }
}

/// "How are you feeling today?" — five choices that bounce when picked.
struct MoodSelector: View {
    let selection: Mood?
    let onSelect: (Mood) -> Void

    var body: some View {
        HStack(spacing: 6) {
            ForEach(Mood.allCases) { mood in
                let selected = mood == selection
                Button {
                    onSelect(mood)
                } label: {
                    VStack(spacing: 6) {
                        Image(systemName: mood.systemImage)
                            .symbolVariant(selected ? .fill : .none)
                            .font(.system(size: 22, weight: .regular))
                            .symbolEffect(.bounce, value: selected)
                        Text(MoodPresenter.label(mood)).font(.hmMicro)
                    }
                    .foregroundStyle(selected ? mood.tone.color : HM.Colors.textSecondary)
                    .frame(maxWidth: .infinity, minHeight: 64)
                    .background(
                        RoundedRectangle(cornerRadius: HM.Radius.md, style: .continuous)
                            .fill(selected ? mood.tone.softColor : Color.clear)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: HM.Radius.md, style: .continuous)
                            .strokeBorder(selected ? mood.tone.color.opacity(0.6) : Color.clear, lineWidth: 1.5)
                    )
                    .scaleEffect(selected ? 1.04 : 1)
                }
                .buttonStyle(PressableButtonStyle(scale: 0.92))
                .accessibilityLabel(MoodPresenter.label(mood))
                .accessibilityAddTraits(selected ? AccessibilityTraits.isSelected : AccessibilityTraits())
            }
        }
        .hmAnimation(HMMotion.bouncy, value: selection)
        .sensoryFeedback(.selection, trigger: selection)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("How are you feeling today?")
    }
}

struct SegmentItem<Value: Hashable>: Identifiable {
    let value: Value
    let title: String
    var id: Value { value }
}

/// Segmented pill tabs with a sliding indicator (reference: Upload / Analysis / History).
struct SegmentedTabs<Value: Hashable>: View {
    let items: [SegmentItem<Value>]
    @Binding var selection: Value
    @Namespace private var indicator

    var body: some View {
        HStack(spacing: 4) {
            ForEach(items) { item in
                let selected = item.value == selection
                Button {
                    withAnimation(HMMotion.respecting(HMMotion.spring)) { selection = item.value }
                } label: {
                    Text(item.title)
                        .font(.hmBodyEmphasis)
                        .foregroundStyle(selected ? HM.Colors.primary : HM.Colors.textSecondary)
                        .frame(maxWidth: .infinity, minHeight: 36)
                        .background {
                            if selected {
                                Capsule().fill(HM.Colors.card).hmShadow()
                                    .matchedGeometryEffect(id: "indicator", in: indicator)
                            }
                        }
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? AccessibilityTraits([.isSelected, .isButton]) : AccessibilityTraits.isButton)
            }
        }
        .padding(4)
        .background(Capsule().fill(HM.Colors.cardMuted))
        .overlay(Capsule().strokeBorder(HM.Colors.separator))
    }
}
