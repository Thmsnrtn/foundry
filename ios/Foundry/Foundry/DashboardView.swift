// =============================================================================
// FOUNDRY iOS — Dashboard View
// Signal score, risk state, stressors, pending decisions.
// Pull-to-refresh. Ambient animations.
// =============================================================================

import SwiftUI

struct DashboardView: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var api: FoundryAPI

    @State private var dashboard: DashboardData?
    @State private var isLoading = false
    @State private var error: String?
    @State private var signalAnimating = false

    var body: some View {
        NavigationStack {
            Group {
                if isLoading && dashboard == nil {
                    ProgressView("Loading Signal...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let dashboard {
                    ScrollView {
                        VStack(spacing: 20) {
                            // ── Signal Score Card ──────────────────────────
                            SignalCard(signal: dashboard.signal, animating: $signalAnimating)

                            // ── MRR Health ─────────────────────────────────
                            if let mrr = dashboard.mrr {
                                MRRCard(mrr: mrr)
                            }

                            // ── Active Stressors ───────────────────────────
                            if !dashboard.stressors.isEmpty {
                                StressorList(stressors: dashboard.stressors)
                            }

                            // ── Pending Decisions ──────────────────────────
                            if !dashboard.pendingDecisions.isEmpty {
                                DecisionQueueCard(decisions: dashboard.pendingDecisions)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                    }
                    .refreshable {
                        await loadDashboard()
                    }
                } else if let error {
                    ErrorView(message: error) {
                        Task { await loadDashboard() }
                    }
                }
            }
            .navigationTitle(appState.products.first(where: { $0.id == appState.selectedProductId })?.name ?? "Foundry")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    ProductSwitcher()
                }
            }
        }
        .task {
            await loadDashboard()
        }
        .onChange(of: appState.selectedProductId) { _, _ in
            Task { await loadDashboard() }
        }
    }

    private func loadDashboard() async {
        guard let productId = appState.selectedProductId else { return }
        isLoading = true
        do {
            let data = try await api.getDashboard(productId: productId)
            dashboard = data
            withAnimation(.easeInOut(duration: 0.6).delay(0.2)) {
                signalAnimating = true
            }
            // Push latest state to Watch and Widget
            appState.syncToWatch(
                signal: data.signal.score,
                riskState: data.signal.riskState,
                focus: data.signal.prose,
                decisions: data.pendingDecisions.count,
                stressors: data.stressors.count
            )
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}

// ─── Signal Card ──────────────────────────────────────────────────────────────

struct SignalCard: View {
    let signal: SignalResult
    @Binding var animating: Bool

    var riskColor: Color {
        switch signal.riskState {
        case "red": return .red
        case "yellow": return .orange
        default: return Color(hex: "#30D158")
        }
    }

    var body: some View {
        VStack(spacing: 16) {
            HStack {
                Text("Signal")
                    .font(.headline)
                    .foregroundColor(.secondary)
                Spacer()
                RiskStateBadge(state: signal.riskState)
            }

            // Animated ring + number
            ZStack {
                Circle()
                    .stroke(riskColor.opacity(0.15), lineWidth: 12)
                    .frame(width: 140, height: 140)

                Circle()
                    .trim(from: 0, to: animating ? CGFloat(signal.score) / 100 : 0)
                    .stroke(riskColor, style: StrokeStyle(lineWidth: 12, lineCap: .round))
                    .frame(width: 140, height: 140)
                    .rotationEffect(.degrees(-90))
                    .animation(.easeInOut(duration: 1.2), value: animating)

                VStack(spacing: 2) {
                    Text("\(signal.score)")
                        .font(.system(size: 44, weight: .bold, design: .rounded))
                        .foregroundColor(riskColor)
                    Text("/ 100")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            Text(signal.prose)
                .font(.callout)
                .foregroundColor(.primary)
                .multilineTextAlignment(.center)
                .lineSpacing(4)
        }
        .padding(20)
        .background(Color(.secondarySystemGroupedBackground))
        .cornerRadius(16)
    }
}

struct RiskStateBadge: View {
    let state: String

    var color: Color {
        switch state {
        case "red": return .red
        case "yellow": return .orange
        default: return Color(hex: "#30D158")
        }
    }

    var body: some View {
        Text(state.uppercased())
            .font(.caption.bold())
            .foregroundColor(color)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(color.opacity(0.12))
            .cornerRadius(8)
    }
}

// ─── MRR Card ─────────────────────────────────────────────────────────────────

struct MRRCard: View {
    let mrr: DashboardData.MRRData

    var healthColor: Color {
        guard let ratio = mrr.healthRatio else { return .secondary }
        if ratio > 1.0 { return .red }
        if ratio > 0.7 { return .orange }
        return Color(hex: "#30D158")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Revenue")
                .font(.headline)
                .foregroundColor(.secondary)

            HStack(spacing: 0) {
                MRRMetric(label: "Total MRR", value: "$\(mrr.total.formatted())", color: .primary)
                Divider().frame(height: 40)
                MRRMetric(label: "New", value: "+$\(mrr.new.formatted())", color: Color(hex: "#30D158"))
                Divider().frame(height: 40)
                MRRMetric(label: "Churned", value: "-$\(mrr.churned.formatted())", color: .red)
            }

            if let ratio = mrr.healthRatio {
                HStack {
                    Text("Health Ratio")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Spacer()
                    Text(String(format: "%.2f", ratio))
                        .font(.caption.bold())
                        .foregroundColor(healthColor)
                    Text(ratio > 1.0 ? "churning faster than growing" : "growing faster than churning")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground))
        .cornerRadius(16)
    }
}

struct MRRMetric: View {
    let label: String
    let value: String
    let color: Color

    var body: some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.callout.bold())
                .foregroundColor(color)
            Text(label)
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

// ─── Stressor List ────────────────────────────────────────────────────────────

struct StressorList: View {
    let stressors: [Stressor]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Active Stressors")
                    .font(.headline)
                    .foregroundColor(.secondary)
                Spacer()
                Text("\(stressors.count)")
                    .font(.caption.bold())
                    .foregroundColor(.secondary)
            }

            ForEach(stressors) { stressor in
                StressorRow(stressor: stressor)
            }
        }
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground))
        .cornerRadius(16)
    }
}

