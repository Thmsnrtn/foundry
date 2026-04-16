// =============================================================================
// FOUNDRY — watchOS App
// Signal score complication + glance view.
// Syncs via WatchConnectivity from iPhone app.
// =============================================================================

import SwiftUI
import WatchKit
import WatchConnectivity
import ClockKit

// ─── Watch App Entry ──────────────────────────────────────────────────────────

@main
struct FoundryWatchApp: App {
    @WKApplicationDelegateAdaptor(FoundryWatchDelegate.self) var delegate
    @StateObject private var watchState = WatchState.shared

    var body: some Scene {
        WindowGroup {
            WatchContentView()
                .environmentObject(watchState)
        }
    }
}

// ─── Watch Delegate ───────────────────────────────────────────────────────────

class FoundryWatchDelegate: NSObject, WKApplicationDelegate, WCSessionDelegate {
    override init() {
        super.init()
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}

    // Receive context from iPhone
    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        DispatchQueue.main.async {
            WatchState.shared.update(from: applicationContext)
            self.reloadComplications()
        }
    }

    // Receive immediate message from iPhone
    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        DispatchQueue.main.async {
            WatchState.shared.update(from: message)
            self.reloadComplications()
        }
    }

    private func reloadComplications() {
        let server = CLKComplicationServer.sharedInstance()
        server.activeComplications?.forEach { server.reloadTimeline(for: $0) }
    }
}

// ─── Watch State ──────────────────────────────────────────────────────────────

final class WatchState: ObservableObject {
    static let shared = WatchState()

    @Published var signal: Int = 0
    @Published var riskState: String = "green"
    @Published var focusItem: String = "Loading..."
    @Published var productName: String = "Foundry"
    @Published var pendingDecisions: Int = 0
    @Published var activeStressors: Int = 0
    @Published var lastUpdated: Date?

    private init() {
        load()
    }

    func update(from context: [String: Any]) {
        if let s = context["signal"] as? Int { signal = s }
        if let r = context["risk_state"] as? String { riskState = r }
        if let f = context["focus"] as? String { focusItem = f }
        if let p = context["product_name"] as? String { productName = p }
        if let d = context["pending_decisions"] as? Int { pendingDecisions = d }
        if let a = context["active_stressors"] as? Int { activeStressors = a }
        lastUpdated = Date()
        save()
    }

    private func save() {
        let defaults = UserDefaults.standard
        defaults.set(signal, forKey: "w_signal")
        defaults.set(riskState, forKey: "w_risk_state")
        defaults.set(focusItem, forKey: "w_focus")
        defaults.set(productName, forKey: "w_product")
        defaults.set(pendingDecisions, forKey: "w_decisions")
        defaults.set(activeStressors, forKey: "w_stressors")
    }

    private func load() {
        let defaults = UserDefaults.standard
        signal = defaults.integer(forKey: "w_signal")
        riskState = defaults.string(forKey: "w_risk_state") ?? "green"
        focusItem = defaults.string(forKey: "w_focus") ?? "Open Foundry on iPhone"
        productName = defaults.string(forKey: "w_product") ?? "Foundry"
        pendingDecisions = defaults.integer(forKey: "w_decisions")
        activeStressors = defaults.integer(forKey: "w_stressors")
    }

    var riskColor: Color {
        switch riskState {
        case "red": return .red
        case "yellow": return .orange
        default: return Color(red: 0.188, green: 0.820, blue: 0.345)
        }
    }
}

// ─── Watch Content View ───────────────────────────────────────────────────────

struct WatchContentView: View {
    @EnvironmentObject var watchState: WatchState

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                // Signal ring
                ZStack {
                    Circle()
                        .stroke(watchState.riskColor.opacity(0.2), lineWidth: 8)
                        .frame(width: 100, height: 100)
                    Circle()
                        .trim(from: 0, to: CGFloat(watchState.signal) / 100)
                        .stroke(watchState.riskColor, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                        .frame(width: 100, height: 100)
                        .rotationEffect(.degrees(-90))
                    VStack(spacing: 0) {
                        Text("\(watchState.signal)")
                            .font(.system(size: 30, weight: .bold, design: .rounded))
                            .foregroundColor(watchState.riskColor)
                        Text("SIGNAL")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundColor(.secondary)
                    }
                }

                // Risk state
                Text(watchState.riskState.uppercased())
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(watchState.riskColor)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(watchState.riskColor.opacity(0.15))
                    .cornerRadius(6)

                // Stats row
                HStack(spacing: 16) {
                    WatchStat(value: "\(watchState.pendingDecisions)", label: "Decisions", color: .orange)
                    WatchStat(value: "\(watchState.activeStressors)", label: "Stressors", color: .red)
                }

                // Focus
                VStack(alignment: .leading, spacing: 4) {
                    Text("FOCUS")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(.secondary)
                    Text(watchState.focusItem)
                        .font(.system(size: 13))
                        .lineLimit(3)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(8)
                .background(Color(.systemGray6))
                .cornerRadius(8)

                if let updated = watchState.lastUpdated {
                    Text("Updated \(updated, style: .relative) ago")
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)
                }
            }
            .padding(.horizontal, 8)
        }
        .navigationTitle(watchState.productName)
    }
}

