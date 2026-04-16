// =============================================================================
// FOUNDRY iOS — Decisions View
// Decision queue, voting in co-founder mode, outcome tracking.
// =============================================================================

import SwiftUI

struct DecisionsView: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var api: FoundryAPI

    @State private var decisions: [Decision] = []
    @State private var isLoading = false
    @State private var filter: DecisionFilter = .pending
    @State private var selectedDecision: Decision?
    @State private var showNewDecision = false

    enum DecisionFilter: String, CaseIterable {
        case pending = "Pending"
        case decided = "Decided"
        case all = "All"
    }

    var filteredDecisions: [Decision] {
        switch filter {
        case .pending: return decisions.filter { $0.decidedAt == nil }
        case .decided: return decisions.filter { $0.decidedAt != nil }
        case .all: return decisions
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if isLoading && decisions.isEmpty {
                    ProgressView("Loading decisions...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    VStack(spacing: 0) {
                        // Filter picker
                        Picker("Filter", selection: $filter) {
                            ForEach(DecisionFilter.allCases, id: \.self) { f in
                                Text(f.rawValue).tag(f)
                            }
                        }
                        .pickerStyle(.segmented)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)

                        if filteredDecisions.isEmpty {
                            emptyState
                        } else {
                            decisionList
                        }
                    }
                }
            }
            .navigationTitle("Decisions")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        showNewDecision = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(item: $selectedDecision) { decision in
                DecisionDetailView(decision: decision)
                    .environmentObject(api)
                    .environmentObject(appState)
            }
            .sheet(isPresented: $showNewDecision) {
                NewDecisionView(productId: appState.selectedProductId ?? "") { newDecision in
                    decisions.insert(newDecision, at: 0)
                    showNewDecision = false
                }
                .environmentObject(api)
            }
        }
        .task { await loadDecisions() }
        .onChange(of: appState.selectedProductId) { _, _ in
            Task { await loadDecisions() }
        }
    }

    private var decisionList: some View {
        List {
            ForEach(filteredDecisions) { decision in
                DecisionRow(decision: decision)
                    .contentShape(Rectangle())
                    .onTapGesture { selectedDecision = decision }
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
            }
        }
        .listStyle(.plain)
        .refreshable { await loadDecisions() }
    }

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: filter == .pending ? "checkmark.circle" : "tray")
                .font(.system(size: 48))
                .foregroundColor(.secondary.opacity(0.4))
            Text(filter == .pending ? "No pending decisions" : "No decisions yet")
                .font(.headline)
            Text(filter == .pending
                 ? "Log a decision to start your operating track record."
                 : "Your decision history will appear here.")
                .font(.callout)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func loadDecisions() async {
        guard let productId = appState.selectedProductId else { return }
        isLoading = true
        decisions = (try? await api.getDecisions(productId: productId)) ?? []
        isLoading = false
    }
}

// ─── Decision Row ─────────────────────────────────────────────────────────────

struct DecisionRow: View {
    let decision: Decision

    var gateColor: Color {
        switch decision.gate {
        case 0: return Color(hex: "#30D158")
        case 1: return .blue
        case 2: return .orange
        case 3: return .red
        default: return .secondary
        }
    }

    var categoryIcon: String {
        switch decision.category {
        case "urgent": return "exclamationmark.circle.fill"
        case "strategic": return "arrow.up.forward.circle.fill"
        case "product": return "cube.fill"
        case "marketing": return "megaphone.fill"
        default: return "doc.circle.fill"
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: categoryIcon)
                .font(.title2)
                .foregroundColor(gateColor)
                .frame(width: 36)

            VStack(alignment: .leading, spacing: 4) {
                Text(decision.what)
                    .font(.callout.bold())
                    .lineLimit(2)

                HStack(spacing: 6) {
                    Text("Gate \(decision.gate)")
                        .font(.caption2.bold())
                        .foregroundColor(gateColor)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(gateColor.opacity(0.1))
                        .cornerRadius(4)

                    Text(decision.category.replacingOccurrences(of: "_", with: " ").capitalized)
                        .font(.caption2)
                        .foregroundColor(.secondary)

                    if let decided = decision.decidedAt {
                        Text("·")
                            .foregroundColor(.secondary)
                        Text(decided, style: .date)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }
            }

            Spacer()

            if decision.decidedAt == nil {
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundColor(.secondary)
            } else if let outcome = decision.outcome {
                OutcomeIcon(outcome: outcome)
            }
        }
        .padding(14)
        .background(Color(.secondarySystemGroupedBackground))
        .cornerRadius(12)
    }
}

