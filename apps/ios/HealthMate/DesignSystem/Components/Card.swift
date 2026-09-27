import SwiftUI

/// The standard white, rounded, softly shadowed card.
struct HMCardModifier: ViewModifier {
    var padding: CGFloat = HM.Spacing.md
    var radius: CGFloat = HM.Radius.lg

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(HM.Colors.card))
            .hmShadow()
    }
}

extension View {
    func hmCard(padding: CGFloat = HM.Spacing.md, radius: CGFloat = HM.Radius.lg) -> some View {
        modifier(HMCardModifier(padding: padding, radius: radius))
    }
}

/// Section title with an optional trailing action ("See All").
struct SectionHeader: View {
    let title: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(.hmSectionHeading)
                .foregroundStyle(HM.Colors.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .font(.hmBodyEmphasis)
                    .foregroundStyle(HM.Colors.primary)
            }
        }
    }
}