struct WatchStat: View {
    let value: String
    let label: String
    let color: Color

    var body: some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundColor(color)
            Text(label)
                .font(.system(size: 9))
                .foregroundColor(.secondary)
        }
    }
}

// ─── Complication Data Source ─────────────────────────────────────────────────

class FoundryComplicationDataSource: NSObject, CLKComplicationDataSource {
    private var watchState: WatchState { .shared }

    func getCurrentTimelineEntry(
        for complication: CLKComplication,
        withHandler handler: @escaping (CLKComplicationTimelineEntry?) -> Void
    ) {
        handler(makeEntry(for: complication, date: Date()))
    }

    func getTimelineEntries(
        for complication: CLKComplication,
        after date: Date,
        limit: Int,
        withHandler handler: @escaping ([CLKComplicationTimelineEntry]?) -> Void
    ) {
        handler(nil)
    }

    func getComplicationDescriptors(
        handler: @escaping ([CLKComplicationDescriptor]) -> Void
    ) {
        handler([
            CLKComplicationDescriptor(
                identifier: "foundry_signal",
                displayName: "Foundry Signal",
                supportedFamilies: CLKComplicationFamily.allCases
            )
        ])
    }

    private func makeEntry(for complication: CLKComplication, date: Date) -> CLKComplicationTimelineEntry? {
        let template = makeTemplate(for: complication.family)
        return template.map { CLKComplicationTimelineEntry(date: date, complicationTemplate: $0) }
    }

    private func makeTemplate(for family: CLKComplicationFamily) -> CLKComplicationTemplate? {
        let score = watchState.signal
        let riskState = watchState.riskState
        let ringFraction = Float(score) / 100.0

        switch family {
        case .circularSmall:
            let template = CLKComplicationTemplateCircularSmallRingText()
            template.textProvider = CLKSimpleTextProvider(text: "\(score)")
            template.fillFraction = ringFraction
            template.ringStyle = .closed
            template.tintColor = riskUIColor(riskState)
            return template

        case .modularSmall:
            let template = CLKComplicationTemplateModularSmallRingText()
            template.textProvider = CLKSimpleTextProvider(text: "\(score)")
            template.fillFraction = ringFraction
            template.ringStyle = .closed
            template.tintColor = riskUIColor(riskState)
            return template

        case .modularLarge:
            let template = CLKComplicationTemplateModularLargeStandardBody()
            template.headerTextProvider = CLKSimpleTextProvider(text: "Foundry Signal")
            template.body1TextProvider = CLKSimpleTextProvider(text: "\(score)/100 — \(riskState.uppercased())")
            template.body2TextProvider = CLKSimpleTextProvider(text: watchState.focusItem)
            return template

        case .utilitarianSmall, .utilitarianSmallFlat:
            let template = CLKComplicationTemplateUtilitarianSmallFlat()
            template.textProvider = CLKSimpleTextProvider(text: "\(score) ⬤")
            template.tintColor = riskUIColor(riskState)
            return template

        case .utilitarianLarge:
            let template = CLKComplicationTemplateUtilitarianLargeFlat()
            template.textProvider = CLKSimpleTextProvider(text: "Signal \(score) · \(riskState.uppercased())")
            return template

        case .graphicCircular:
            let template = CLKComplicationTemplateGraphicCircularClosedGaugeText()
            template.centerTextProvider = CLKSimpleTextProvider(text: "\(score)")
            template.gaugeProvider = CLKSimpleGaugeProvider(
                style: .fill,
                gaugeColors: [riskUIColor(riskState)],
                gaugeColorLocations: nil,
                fillFraction: ringFraction
            )
            return template

        case .graphicCorner:
            let template = CLKComplicationTemplateGraphicCornerGaugeText()
            template.outerTextProvider = CLKSimpleTextProvider(text: "\(score)")
            template.gaugeProvider = CLKSimpleGaugeProvider(
                style: .fill,
                gaugeColors: [riskUIColor(riskState)],
                gaugeColorLocations: nil,
                fillFraction: ringFraction
            )
            return template

        case .graphicRectangular:
            let template = CLKComplicationTemplateGraphicRectangularStandardBody()
            template.headerTextProvider = CLKSimpleTextProvider(text: "FOUNDRY SIGNAL")
            template.body1TextProvider = CLKSimpleTextProvider(text: "\(score) / 100 — \(riskState.uppercased())")
            template.body2TextProvider = CLKSimpleTextProvider(text: watchState.focusItem)
            return template

        default:
            return nil
        }
    }

    private func riskUIColor(_ state: String) -> UIColor {
        switch state {
        case "red": return .systemRed
        case "yellow": return .systemOrange
        default: return UIColor(red: 0.188, green: 0.820, blue: 0.345, alpha: 1)
        }
    }
}
