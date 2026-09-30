import HealthMateCore
import SwiftUI

/// AI Health Assistant chat (reference: second iOS screen).
///
/// Gates, in order: an account (answers are generated on the HealthMate
/// server, never on-device with a bundled key) and explicit consent to AI
/// processing. The on-device safety check runs before any of that, so
/// emergency guidance appears even when signed out or offline.
struct ChatView: View {
    let session: SessionStore
    @Bindable var model: ChatViewModel
    @Binding var pendingQuestion: String?
    var onFindCare: () -> Void
    var onVoice: () -> Void

    @State private var showSignIn = false
    @State private var showHistory = false
    @State private var gateEscalation: Escalation?
    @State private var showReports = false
    /// "Check a photo": the flow is presented straight from Chat (not nested in another sheet), then its result.
    @State private var photoModel: DocumentsViewModel?
    @State private var showPhotoCheck = false
    @State private var photoResultID: String?
    @State private var showPhotoResult = false
    @FocusState private var composerFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var canChat: Bool { session.isSignedIn && session.hasConsent("ai_processing") }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        if session.isDemo {
                            Label(session.isPreview ? "Preview mode: answers are sample responses, not a real AI and not medical advice." : "Demo server: answers are scripted examples, not real AI.", systemImage: session.isPreview ? "flask" : "theatermasks")
                                .font(.hmCaption.weight(.medium))
                                .foregroundStyle(HM.Colors.textPrimary)
                                .padding(12)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(RoundedRectangle(cornerRadius: HM.Radius.md).fill(HM.Colors.warningSoft))
                                .accessibilityIdentifier("demoNotice")
                        }
                        if let gateEscalation {
                            EscalationCard(escalation: gateEscalation, onFindCare: onFindCare)
                                .transition(.move(edge: .top).combined(with: .opacity))
                        }
                        if !session.isSignedIn {
                            SignInGate(onSignIn: { showSignIn = true })
                        } else if !session.hasConsent("ai_processing") {
                            ConsentGate(busy: session.busy) {
                                Task { await session.setConsent("ai_processing", granted: true) }
                            }
                        } else {
                            if model.aiUnavailable {
                                AIUnavailableBanner()
                            }
                            if model.isEmpty {
                                ChatWelcome(onPick: { suggestion in Task { await model.send(suggestion) } })
                            }
                        }
                        ForEach(model.items) { item in
                            row(item)
                                .id(item.id)
                                .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                        }
                        if model.sending {
                            TypingIndicator().id("typing")
                        }
                        if let error = model.errorMessage {
                            ErrorRow(message: error, kind: model.errorKind, canRetry: model.failedText != nil) {
                                Task { await model.retry() }
                            }
                            .id("error")
                        }
                        Color.clear.frame(height: 1).id("bottom")
                    }
                    .padding(.horizontal, HM.Spacing.lg)
                    .padding(.vertical, HM.Spacing.md)
                    .animation(reduceMotion ? nil : HMMotion.spring, value: model.items)
                    .animation(reduceMotion ? nil : HMMotion.spring, value: model.sending)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: model.items.count) { _, _ in scrollToBottom(proxy) }
                .onChange(of: model.sending) { _, _ in scrollToBottom(proxy) }
            }
            .background(HM.Colors.background.ignoresSafeArea())
            .safeAreaInset(edge: .bottom) { composer }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) { header }
                ToolbarItem(placement: .topBarLeading) {
                    if session.isSignedIn {
                        Button { showHistory = true } label: { Image(systemName: "clock.arrow.circlepath") }
                            .accessibilityLabel("Past conversations")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if !model.isEmpty {
                        Button { model.startNew() } label: { Image(systemName: "square.and.pencil") }
                            .accessibilityLabel("New conversation")
                    }
                }
            }
            .sheet(isPresented: $showSignIn) {
                SignInView(session: session, onSignedIn: {})
            }
            .sheet(isPresented: $showHistory) {
                ConversationHistoryView(model: model)
                    .presentationDetents([.medium, .large])
            }
            .sheet(isPresented: $showReports) {
                NavigationStack {
                    DocumentsView(session: session)
                        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { showReports = false } } }
                }
            }
            .sheet(isPresented: $showPhotoCheck, onDismiss: { if photoResultID != nil { showPhotoResult = true } }) {
                if let photoModel {
                    PhotoCheckView(model: photoModel) { record in photoResultID = record.id }
                }
            }
            .sheet(isPresented: $showPhotoResult, onDismiss: { photoResultID = nil }) {
                if let photoModel, let photoResultID {
                    NavigationStack {
                        DocumentDetailView(model: photoModel, documentID: photoResultID)
                            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { showPhotoResult = false } } }
                    }
                }
            }
        }
        .onAppear { model.aiUnavailable = session.aiAvailable == false }
        .onChange(of: session.aiAvailable) { _, available in model.aiUnavailable = available == false }
        .task(id: session.state) {
            consumePendingQuestion()
            #if DEBUG
            // Screenshots: `-hmOpenLatestConversation YES` opens the most recent chat.
            if session.isSignedIn, model.isEmpty, UserDefaults.standard.bool(forKey: "hmOpenLatestConversation") {
                await model.loadHistory()
                if let latest = model.conversations.first { await model.open(latest) }
            }
            #endif
        }
        .onChange(of: pendingQuestion) { _, _ in consumePendingQuestion() }
        .onChange(of: session.consents) { _, _ in consumePendingQuestion() }
    }

    // MARK: Rows

    @ViewBuilder
    private func row(_ item: ChatItem) -> some View {
        switch item {
        case .user(_, let text):
            ChatBubble(author: .user, text: text)
        case .localEscalation(_, let escalation):
            EscalationCard(escalation: escalation, onFindCare: onFindCare)
        case .assistant(let message):
            AssistantTurnView(
                message: message,
                isLatest: item.id == model.items.last?.id && !model.sending,
                savedSuggestions: model.savedSuggestions,
                onAnswer: { answer in Task { await model.send(answer) } },
                onSaveSuggestion: { fact in Task { await model.saveSuggestion(fact) } },
                onFindCare: onFindCare,
                isSample: session.isPreview
            )
        }
    }

    // MARK: Header & composer

    private var header: some View {
        VStack(spacing: 1) {
            Text("AI Health Assistant").font(.hmCardTitle).foregroundStyle(HM.Colors.textPrimary)
            HStack(spacing: 5) {
                Circle().fill(statusColor).frame(width: 7, height: 7)
                Text(statusText).font(.hmMicro).foregroundStyle(HM.Colors.textSecondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    private var statusText: String {
        switch session.aiAvailable {
        case .some(true): return session.isPreview ? "Sample answers" : session.isDemo ? "Demo answers" : "Online"
        case .some(false): return "AI answers unavailable"
        case .none: return session.isSignedIn ? "Connecting…" : "Sign in to chat"
        }
    }

    private var statusColor: Color {
        switch session.aiAvailable {
        case .some(true): return HM.Colors.success
        case .some(false): return HM.Colors.warning
        case .none: return HM.Colors.textMuted
        }
    }

    private var composer: some View {
        VStack(spacing: 6) {
            HStack(alignment: .bottom, spacing: 8) {
                Menu {
                    Button { showReports = true } label: { Label("Upload a report", systemImage: "doc.text") }
                    Button { checkPhoto() } label: { Label("Check a photo", systemImage: "camera") }
                } label: {
                    Image(systemName: "paperclip")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(HM.Colors.textSecondary)
                        .frame(width: 46, height: 46)
                        .background(Circle().strokeBorder(HM.Colors.separator))
                }
                .accessibilityLabel("Add a report or photo")
                TextField("Type your message…", text: $model.draft, axis: .vertical)
                    .font(.hmBody)
                    .lineLimit(1...5)
                    .focused($composerFocused)
                    .submitLabel(.send)
                    .onSubmit(submit)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(HM.Colors.card))
                    .overlay(
                        RoundedRectangle(cornerRadius: 22, style: .continuous)
                            .strokeBorder(composerFocused ? HM.Colors.primary : HM.Colors.separator, lineWidth: composerFocused ? 2 : 1)
                    )
                    .accessibilityLabel("Message")
                if model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    CircleIconButton(systemName: "mic.fill", label: "Speak your message", filled: false, action: onVoice)
                } else {
                    CircleIconButton(systemName: "arrow.up", label: "Send", filled: true, action: submit)
                        .disabled(model.sending)
                        .accessibilityIdentifier("sendMessage")
                }
            }
            Text(session.isPreview ? "Sample responses in Preview mode, not a diagnosis." : "AI-generated information, not a diagnosis.")
                .font(.hmMicro)
                .foregroundStyle(HM.Colors.textMuted)
        }
        .padding(.horizontal, HM.Spacing.lg)
        .padding(.top, 8)
        .padding(.bottom, 8)
        .background(.bar)
        .animation(reduceMotion ? nil : HMMotion.bouncy, value: model.draft.isEmpty)
    }

    // MARK: Actions

    private func submit() {
        let text = model.draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        guard canChat else {
            // Safety still runs locally for people who aren't signed in yet.
            showGateEscalation(for: text)
            if !session.isSignedIn { showSignIn = true }
            return
        }
        Task { await model.send() }
    }

    /// Opens the photo check, or Reports & photos first when sign-in or consent is still needed.
    private func checkPhoto() {
        guard session.isSignedIn, session.hasConsent("document_processing") else {
            showReports = true
            return
        }
        photoModel = DocumentsViewModel(api: session.api, isPreview: session.isPreview, onSessionEnded: { [session] in session.handle($0) })
        photoResultID = nil
        showPhotoCheck = true
    }

    private func consumePendingQuestion() {
        guard let question = pendingQuestion else { return }
        // "Ask the AI Health Assistant" from a report or photo result brings the question back here.
        showReports = false
        showPhotoResult = false
        if canChat {
            pendingQuestion = nil
            Task { await model.send(question) }
        } else if session.state != .unknown {
            pendingQuestion = nil
            model.draft = question
            showGateEscalation(for: question)
        }
    }

    private func showGateEscalation(for text: String) {
        let triage = SafetyEngine.triage(text)
        if triage.level >= .urgent { gateEscalation = SafetyEngine.escalation(for: triage) }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        if reduceMotion {
            proxy.scrollTo("bottom", anchor: .bottom)
        } else {
            withAnimation(HMMotion.respecting(HMMotion.spring)) { proxy.scrollTo("bottom", anchor: .bottom) }
        }
    }
}

// MARK: - Pieces

private struct CircleIconButton: View {
    let systemName: String
    let label: String
    let filled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(filled ? HM.Colors.onPrimary : HM.Colors.primary)
                .frame(width: 46, height: 46)
                .background(Circle().fill(filled ? HM.Colors.primaryFill : HM.Colors.primarySoft))
        }
        .buttonStyle(PressableButtonStyle(scale: 0.9))
        .accessibilityLabel(label)
        .transition(.scale.combined(with: .opacity))
    }
}

