import HealthMateCore
import SwiftUI

/// Horizontal week selector (reference: "Mon 10 · Tue 11 · …").
struct WeekStrip: View {
    let days: [DayKey]
    @Binding var selection: DayKey
    let today: DayKey
    let calendar: Calendar

    @Namespace private var indicator

    var body: some View {
        HStack(spacing: 6) {
            ForEach(days, id: \.self) { day in
                let selected = day == selection
                let date = day.date(in: calendar) ?? Date()
                Button {
                    withAnimation(HMMotion.spring) { selection = day }
                } label: {
                    VStack(spacing: 4) {
                        Text(date, format: .dateTime.weekday(.abbreviated))
                            .font(.caption2.weight(.medium))
                        Text(date, format: .dateTime.day())
                            .font(.system(.subheadline, design: .rounded, weight: .semibold))
                        Circle()
                            .fill(day == today && !selected ? HM.Colors.primary : Color.clear)
                            .frame(width: 4, height: 4)
                    }
                    .foregroundStyle(selected ? HM.Colors.onPrimary : HM.Colors.textSecondary)
                    .frame(maxWidth: .infinity, minHeight: 62)
                    .background {
                        if selected {
                            RoundedRectangle(cornerRadius: HM.Radius.md, style: .continuous)
                                .fill(HM.Colors.primaryFill)
                                .hmShadow(HM.Shadow.raised)
                                .matchedGeometryEffect(id: "selectedDay", in: indicator)
                        } else {
                            RoundedRectangle(cornerRadius: HM.Radius.md, style: .continuous)
                                .fill(HM.Colors.card)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressableButtonStyle(scale: 0.94))
                .accessibilityLabel(Text(date, format: .dateTime.weekday(.wide).month(.wide).day()))
                .accessibilityAddTraits(selected ? AccessibilityTraits([.isButton, .isSelected]) : AccessibilityTraits.isButton)
                .accessibilityHint(day == today ? "Today" : "")
            }
        }
        .sensoryFeedback(.selection, trigger: selection)
    }
}
