// =============================================================================
// FOUNDRY iOS — Settings View
// Push notification preferences, auth, product management.
// =============================================================================

import SwiftUI
import UserNotifications

struct SettingsView: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var api: FoundryAPI

    @State private var notificationPrefs = NotificationPreferences()
    @State private var isSavingPrefs = false
    @State private var pushStatus: UNAuthorizationStatus = .notDetermined
    @State private var showSignOutConfirm = false
    @AppStorage("apiBaseURL") private var apiBaseURL = ""
    @AppStorage("enableDebugMode") private var debugMode = false

    var body: some View {
        NavigationStack {
            Form {
                // ── Account ───────────────────────────────────────────────────
                Section("Account") {
                    if let name = appState.founderName {
                        LabeledContent("Name", value: name)
                    }
                    if let email = appState.founderEmail {
                        LabeledContent("Email", value: email)
                    }
                    Button(role: .destructive) {
                        showSignOutConfirm = true
                    } label: {
                        Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                }

                // ── Products ──────────────────────────────────────────────────
                if !appState.products.isEmpty {
                    Section("Products") {
                        ForEach(appState.products) { product in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(product.name)
                                        .font(.callout)
                                    Text(product.marketCategory)
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                                Spacer()
                                if product.id == appState.selectedProductId {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundColor(.blue)
                                }
                            }
                            .contentShape(Rectangle())
                            .onTapGesture {
                                appState.selectedProductId = product.id
                            }
                        }
                    }
                }

                // ── Notifications ─────────────────────────────────────────────
                Section {
                    if pushStatus == .denied {
                        HStack {
                            Image(systemName: "bell.slash.fill")
                                .foregroundColor(.orange)
                            Text("Notifications disabled")
                                .foregroundColor(.secondary)
                            Spacer()
                            Button("Enable") {
                                openNotificationSettings()
                            }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                        }
                    } else {
                        Toggle("Signal drops to RED", isOn: $notificationPrefs.signalRed)
                        Toggle("Signal drops to YELLOW", isOn: $notificationPrefs.signalYellow)
                        Toggle("New pending decision", isOn: $notificationPrefs.newDecision)
                        Toggle("New active stressor", isOn: $notificationPrefs.newStressor)
                        Toggle("Morning briefing ready", isOn: $notificationPrefs.morningBriefing)
                        Toggle("Alignment score drops", isOn: $notificationPrefs.alignmentDrop)
                    }
                } header: {
                    Text("Notifications")
                } footer: {
                    if pushStatus != .denied {
                        Text("Choose which Foundry events trigger a push notification.")
                    }
                }

                if pushStatus != .denied {
                    Section {
                        Button {
                            Task { await saveNotificationPrefs() }
                        } label: {
                            if isSavingPrefs {
                                HStack {
                                    ProgressView()
                                    Text("Saving...")
                                }
                            } else {
                                Text("Save Notification Preferences")
                            }
                        }
                        .disabled(isSavingPrefs)
                    }
                }

                // ── Advanced ──────────────────────────────────────────────────
                Section("Advanced") {
                    Toggle("Debug Mode", isOn: $debugMode)
                    if debugMode {
                        TextField("API Base URL", text: $apiBaseURL)
                            .autocapitalization(.none)
                            .autocorrectionDisabled()
                            .font(.caption.monospaced())
                    }
                    NavigationLink {
                        DiagnosticsView()
                            .environmentObject(api)
                            .environmentObject(appState)
                    } label: {
                        Label("Diagnostics", systemImage: "stethoscope")
                    }
                }

                // ── About ─────────────────────────────────────────────────────
                Section("About") {
                    LabeledContent("Version", value: appVersion)
                    LabeledContent("Build", value: buildNumber)
                    Link(destination: URL(string: "https://foundry.app/privacy")!) {
                        Label("Privacy Policy", systemImage: "hand.raised.fill")
                    }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.large)
        }
        .confirmationDialog("Sign Out", isPresented: $showSignOutConfirm, titleVisibility: .visible) {
            Button("Sign Out", role: .destructive) {
                appState.signOut()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You'll need to sign in again to access your products.")
        }
        .task {
            await checkPushStatus()
            loadNotificationPrefs()
        }
    }

    private func checkPushStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        pushStatus = settings.authorizationStatus
    }

    private func openNotificationSettings() {
        if let url = URL(string: UIApplication.openNotificationSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }

    private func loadNotificationPrefs() {
        let defaults = UserDefaults.standard
        notificationPrefs = NotificationPreferences(
            signalRed: defaults.bool(forKey: "notif_signal_red", default: true),
            signalYellow: defaults.bool(forKey: "notif_signal_yellow", default: false),
            newDecision: defaults.bool(forKey: "notif_new_decision", default: true),
            newStressor: defaults.bool(forKey: "notif_new_stressor", default: true),
            morningBriefing: defaults.bool(forKey: "notif_morning_briefing", default: true),
            alignmentDrop: defaults.bool(forKey: "notif_alignment_drop", default: false)
        )
    }

    private func saveNotificationPrefs() async {
        isSavingPrefs = true

        let defaults = UserDefaults.standard
        defaults.set(notificationPrefs.signalRed, forKey: "notif_signal_red")
        defaults.set(notificationPrefs.signalYellow, forKey: "notif_signal_yellow")
        defaults.set(notificationPrefs.newDecision, forKey: "notif_new_decision")
        defaults.set(notificationPrefs.newStressor, forKey: "notif_new_stressor")
        defaults.set(notificationPrefs.morningBriefing, forKey: "notif_morning_briefing")
        defaults.set(notificationPrefs.alignmentDrop, forKey: "notif_alignment_drop")

        if let productId = appState.selectedProductId {
            try? await api.updatePushPreferences(productId: productId, prefs: notificationPrefs)
        }

        isSavingPrefs = false
    }

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—"
    }

    private var buildNumber: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "—"
    }
}

