// =============================================================================
// FOUNDRY iOS — App Entry Point
// Handles app lifecycle, push notification registration, and deep linking.
// =============================================================================

import SwiftUI
import UserNotifications
import WatchConnectivity

@main
struct FoundryApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(FoundryAPI.shared)
                .environmentObject(AppState.shared)
        }
    }
}

// ─── App State ─────────────────────────────────────────────────────────────────

@MainActor
final class AppState: ObservableObject {
    static let shared = AppState()

    @Published var selectedProductId: String?
    @Published var products: [Product] = []
    @Published var isLoading = false
    @Published var authError: String?
    @Published var founderName: String?
    @Published var founderEmail: String?
    @Published var founderId: String?

    func loadProducts() async {
        isLoading = true
        do {
            products = try await FoundryAPI.shared.getProducts()
            if selectedProductId == nil {
                selectedProductId = UserDefaults.standard.string(forKey: "selectedProductId") ?? products.first?.id
            }
        } catch {
            authError = error.localizedDescription
        }
        isLoading = false
    }

    func signOut() {
        FoundryAPI.shared.clearToken()
        selectedProductId = nil
        products = []
        founderName = nil
        founderEmail = nil
        founderId = nil
    }

    // Push to Apple Watch via WatchConnectivity
    func syncToWatch(signal: Int, riskState: String, focus: String, decisions: Int, stressors: Int) {
        guard WCSession.default.isPaired, WCSession.default.isWatchAppInstalled else { return }
        let context: [String: Any] = [
            "signal": signal,
            "risk_state": riskState,
            "focus": focus,
            "product_name": products.first(where: { $0.id == selectedProductId })?.name ?? "Foundry",
            "pending_decisions": decisions,
            "active_stressors": stressors,
        ]
        try? WCSession.default.updateApplicationContext(context)
        // Also save to shared UserDefaults for widget
        let shared = UserDefaults(suiteName: "group.app.foundry")
        shared?.set(selectedProductId, forKey: "selectedProductId")
    }
}

// ─── App Delegate ─────────────────────────────────────────────────────────────

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate, WCSessionDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        // Request push notification permission
        UNUserNotificationCenter.current().delegate = self
        Task { @MainActor in
            let granted = try? await UNUserNotificationCenter.current().requestAuthorization(
                options: [.alert, .sound, .badge]
            )
            if granted == true {
                await MainActor.run {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }
        }

        // Load stored auth token
        FoundryAPI.shared.loadStoredToken()

        // Activate WatchConnectivity
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }

        return true
    }

    // WCSession delegate stubs (required)
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) { session.activate() }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let bundleId = Bundle.main.bundleIdentifier ?? "app.foundry.ios"
        Task { @MainActor in
            try? await FoundryAPI.shared.registerPushToken(deviceToken, bundleId: bundleId)
        }
    }

    // Foreground notification — show it
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        return [.banner, .sound, .badge]
    }

    // Notification tapped — deep link
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let userInfo = response.notification.request.content.userInfo
        await handleDeepLink(userInfo)
    }

    @MainActor
    private func handleDeepLink(_ userInfo: [AnyHashable: Any]) {
        guard let type = userInfo["type"] as? String else { return }

        switch type {
        case "risk_state_change", "critical_stressor":
            // Navigate to dashboard
            NotificationCenter.default.post(name: .foundryNavigateToDashboard, object: nil)
        case "decision_deadline":
            if let decisionId = userInfo["decision_id"] as? String {
                NotificationCenter.default.post(name: .foundryNavigateToDecision, object: decisionId)
            }
        case "milestone":
            NotificationCenter.default.post(name: .foundryNavigateToTimeline, object: nil)
        default:
            break
        }
    }
}

extension Notification.Name {
    static let foundryNavigateToDashboard = Notification.Name("foundry.navigate.dashboard")
    static let foundryNavigateToDecision = Notification.Name("foundry.navigate.decision")
    static let foundryNavigateToTimeline = Notification.Name("foundry.navigate.timeline")
}