private struct ChatWelcome: View {
    let onPick: (String) -> Void

    private let suggestions = [
        "I've had a headache since this morning",
        "Help me understand my blood test",
        "Tips for sleeping better",
        "What should I ask my doctor?",
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ChatBubble(author: .assistant, text: "Hi! I'm your AI Health Assistant. Tell me what's going on and I'll ask a few questions, explain things in plain language and let you know when to see a professional.")
                .appearAnimation()
            Text("Try asking")
                .font(.hmCaption.weight(.semibold))
                .foregroundStyle(HM.Colors.textSecondary)
                .padding(.leading, 38)
                .appearAnimation(delay: 0.1)
            FlowLayout(spacing: 8) {
                ForEach(suggestions, id: \.self) { suggestion in
                    Button(suggestion) { onPick(suggestion) }
                        .font(.hmCaption.weight(.medium))
                        .foregroundStyle(HM.Colors.primary)
                        .padding(.horizontal, 14)
                        .frame(minHeight: 36)
                        .background(Capsule().fill(HM.Colors.primarySoft))
                        .buttonStyle(PressableButtonStyle(scale: 0.95))
                }
            }
            .padding(.leading, 38)
            .appearAnimation(delay: 0.15)
        }
    }
}

private struct SignInGate: View {
    let onSignIn: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            MascotView(size: 110, withBackdrop: true)
            Text("Sign in to talk with your AI Health Assistant")
                .font(.hmSectionHeading)
                .multilineTextAlignment(.center)
                .foregroundStyle(HM.Colors.textPrimary)
            Text("Answers are generated securely on the HealthMate server so your conversations stay private to your account. Your plan and reminders keep working without an account.")
                .font(.hmBody)
                .multilineTextAlignment(.center)
                .foregroundStyle(HM.Colors.textSecondary)
            Button("Sign in or create account", action: onSignIn)
                .buttonStyle(.hmPrimary(fullWidth: true))
            DisclaimerView()
        }
        .padding(HM.Spacing.lg)
        .hmCard()
        .appearAnimation()
    }
}

