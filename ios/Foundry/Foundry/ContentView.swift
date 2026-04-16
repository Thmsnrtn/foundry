// =============================================================================
// FOUNDRY iOS — Root Content View
// Tab-based navigation: Dashboard, Ask, Decisions, Briefing, Settings.
// =============================================================================

import SwiftUI

struct ContentView: View {
    @EnvironmentObject var api: FoundryAPI
    @EnvironmentObject var appState: AppState

    var body: some View {
        if !api.isAuthenticated {
            LoginView()
        } else {
            MainTabView()
                .task {
                    await appState.loadProducts()
                }
        }
    }
}

// ─── Main Tab View ────────────────────────────────────────────────────────────

struct MainTabView: View {
    @EnvironmentObject var appState: AppState
    @State private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            DashboardView()
                .tabItem {
                    Label("Signal", systemImage: "waveform.path.ecg")
                }
                .tag(0)

            AskFoundryView()
                .tabItem {
                    Label("Ask", systemImage: "bubble.left.and.bubble.right")
                }
                .tag(1)

            DecisionsView()
                .tabItem {
                    Label("Decisions", systemImage: "checkmark.circle")
                }
                .tag(2)

            MorningBriefingView()
                .tabItem {
                    Label("Briefing", systemImage: "sunrise")
                }
                .tag(3)

            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gear")
                }
                .tag(4)
        }
        .onReceive(NotificationCenter.default.publisher(for: .foundryNavigateToDashboard)) { _ in
            selectedTab = 0
        }
        .onReceive(NotificationCenter.default.publisher(for: .foundryNavigateToDecision)) { _ in
            selectedTab = 2
        }
    }
}

// ─── Login View ───────────────────────────────────────────────────────────────

struct LoginView: View {
    @EnvironmentObject var api: FoundryAPI
    @State private var token = ""

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: "waveform.path.ecg.rectangle")
                .font(.system(size: 64))
                .foregroundColor(.primary)

            Text("Foundry")
                .font(.largeTitle.bold())

            Text("Autonomous Business Intelligence")
                .font(.subheadline)
                .foregroundColor(.secondary)

            Spacer()

            // In production, this integrates with Clerk's native SDK
            // For now, accepts a JWT token directly
            VStack(alignment: .leading, spacing: 8) {
                Text("Auth Token")
                    .font(.caption)
                    .foregroundColor(.secondary)
                SecureField("Paste your Foundry JWT token", text: $token)
                    .textFieldStyle(.roundedBorder)
            }

            Button("Sign In") {
                api.setAuthToken(token)
            }
            .buttonStyle(.borderedProminent)
            .disabled(token.isEmpty)
        }
        .padding(32)
    }
}
