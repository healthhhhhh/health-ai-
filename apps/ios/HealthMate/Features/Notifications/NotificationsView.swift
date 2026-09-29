import HealthMateCore
import SwiftUI

/// Reminders, report updates and account alerts. Tapping one marks it read and opens what it's about.
struct NotificationsView: View {
    @State var model: NotificationsViewModel
    var onOpen: (AppRoute) -> Void

    var body: some View {
        List {
            if let state = model.state {
                StateView(state: state, title: state == .empty ? "No notifications yet" : nil, message: state == .empty ? "Reminders, report updates and account alerts will appear here." : nil) {
                    if state != .empty && state != .loading {
                        Button("Try again") { Task { await model.load() } }.buttonStyle(.hmSecondary)
                    }
                }
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
            } else {
                Section {
                    filters
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }
                if model.groups.isEmpty {
                    StateView(state: .success, title: "You're all caught up", message: model.filter == .unread ? "No unread notifications." : "Nothing in this category.")
                        .frame(maxWidth: .infinity)
                        .listRowBackground(Color.clear)
                }
                ForEach(model.groups) { group in
                    Section(group.title) {
                        ForEach(group.items) { notification in
                            row(notification)
                        }
                    }
                }
            }
        }
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Mark all as read") { Task { await model.markAllRead() } }
                    .disabled(model.unreadCount == 0)
            }
        }
        .refreshable { await model.load() }
        .task { await model.load() }
        .alert("Something went wrong", isPresented: Binding(get: { model.errorMessage != nil }, set: { if !$0 { model.errorMessage = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.errorMessage ?? "")
        }
    }

    private var filters: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip("All", .all)
                chip(model.unreadCount > 0 ? "Unread (\(model.unreadCount))" : "Unread", .unread)
                ForEach(model.categories, id: \.self) { category in
                    chip(category.label, .category(category))
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 4)
        }
    }

    private func chip(_ title: String, _ filter: NotificationsViewModel.Filter) -> some View {
        let selected = model.filter == filter
        return Button(title) { model.filter = filter }
            .font(.hmCaption.weight(.semibold))
            .padding(.horizontal, 14)
            .frame(height: 34)
            .foregroundStyle(selected ? HM.Colors.onPrimary : HM.Colors.textSecondary)
            .background(Capsule().fill(selected ? HM.Colors.primaryFill : HM.Colors.card))
            .overlay(Capsule().strokeBorder(selected ? Color.clear : HM.Colors.separator))
            .buttonStyle(.plain)
            .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func row(_ notification: NotificationRecord) -> some View {
        Button {
            Task {
                if let route = await model.open(notification) { onOpen(route) }
            }
        } label: {
            HStack(alignment: .top) {
                NotificationRow(category: notification.category, title: notification.title, message: notification.body, createdAt: notification.createdAt, read: notification.isRead, aiGenerated: notification.aiGenerated)
                if AppRoute(link: notification.link) != nil {
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(HM.Colors.textMuted).padding(.top, 4)
                }
            }
        }
        .buttonStyle(.plain)
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) { Task { await model.delete(notification) } } label: { Label("Delete", systemImage: "trash") }
        }
        .swipeActions(edge: .leading) {
            Button { Task { await model.setRead(notification, !notification.isRead) } } label: {
                Label(notification.isRead ? "Mark as unread" : "Mark as read", systemImage: notification.isRead ? "envelope.badge" : "envelope.open")
            }
            .tint(HM.Colors.primary)
        }
        .contextMenu {
            Button(notification.isRead ? "Mark as unread" : "Mark as read") { Task { await model.setRead(notification, !notification.isRead) } }
            Button("Delete", role: .destructive) { Task { await model.delete(notification) } }
        }
    }
}
