import SwiftUI

/// A plan task with a large, springy completion checkbox.
struct TaskRow: View {
    let title: String
    var detail: String?
    var sourceLabel: String?
    let time: String
    let completed: Bool
    let onToggle: () -> Void

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: 12) {
                CheckBox(checked: completed)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.hmBodyEmphasis)
                        .foregroundStyle(completed ? HM.Colors.textSecondary : HM.Colors.textPrimary)
                        .strikethrough(completed, color: HM.Colors.textMuted)
                    if let subtitle {
                        Text(subtitle).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary).lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                Text(time)
                    .font(.hmCaption)
                    .monospacedDigit()
                    .foregroundStyle(HM.Colors.textSecondary)
            }
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.success, trigger: completed) { _, new in new }
        .sensoryFeedback(.selection, trigger: completed) { _, new in !new }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([title, subtitle, time].compactMap { $0 }.joined(separator: ", "))
        .accessibilityValue(completed ? "Completed" : "Not completed")
        .accessibilityAddTraits(completed ? AccessibilityTraits([.isButton, .isSelected]) : AccessibilityTraits.isButton)
        .accessibilityHint("Double-tap to mark as \(completed ? "not done" : "done")")
    }

    private var subtitle: String? {
        let parts = [detail, sourceLabel].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

struct CheckBox: View {
    let checked: Bool

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .strokeBorder(checked ? HM.Colors.primaryFill : HM.Colors.separator, lineWidth: 2)
                .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(checked ? HM.Colors.primaryFill : HM.Colors.card))
            Image(systemName: "checkmark")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(HM.Colors.onPrimary)
                .scaleEffect(checked ? 1 : 0.2)
                .opacity(checked ? 1 : 0)
        }
        .frame(width: 26, height: 26)
        .scaleEffect(checked ? 1 : 0.94)
        .animation(HMMotion.bouncy, value: checked)
    }
}

/// A medication shown exactly as recorded. Never suggests dose changes.
struct MedicationRow: View {
    let name: String
    let instruction: String
    let sourceLabel: String
    var nextDose: String?
    var taken = false

    var body: some View {
        HStack(spacing: 12) {
            IconBadge(systemName: "pills", tone: .blue, size: .small)
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(.hmBodyEmphasis).foregroundStyle(HM.Colors.textPrimary)
                Text("\(instruction) · \(sourceLabel)").font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
            }
            Spacer()
            if taken {
                StatusBadge(status: .success, text: "Taken")
            } else if let nextDose {
                Text(nextDose).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
            }
        }
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
    }
}