private struct ConsentGate: View {
    let busy: Bool
    let onAllow: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            IconBadge(systemName: "lock.shield", tone: .blue, size: .large, filled: true)
            Text("Before we start")
                .font(.hmSectionHeading)
                .foregroundStyle(HM.Colors.textPrimary)
            VStack(alignment: .leading, spacing: 8) {
                bullet("Your messages, plus the profile details and memories you've saved, are sent to our AI provider to write each answer.")
                bullet("They aren't used to train AI models, and you can delete conversations or your whole account at any time.")
                bullet("Answers are general information, not a diagnosis. For emergencies, always call your local emergency number.")
            }
            Button(action: onAllow) {
                if busy { ProgressView().tint(HM.Colors.onPrimary) } else { Text("Allow and continue") }
            }
            .buttonStyle(.hmPrimary(fullWidth: true))
            .disabled(busy)
            Text("You can turn this off in Profile → Privacy.")
                .font(.hmMicro)
                .foregroundStyle(HM.Colors.textMuted)
        }
        .padding(HM.Spacing.lg)
        .hmCard()
        .appearAnimation()
    }

    private func bullet(_ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "checkmark.circle.fill").font(.caption).foregroundStyle(HM.Colors.primary)
            Text(text).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary).fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct ErrorRow: View {
    let message: String
    let kind: ChatViewModel.ErrorKind
    let canRetry: Bool
    let onRetry: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: kind == .offline ? "wifi.slash" : kind == .unavailable ? "cloud.slash" : "exclamationmark.circle.fill").foregroundStyle(HM.Colors.error)
            Text(message).font(.hmCaption).foregroundStyle(HM.Colors.textPrimary)
            Spacer(minLength: 6)
            if canRetry {
                Button(kind == .unavailable ? "Try again" : "Retry", action: onRetry)
                    .font(.hmCaption.weight(.semibold))
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: HM.Radius.md).fill(HM.Colors.errorSoft))
        .accessibilityElement(children: .combine)
    }
}