// ─── Diagnostics View ─────────────────────────────────────────────────────────

struct DiagnosticsView: View {
    @EnvironmentObject var api: FoundryAPI
    @EnvironmentObject var appState: AppState

    @State private var pingResult: String = "—"
    @State private var isPinging = false

    var body: some View {
        Form {
            Section("Connectivity") {
                HStack {
                    Text("API Ping")
                    Spacer()
                    Text(pingResult)
                        .font(.caption.monospaced())
                        .foregroundColor(.secondary)
                }
                Button("Run Ping") {
                    Task { await runPing() }
                }
                .disabled(isPinging)
            }

            Section("Session") {
                LabeledContent("Founder ID", value: appState.founderId ?? "—")
                LabeledContent("Product", value: appState.selectedProductId ?? "—")
                LabeledContent("Products loaded", value: "\(appState.products.count)")
            }
        }
        .navigationTitle("Diagnostics")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func runPing() async {
        isPinging = true
        pingResult = "Checking..."
        let start = Date()
        do {
            _ = try await api.ping()
            let ms = Int(Date().timeIntervalSince(start) * 1000)
            pingResult = "OK (\(ms)ms)"
        } catch {
            pingResult = "FAILED: \(error.localizedDescription)"
        }
        isPinging = false
    }
}

// ─── Notification Preferences ─────────────────────────────────────────────────

struct NotificationPreferences: Codable {
    var signalRed: Bool = true
    var signalYellow: Bool = false
    var newDecision: Bool = true
    var newStressor: Bool = true
    var morningBriefing: Bool = true
    var alignmentDrop: Bool = false

    enum CodingKeys: String, CodingKey {
        case signalRed = "signal_red"
        case signalYellow = "signal_yellow"
        case newDecision = "new_decision"
        case newStressor = "new_stressor"
        case morningBriefing = "morning_briefing"
        case alignmentDrop = "alignment_drop"
    }
}

// ─── UserDefaults Extension ───────────────────────────────────────────────────

extension UserDefaults {
    func bool(forKey key: String, default defaultValue: Bool) -> Bool {
        if object(forKey: key) == nil { return defaultValue }
        return bool(forKey: key)
    }
}
