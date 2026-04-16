// =============================================================================
// FOUNDRY iOS — Ask Foundry (Conversational AI)
// Multi-turn threads with intent routing, action confirmations.
// =============================================================================

import SwiftUI

struct AskFoundryView: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var api: FoundryAPI

    @State private var threads: [ConversationThread] = []
    @State private var activeThread: ConversationThread?
    @State private var showNewThread = false
    @State private var isLoading = false

    var body: some View {
        NavigationStack {
            Group {
                if isLoading && threads.isEmpty {
                    ProgressView("Loading conversations...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if threads.isEmpty {
                    EmptyConversationView {
                        showNewThread = true
                    }
                } else {
                    threadList
                }
            }
            .navigationTitle("Ask Foundry")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        showNewThread = true
                    } label: {
                        Image(systemName: "square.and.pencil")
                    }
                }
            }
            .sheet(isPresented: $showNewThread) {
                ConversationView(thread: nil, productId: appState.selectedProductId ?? "") { newThread in
                    threads.insert(newThread, at: 0)
                    activeThread = newThread
                    showNewThread = false
                }
                .environmentObject(api)
            }
            .navigationDestination(item: $activeThread) { thread in
                ConversationView(thread: thread, productId: appState.selectedProductId ?? "") { updated in
                    if let idx = threads.firstIndex(where: { $0.id == updated.id }) {
                        threads[idx] = updated
                    }
                }
                .environmentObject(api)
            }
        }
        .task {
            await loadThreads()
        }
        .onChange(of: appState.selectedProductId) { _, _ in
            Task { await loadThreads() }
        }
    }

    private var threadList: some View {
        List {
            ForEach(threads) { thread in
                ThreadRow(thread: thread)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        activeThread = thread
                    }
            }
            .onDelete { indexSet in
                Task {
                    for idx in indexSet {
                        let thread = threads[idx]
                        try? await api.archiveThread(threadId: thread.id)
                    }
                    threads.remove(atOffsets: indexSet)
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable {
            await loadThreads()
        }
    }

    private func loadThreads() async {
        guard let productId = appState.selectedProductId else { return }
        isLoading = true
        threads = (try? await api.getThreads(productId: productId)) ?? []
        isLoading = false
    }
}

// ─── Thread Row ───────────────────────────────────────────────────────────────

struct ThreadRow: View {
    let thread: ConversationThread

    var intentColor: Color {
        switch thread.intent {
        case "scenario": return .purple
        case "action": return .blue
        case "search": return .orange
        case "explain": return Color(hex: "#30D158")
        default: return .secondary
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(thread.title)
                    .font(.callout.bold())
                    .lineLimit(1)
                Spacer()
                if let intent = thread.intent {
                    Text(intent.uppercased())
                        .font(.caption2.bold())
                        .foregroundColor(intentColor)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(intentColor.opacity(0.1))
                        .cornerRadius(4)
                }
            }

            HStack {
                Text("\(thread.messageCount) messages")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Spacer()
                if let lastMessage = thread.lastMessageAt {
                    Text(lastMessage, style: .relative)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

// ─── Conversation View ────────────────────────────────────────────────────────

struct ConversationView: View {
    let thread: ConversationThread?
    let productId: String
    let onUpdate: (ConversationThread) -> Void

    @EnvironmentObject var api: FoundryAPI
    @Environment(\.dismiss) var dismiss

    @State private var messages: [ConversationMessage] = []
    @State private var inputText = ""
    @State private var isSending = false
    @State private var currentThread: ConversationThread?
    @State private var scrollProxy: ScrollViewProxy?

    var body: some View {
        VStack(spacing: 0) {
            // Messages
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 12) {
                        if messages.isEmpty && !isSending {
                            ConversationStarterView { starter in
                                inputText = starter
                                Task { await sendMessage() }
                            }
                        }

                        ForEach(messages) { message in
                            MessageBubble(message: message)
                                .id(message.id)
                        }

                        if isSending {
                            TypingIndicator()
                                .id("typing")
                        }
                    }
                    .padding(16)
                }
                .onAppear { scrollProxy = proxy }
                .onChange(of: messages.count) { _, _ in
                    withAnimation {
                        proxy.scrollTo(messages.last?.id ?? "typing", anchor: .bottom)
                    }
                }
                .onChange(of: isSending) { _, sending in
                    if sending {
                        withAnimation { proxy.scrollTo("typing", anchor: .bottom) }
                    }
                }
            }

            Divider()

            // Input bar
            HStack(spacing: 12) {
                TextField("Ask about your business...", text: $inputText, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...4)
                    .disabled(isSending)

                Button {
                    Task { await sendMessage() }
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 28))
                        .foregroundColor(inputText.trimmingCharacters(in: .whitespaces).isEmpty ? .secondary : .blue)
                }
                .disabled(inputText.trimmingCharacters(in: .whitespaces).isEmpty || isSending)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(Color(.systemBackground))
        }
        .navigationTitle(currentThread?.title ?? "New Conversation")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if let thread {
                currentThread = thread
                messages = (try? await api.getThread(threadId: thread.id))?.messages ?? []
            }
        }
    }

    private func sendMessage() async {
        let text = inputText.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        inputText = ""
        isSending = true

        // Optimistic user message
        let userMsg = ConversationMessage(
            id: UUID().uuidString,
            role: "user",
            content: text,
            intent: nil,
            createdAt: Date()
        )
        messages.append(userMsg)

        do {
            if let existing = currentThread {
                // Send to existing thread
                let reply = try await api.sendMessage(threadId: existing.id, message: text)
                let assistantMsg = ConversationMessage(
                    id: UUID().uuidString,
                    role: "assistant",
                    content: reply.content,
                    intent: reply.intent,
                    createdAt: Date()
                )
                messages.append(assistantMsg)
            } else {
                // Create new thread
                let (newThread, reply) = try await api.createThread(productId: productId, message: text)
                currentThread = newThread
                let assistantMsg = ConversationMessage(
                    id: UUID().uuidString,
                    role: "assistant",
                    content: reply.content,
                    intent: reply.intent,
                    createdAt: Date()
                )
                messages.append(assistantMsg)
                onUpdate(newThread)
            }
        } catch {
            // Remove optimistic message on failure
            messages.removeLast()
            inputText = text
        }

        isSending = false
    }
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

struct MessageBubble: View {
    let message: ConversationMessage

    var isUser: Bool { message.role == "user" }

    var intentLabel: String? {
        guard !isUser, let intent = message.intent else { return nil }
        return intent
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if isUser { Spacer(minLength: 60) }

            VStack(alignment: isUser ? .trailing : .leading, spacing: 4) {
                if let label = intentLabel {
                    Text(label.uppercased())
                        .font(.caption2.bold())
                        .foregroundColor(.secondary)
                        .padding(.horizontal, 4)
                }

                Text(message.content)
                    .font(.callout)
                    .foregroundColor(isUser ? .white : .primary)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(isUser ? Color.blue : Color(.secondarySystemGroupedBackground))
                    .cornerRadius(18)
                    .cornerRadius(isUser ? 4 : 18, corners: isUser ? .bottomRight : .bottomLeft)
            }

            if !isUser { Spacer(minLength: 60) }
        }
    }
}