/// The server has no AI available right now; history and on-device emergency guidance still work.
private struct AIUnavailableBanner: View {
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "cloud.slash").foregroundStyle(HM.Colors.warning)
            VStack(alignment: .leading, spacing: 2) {
                Text("AI answers are unavailable right now").font(.hmBodyEmphasis).foregroundStyle(HM.Colors.textPrimary)
                Text("You can still read past conversations, and emergency guidance still appears instantly. Please try again later.")
                    .font(.hmCaption)
                    .foregroundStyle(HM.Colors.textSecondary)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: HM.Radius.md).fill(HM.Colors.warningSoft))
        .accessibilityElement(children: .combine)
    }
}

/// Past conversations: open, rename or delete (with confirmation).
struct ConversationHistoryView: View {
    @Bindable var model: ChatViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var loaded = false
    @State private var renaming: ConversationRecord?
    @State private var newTitle = ""
    @State private var deleting: ConversationRecord?

    var body: some View {
        NavigationStack {
            Group {
                if !loaded {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if model.historyFailed && model.conversations.isEmpty {
                    StateView(state: .error, title: "Couldn't load your conversations", message: "Please try again in a moment.") {
                        Button("Try again") { Task { await model.loadHistory() } }.buttonStyle(.hmSecondary)
                    }
                    .padding(HM.Spacing.lg)
                } else if model.conversations.isEmpty {
                    EmptyStateView(systemImage: "bubble.left.and.bubble.right", title: "No conversations yet", message: "Your chats with the AI Health Assistant will appear here.")
                        .padding(HM.Spacing.lg)
                } else {
                    List {
                        ForEach(model.conversations) { conversation in
                            Button {
                                Task {
                                    await model.open(conversation)
                                    dismiss()
                                }
                            } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(conversation.title).font(.hmBodyEmphasis).foregroundStyle(HM.Colors.textPrimary).lineLimit(1)
                                    Text(conversation.updatedAt, format: .relative(presentation: .named))
                                        .font(.hmCaption)
                                        .foregroundStyle(HM.Colors.textSecondary)
                                }
                            }
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) { deleting = conversation } label: { Label("Delete", systemImage: "trash") }
                                Button { startRename(conversation) } label: { Label("Rename", systemImage: "pencil") }
                                    .tint(HM.Colors.primary)
                            }
                            .contextMenu {
                                Button { startRename(conversation) } label: { Label("Rename", systemImage: "pencil") }
                                Button(role: .destructive) { deleting = conversation } label: { Label("Delete", systemImage: "trash") }
                            }
                        }
                    }
                    .refreshable { await model.loadHistory() }
                }
            }
            .navigationTitle("Conversations")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .alert("Rename conversation", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
                TextField("Name", text: $newTitle)
                Button("Save") {
                    if let target = renaming { Task { await model.rename(target, to: newTitle) } }
                    renaming = nil
                }
                Button("Cancel", role: .cancel) { renaming = nil }
            }
            .confirmationDialog("Delete this conversation?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    if let target = deleting { Task { await model.delete(target) } }
                    deleting = nil
                }
            } message: {
                Text("“\(deleting?.title ?? "")” and its messages will be deleted. Facts you chose to remember stay in your profile.")
            }
        }
        .task {
            await model.loadHistory()
            loaded = true
        }
    }

    private func startRename(_ conversation: ConversationRecord) {
        newTitle = conversation.title
        renaming = conversation
    }
}