struct StressorRow: View {
    let stressor: Stressor

    var severityColor: Color {
        switch stressor.severity {
        case "critical": return .red
        case "elevated": return .orange
        default: return .yellow
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Circle()
                    .fill(severityColor)
                    .frame(width: 8, height: 8)
                Text(stressor.stressorName)
                    .font(.callout.bold())
                Spacer()
                Text(stressor.severity.uppercased())
                    .font(.caption2.bold())
                    .foregroundColor(severityColor)
            }
            Text(stressor.signal)
                .font(.caption)
                .foregroundColor(.secondary)
            Text("→ \(stressor.neutralizingAction)")
                .font(.caption)
                .foregroundColor(.primary)
        }
        .padding(12)
        .background(severityColor.opacity(0.06))
        .cornerRadius(10)
    }
}

// ─── Decision Queue Card ──────────────────────────────────────────────────────

struct DecisionQueueCard: View {
    let decisions: [Decision]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Decisions Pending")
                    .font(.headline)
                    .foregroundColor(.secondary)
                Spacer()
                Text("\(decisions.count)")
                    .font(.caption.bold())
                    .foregroundColor(.orange)
            }

            ForEach(decisions.prefix(3)) { decision in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(decision.what)
                            .font(.callout)
                            .lineLimit(2)
                        Text("\(decision.category) · Gate \(decision.gate)")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding(.vertical, 4)
                if decision.id != decisions.prefix(3).last?.id {
                    Divider()
                }
            }
        }
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground))
        .cornerRadius(16)
    }
}

// ─── Product Switcher ─────────────────────────────────────────────────────────

struct ProductSwitcher: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        if appState.products.count > 1 {
            Menu {
                ForEach(appState.products) { product in
                    Button {
                        appState.selectedProductId = product.id
                    } label: {
                        if product.id == appState.selectedProductId {
                            Label(product.name, systemImage: "checkmark")
                        } else {
                            Text(product.name)
                        }
                    }
                }
            } label: {
                Image(systemName: "rectangle.stack")
            }
        }
    }
}

// ─── Error View ───────────────────────────────────────────────────────────────

struct ErrorView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 40))
                .foregroundColor(.orange)
            Text(message)
                .font(.callout)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
            Button("Retry", action: retry)
                .buttonStyle(.bordered)
        }
        .padding(32)
    }
}

// ─── Color Extension ──────────────────────────────────────────────────────────

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let r = Double((int >> 16) & 0xFF) / 255
        let g = Double((int >> 8) & 0xFF) / 255
        let b = Double(int & 0xFF) / 255
        self.init(red: r, green: g, blue: b)
    }
}
