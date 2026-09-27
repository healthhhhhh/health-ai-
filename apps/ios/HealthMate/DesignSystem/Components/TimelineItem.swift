import HealthMateCore
import SwiftUI

/// One entry in a vertical timeline, with a connector line to the next entry.
struct TimelineItem: View {
    let systemImage: String
    let tone: Tone
    let title: String
    var meta: String?
    let time: String
    var isLast = false
    var showsConnector = true

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            IconBadge(systemName: systemImage, tone: tone, size: .small)
                .background(alignment: .top) {
                    if showsConnector && !isLast {
                        Rectangle()
                            .fill(HM.Colors.separator)
                            .frame(width: 1.5)
                            .frame(maxHeight: .infinity)
                            .offset(y: 32)
                    }
                }
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.hmBody).foregroundStyle(HM.Colors.textPrimary).lineLimit(2)
                if let meta { Text(meta).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary) }
            }
            .padding(.top, 6)
            Spacer(minLength: 8)
            Text(time).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary).padding(.top, 7)
        }
        .padding(.bottom, showsConnector && !isLast ? 14 : 6)
        .accessibilityElement(children: .combine)
    }
}

/// Chat bubble — AI on white cards, user on the primary fill.
struct ChatBubble<Footer: View>: View {
    enum Author { case user, assistant }

    let author: Author
    let text: String
    @ViewBuilder var footer: () -> Footer

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if author == .user { Spacer(minLength: 40) }
            if author == .assistant {
                MascotView(size: 30, animated: false).accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 10) {
                Text(text).font(.hmBody)
                footer()
            }
            .foregroundStyle(author == .user ? HM.Colors.onPrimary : HM.Colors.textPrimary)
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background(
                UnevenRoundedRectangle(
                    topLeadingRadius: 18,
                    bottomLeadingRadius: author == .assistant ? 4 : 18,
                    bottomTrailingRadius: author == .user ? 4 : 18,
                    topTrailingRadius: 18,
                    style: .continuous
                )
                .fill(author == .user ? HM.Colors.primaryFill : HM.Colors.card)
            )
            .hmShadow()
            if author == .assistant { Spacer(minLength: 40) }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(author == .user ? "You" : "HealthMate AI"): \(text)")
    }
}

extension ChatBubble where Footer == EmptyView {
    init(author: Author, text: String) {
        self.init(author: author, text: text) { EmptyView() }
    }
}