struct OutcomeIcon: View {
    let outcome: String

    var body: some View {
        Image(systemName: outcome == "positive" ? "checkmark.circle.fill" :
              outcome == "negative" ? "xmark.circle.fill" : "minus.circle.fill")
            .foregroundColor(outcome == "positive" ? Color(hex: "#30D158") :
                             outcome == "negative" ? .red : .orange)
    }
}

// ─── Decision Detail ──────────────────────────────────────────────────────────

struct DecisionDetailView: View {
    let decision: Decision
    @EnvironmentObject var api: FoundryAPI
    @EnvironmentObject var appState: AppState
    @Environment(\.dismiss) var dismiss

    @State private var votes: [DecisionVoteItem] = []
    @State private var myVote: String = ""
    @State private var myPreferred: String = ""
    @State private var myRationale: String = ""
    @State private var isSubmitting = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Header
                    VStack(alignment: .leading, spacing: 8) {
                        Text(decision.category.uppercased())
                            .font(.caption.bold())
                            .foregroundColor(.secondary)
                        Text(decision.what)
                            .font(.title3.bold())
                        HStack {
                            Text("Gate \(decision.gate)")
                                .font(.caption.bold())
                                .foregroundColor(.orange)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(Color.orange.opacity(0.1))
                                .cornerRadius(6)
                            if let created = decision.createdAt {
                                Text("Added \(created, style: .relative) ago")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.secondarySystemGroupedBackground))
                    .cornerRadius(12)

                    // Options
                    if let options = decision.options, !options.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Options")
                                .font(.headline)
                                .foregroundColor(.secondary)
                            ForEach(options, id: \.self) { option in
                                HStack {
                                    Image(systemName: "circle.fill")
                                        .font(.system(size: 6))
                                        .foregroundColor(.secondary)
                                    Text(option)
                                        .font(.callout)
                                }
                            }
                        }
                        .padding(16)
                        .background(Color(.secondarySystemGroupedBackground))
                        .cornerRadius(12)
                    }

                    // Outcome (if decided)
                    if let decided = decision.decidedAt {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Decision")
                                .font(.headline)
                                .foregroundColor(.secondary)
                            if let chosen = decision.chosenOption {
                                Text("Chose: \(chosen)")
                                    .font(.callout.bold())
                            }
                            if let rationale = decision.rationale {
                                Text(rationale)
                                    .font(.callout)
                                    .foregroundColor(.secondary)
                            }
                            Text("Decided \(decided, style: .date)")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        .padding(16)
                        .background(Color(.secondarySystemGroupedBackground))
                        .cornerRadius(12)
                    }

                    // Team Votes
                    if !votes.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Team Votes")
                                .font(.headline)
                                .foregroundColor(.secondary)
                            ForEach(votes, id: \.founderName) { vote in
                                HStack {
                                    Text(vote.founderName)
                                        .font(.callout)
                                    Spacer()
                                    VoteChip(vote: vote.vote)
                                    if let preferred = vote.preferredOption {
                                        Text(preferred)
                                            .font(.caption)
                                            .foregroundColor(.secondary)
                                            .lineLimit(1)
                                    }
                                }
                            }
                        }
                        .padding(16)
                        .background(Color(.secondarySystemGroupedBackground))
                        .cornerRadius(12)
                    }

                    // Cast Vote (if pending)
                    if decision.decidedAt == nil {
                        voteSection
                    }
                }
                .padding(16)
            }
            .navigationTitle("Decision")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .task {
            votes = (try? await api.getDecisionVotes(decisionId: decision.id)) ?? []
        }
    }

    private var voteSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Your Vote")
                .font(.headline)
                .foregroundColor(.secondary)

            // Vote buttons
            HStack(spacing: 8) {
                ForEach(["approve", "reject", "abstain", "needs_more_info"], id: \.self) { v in
                    Button {
                        myVote = v
                    } label: {
                        Text(v == "needs_more_info" ? "More Info" : v.capitalized)
                            .font(.caption.bold())
                            .foregroundColor(myVote == v ? .white : .primary)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(myVote == v ? voteButtonColor(v) : Color(.secondarySystemGroupedBackground))
                            .cornerRadius(8)
                    }
                }
            }

            if let options = decision.options, !options.isEmpty {
                Menu {
                    ForEach(options, id: \.self) { opt in
                        Button(opt) { myPreferred = opt }
                    }
                } label: {
                    HStack {
                        Text(myPreferred.isEmpty ? "Preferred option..." : myPreferred)
                            .font(.callout)
                            .foregroundColor(myPreferred.isEmpty ? .secondary : .primary)
                        Spacer()
                        Image(systemName: "chevron.up.chevron.down")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .padding(12)
                    .background(Color(.secondarySystemGroupedBackground))
                    .cornerRadius(8)
                }
            }

            TextField("Rationale (optional)", text: $myRationale, axis: .vertical)
                .textFieldStyle(.plain)
                .lineLimit(2...4)
                .padding(12)
                .background(Color(.secondarySystemGroupedBackground))
                .cornerRadius(8)

            Button {
                Task { await submitVote() }
            } label: {
                if isSubmitting {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Submit Vote")
                        .font(.callout.bold())
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(myVote.isEmpty || isSubmitting)
        }
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground))
        .cornerRadius(12)
    }

    private func voteButtonColor(_ vote: String) -> Color {
        switch vote {
        case "approve": return Color(hex: "#30D158")
        case "reject": return .red
        case "needs_more_info": return .orange
        default: return .secondary
        }
    }

    private func submitVote() async {
        guard !myVote.isEmpty, let founderId = appState.founderId else { return }
        isSubmitting = true
        do {
            try await api.submitVote(
                decisionId: decision.id,
                productId: decision.productId,
                vote: myVote,
                preferredOption: myPreferred.isEmpty ? nil : myPreferred,
                rationale: myRationale.isEmpty ? nil : myRationale
            )
            votes = (try? await api.getDecisionVotes(decisionId: decision.id)) ?? []
        } catch {}
        isSubmitting = false
    }
}

