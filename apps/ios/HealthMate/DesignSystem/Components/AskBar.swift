import SwiftUI

/// "Ask your AI health assistant anything…" field with a voice button.
struct AskBar: View {
    @Binding var text: String
    var onSubmit: (String) -> Void
    var onVoice: () -> Void

    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(HM.Colors.textMuted)
                .accessibilityHidden(true)
            TextField("Ask your AI health assistant anything…", text: $text)
                .font(.hmBody)
                .foregroundStyle(HM.Colors.textPrimary)
                .submitLabel(.send)
                .focused($focused)
                .onSubmit {
                    let query = text.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !query.isEmpty else { return }
                    onSubmit(query)
                    text = ""
                }
                .accessibilityLabel("Ask your AI health assistant")
            Button(action: onVoice) {
                Image(systemName: "mic.fill")
                    .foregroundStyle(HM.Colors.textSecondary)
                    .frame(width: 36, height: 36)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("Ask by voice")
        }
        .padding(.leading, 14)
        .padding(.trailing, 6)
        .frame(minHeight: 50)
        .background(RoundedRectangle(cornerRadius: HM.Radius.md, style: .continuous).fill(HM.Colors.card).hmShadow())
        .overlay(
            RoundedRectangle(cornerRadius: HM.Radius.md, style: .continuous)
                .strokeBorder(focused ? HM.Colors.primary : HM.Colors.separator.opacity(0.6), lineWidth: focused ? 2 : 1)
        )
        .animation(HMMotion.spring, value: focused)
    }
}