// ─── Typing Indicator ─────────────────────────────────────────────────────────

struct TypingIndicator: View {
    @State private var phase = 0

    let timer = Timer.publish(every: 0.4, on: .main, in: .common).autoconnect()

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            HStack(spacing: 4) {
                ForEach(0..<3) { i in
                    Circle()
                        .fill(Color.secondary)
                        .frame(width: 8, height: 8)
                        .scaleEffect(phase == i ? 1.3 : 0.8)
                        .animation(.easeInOut(duration: 0.3), value: phase)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(Color(.secondarySystemGroupedBackground))
            .cornerRadius(18)
            .cornerRadius(4, corners: .bottomLeft)

            Spacer(minLength: 60)
        }
        .onReceive(timer) { _ in
            phase = (phase + 1) % 3
        }
    }
}

// ─── Conversation Starters ────────────────────────────────────────────────────

struct ConversationStarterView: View {
    let onSelect: (String) -> Void

    let starters = [
        "What should I focus on today?",
        "Why did my signal score change?",
        "What if I raise prices 20%?",
        "Show me my decision history",
    ]

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "brain.head.profile")
                .font(.system(size: 48))
                .foregroundColor(.secondary.opacity(0.5))

            Text("Ask anything about your business")
                .font(.headline)
                .foregroundColor(.secondary)

            VStack(spacing: 8) {
                ForEach(starters, id: \.self) { starter in
                    Button {
                        onSelect(starter)
                    } label: {
                        Text(starter)
                            .font(.callout)
                            .foregroundColor(.primary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(Color(.secondarySystemGroupedBackground))
                            .cornerRadius(10)
                    }
                }
            }
        }
        .padding(.vertical, 40)
    }
}

// ─── Empty State ──────────────────────────────────────────────────────────────

struct EmptyConversationView: View {
    let onNew: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 56))
                .foregroundColor(.secondary.opacity(0.4))
            Text("No conversations yet")
                .font(.title3.bold())
            Text("Ask Foundry about your metrics, decisions, or business health.")
                .font(.callout)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button("Start Conversation", action: onNew)
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// ─── Corner Radius Extension ──────────────────────────────────────────────────

extension View {
    func cornerRadius(_ radius: CGFloat, corners: UIRectCorner) -> some View {
        clipShape(RoundedCorner(radius: radius, corners: corners))
    }
}

struct RoundedCorner: Shape {
    var radius: CGFloat
    var corners: UIRectCorner

    func path(in rect: CGRect) -> Path {
        let path = UIBezierPath(
            roundedRect: rect,
            byRoundingCorners: corners,
            cornerRadii: CGSize(width: radius, height: radius)
        )
        return Path(path.cgPath)
    }
}

// ─── API Models ───────────────────────────────────────────────────────────────

struct ConversationThread: Identifiable, Codable, Hashable {
    let id: String
    let title: String
    let intent: String?
    let messageCount: Int
    let lastMessageAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, title, intent
        case messageCount = "message_count"
        case lastMessageAt = "last_message_at"
    }
}

struct ConversationMessage: Identifiable, Codable {
    let id: String
    let role: String
    let content: String
    let intent: String?
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id, role, content, intent
        case createdAt = "created_at"
    }
}

struct ThreadDetail: Codable {
    let thread: ConversationThread
    let messages: [ConversationMessage]
}