struct VoteChip: View {
    let vote: String

    var color: Color {
        switch vote {
        case "approve": return Color(hex: "#30D158")
        case "reject": return .red
        case "needs_more_info": return .orange
        default: return .secondary
        }
    }

    var body: some View {
        Text(vote == "needs_more_info" ? "More Info" : vote.capitalized)
            .font(.caption2.bold())
            .foregroundColor(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.1))
            .cornerRadius(4)
    }
}

// ─── New Decision Sheet ───────────────────────────────────────────────────────

struct NewDecisionView: View {
    let productId: String
    let onCreate: (Decision) -> Void

    @EnvironmentObject var api: FoundryAPI
    @Environment(\.dismiss) var dismiss

    @State private var what = ""
    @State private var category = "strategic"
    @State private var gate = 2
    @State private var isCreating = false

    let categories = ["urgent", "strategic", "product", "marketing", "informational"]

    var body: some View {
        NavigationStack {
            Form {
                Section("Decision") {
                    TextField("What needs to be decided?", text: $what, axis: .vertical)
                        .lineLimit(2...5)
                }

                Section("Category") {
                    Picker("Category", selection: $category) {
                        ForEach(categories, id: \.self) { cat in
                            Text(cat.capitalized).tag(cat)
                        }
                    }
                    .pickerStyle(.menu)
                }

                Section {
                    Stepper("Gate \(gate) — \(gateLabel)", value: $gate, in: 0...4)
                } header: {
                    Text("Gate Level")
                } footer: {
                    Text(gateDescription)
                        .font(.caption)
                }
            }
            .navigationTitle("New Decision")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        Task { await createDecision() }
                    }
                    .disabled(what.trimmingCharacters(in: .whitespaces).isEmpty || isCreating)
                }
            }
        }
    }

    private var gateLabel: String {
        ["Autonomous", "Auto + Log", "AI Draft", "Human Final", "Human Only"][gate]
    }

    private var gateDescription: String {
        [
            "Fully autonomous — AI handles it.",
            "AI acts and logs for your review.",
            "AI drafts a recommendation, you approve.",
            "Human makes the final call, AI assists.",
            "Human-only decision, no AI involvement.",
        ][gate]
    }

    private func createDecision() async {
        let text = what.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        isCreating = true
        if let decision = try? await api.createDecision(productId: productId, what: text, category: category, gate: gate) {
            onCreate(decision)
        }
        isCreating = false
    }
}

// ─── API Model ────────────────────────────────────────────────────────────────

struct DecisionVoteItem: Codable {
    let founderName: String
    let vote: String
    let preferredOption: String?
    let rationale: String?

    enum CodingKeys: String, CodingKey {
        case founderName = "founder_name"
        case vote
        case preferredOption = "preferred_option"
        case rationale
    }
}
