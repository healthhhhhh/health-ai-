import HealthMateCore
import SwiftUI

/// One view for every non-content state (loading, processing, empty, error,
/// offline, permission, success) so they look the same on every screen.
/// Mirrors the web `StateView`.
struct StateView<Action: View>: View {
    let state: ScreenState
    var title: String?
    var message: String?
    var systemImage: String?
    var compact = false
    @ViewBuilder var action: () -> Action

    var body: some View {
        VStack(spacing: compact ? 8 : 12) {
            if state == .loading || state == .processing {
                ProgressView()
                    .controlSize(.large)
                    .tint(HM.Colors.primary)
                    .frame(width: 54, height: 54)
                    .background(Circle().fill(HM.Colors.primarySoft))
            } else {
                IconBadge(systemName: systemImage ?? state.systemImage, tone: state.tone, size: compact ? .medium : .large)
            }
            Text(title ?? state.defaultTitle)
                .font(compact ? .hmCardTitle : .hmSectionHeading)
                .foregroundStyle(HM.Colors.textPrimary)
                .multilineTextAlignment(.center)
            Text(message ?? state.defaultMessage)
                .font(.hmBody)
                .foregroundStyle(HM.Colors.textSecondary)
                .multilineTextAlignment(.center)
            action().padding(.top, 4)
        }
        .padding(.vertical, compact ? 16 : 32)
        .padding(.horizontal, 20)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .onAppear {
            if state.isUrgent {
                UIAccessibility.post(notification: .announcement, argument: title ?? state.defaultTitle)
            }
        }
    }
}

extension StateView where Action == EmptyView {
    init(state: ScreenState, title: String? = nil, message: String? = nil, systemImage: String? = nil, compact: Bool = false) {
        self.init(state: state, title: title, message: message, systemImage: systemImage, compact: compact) { EmptyView() }
    }
}

/// Placeholder shapes while content loads; shimmers only when motion is allowed.
struct SkeletonModifier: ViewModifier {
    let active: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    func body(content: Content) -> some View {
        content
            .redacted(reason: active ? .placeholder : [])
            .opacity(active && pulse ? 0.55 : 1)
            .allowsHitTesting(!active)
            .accessibilityHidden(active)
            .onAppear {
                guard active, !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { pulse = true }
            }
    }
}

extension View {
    /// Shows the view as a skeleton while `active`.
    func hmSkeleton(_ active: Bool) -> some View { modifier(SkeletonModifier(active: active)) }
}

/// Ordered steps (e.g. upload → read → summarise) with the current one highlighted.
struct StepProgressView: View {
    struct Step: Identifiable {
        let label: String
        var detail: String?
        var id: String { label }
    }

    let steps: [Step]
    let current: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
                HStack(alignment: .top, spacing: 12) {
                    ZStack {
                        Circle()
                            .fill(index < current ? HM.Colors.successFill : index == current ? HM.Colors.primaryFill : HM.Colors.cardMuted)
                            .frame(width: 24, height: 24)
                        if index < current {
                            Image(systemName: "checkmark").font(.caption2.weight(.bold)).foregroundStyle(HM.Colors.onPrimary)
                        } else {
                            Text("\(index + 1)").font(.caption2.weight(.semibold)).foregroundStyle(index == current ? HM.Colors.onPrimary : HM.Colors.textMuted)
                        }
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(step.label)
                            .font(index > current ? .hmBody : .hmBodyEmphasis)
                            .foregroundStyle(index > current ? HM.Colors.textSecondary : HM.Colors.textPrimary)
                        if let detail = step.detail {
                            Text(detail).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                        }
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityValue(index < current ? "Done" : index == current ? "In progress" : "Not started")
            }
        }
    }
}

/// Single-choice filter pills (All · Reports · Photos).
struct FilterChips<Value: Hashable>: View {
    struct Option: Identifiable {
        let value: Value
        let label: String
        var count: Int?
        var id: String { label }
    }

    let options: [Option]
    @Binding var selection: Value

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(options) { option in
                    let selected = option.value == selection
                    Button {
                        selection = option.value
                    } label: {
                        HStack(spacing: 6) {
                            Text(option.label)
                            if let count = option.count {
                                Text("\(count)")
                                    .font(.hmMicro)
                                    .padding(.horizontal, 6)
                                    .background(Capsule().fill(selected ? HM.Colors.card : HM.Colors.cardMuted))
                                    .foregroundStyle(selected ? HM.Colors.primary : HM.Colors.textSecondary)
                            }
                        }
                        .font(.hmCaption.weight(.semibold))
                        .foregroundStyle(selected ? HM.Colors.onPrimary : HM.Colors.textSecondary)
                        .padding(.horizontal, 14)
                        .frame(minHeight: 36)
                        .background(Capsule().fill(selected ? HM.Colors.primaryFill : HM.Colors.card))
                        .overlay(Capsule().strokeBorder(selected ? Color.clear : HM.Colors.separator))
                    }
                    .buttonStyle(PressableButtonStyle())
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
            .padding(.vertical, 2)
        }
    }
}

// MARK: - Toasts

/// Brief confirmations ("Saved", "Copied"). Errors that need action belong inline.
@MainActor
@Observable
final class ToastCenter {
    struct Toast: Identifiable, Equatable {
        enum Tone { case success, info, error }
        let id = UUID()
        let title: String
        var message: String?
        var tone: Tone = .success
    }

    private(set) var current: Toast?

    func show(_ title: String, message: String? = nil, tone: Toast.Tone = .success) {
        let toast = Toast(title: title, message: message, tone: tone)
        current = toast
        UIAccessibility.post(notification: .announcement, argument: title)
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(3.5))
            if self?.current?.id == toast.id { self?.current = nil }
        }
    }

    func dismiss() { current = nil }
}

private struct ToastOverlay: ViewModifier {
    let center: ToastCenter
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content.overlay(alignment: .top) {
            if let toast = center.current {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: toast.tone == .error ? "exclamationmark.circle.fill" : toast.tone == .info ? "info.circle.fill" : "checkmark.circle.fill")
                        .foregroundStyle(toast.tone == .error ? HM.Colors.error : toast.tone == .info ? HM.Colors.primary : HM.Colors.success)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(toast.title).font(.hmBodyEmphasis).foregroundStyle(HM.Colors.textPrimary)
                        if let message = toast.message { Text(message).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary) }
                    }
                    Spacer(minLength: 0)
                }
                .padding(14)
                .background(RoundedRectangle(cornerRadius: HM.Radius.md, style: .continuous).fill(HM.Colors.card).hmShadow(HM.Shadow.raised))
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
                .onTapGesture { center.dismiss() }
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isButton)
                .accessibilityHint("Dismiss")
            }
        }
        .animation(reduceMotion ? nil : HMMotion.spring, value: center.current)
    }
}

extension View {
    /// Shows toasts from `center` at the top of this view.
    func hmToasts(_ center: ToastCenter) -> some View { modifier(ToastOverlay(center: center)) }
}
