// =============================================================================
// FOUNDRY — Home Screen Widget
// Small: Signal score + risk color ring
// Medium: Signal + "Today's One Thing" focus item
// Large: Signal + stressors list
// =============================================================================

import WidgetKit
import SwiftUI
import AppIntents

// ─── Timeline Entry ───────────────────────────────────────────────────────────

struct FoundryEntry: TimelineEntry {
    let date: Date
    let signal: Int
    let riskState: String
    let focusItem: String
    let stressors: [MiniStressor]
    let productName: String
    let isPlaceholder: Bool

    static var placeholder: FoundryEntry {
        FoundryEntry(
            date: Date(),
            signal: 72,
            riskState: "yellow",
            focusItem: "Fix activation drop",
            stressors: [
                MiniStressor(name: "Churn spike", severity: "elevated"),
                MiniStressor(name: "Activation drop", severity: "critical"),
            ],
            productName: "My Product",
            isPlaceholder: true
        )
    }
}

struct MiniStressor: Codable {
    let name: String
    let severity: String
}

// ─── Provider ─────────────────────────────────────────────────────────────────

struct FoundryProvider: AppIntentTimelineProvider {
    typealias Entry = FoundryEntry
    typealias Intent = FoundryWidgetConfigIntent

    func placeholder(in context: Context) -> FoundryEntry {
        .placeholder
    }

    func snapshot(for configuration: FoundryWidgetConfigIntent, in context: Context) async -> FoundryEntry {
        await fetchEntry(configuration: configuration) ?? .placeholder
    }

    func timeline(for configuration: FoundryWidgetConfigIntent, in context: Context) async -> Timeline<FoundryEntry> {
        let entry = await fetchEntry(configuration: configuration) ?? .placeholder
        // Refresh every 30 minutes
        let nextUpdate = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date()
        return Timeline(entries: [entry], policy: .after(nextUpdate))
    }

    private func fetchEntry(configuration: FoundryWidgetConfigIntent) async -> FoundryEntry? {
        guard
            let token = KeychainHelper.shared.read(service: "foundry", account: "authToken"),
            let baseURL = UserDefaults(suiteName: "group.app.foundry")?.string(forKey: "apiBaseURL"),
            let productId = UserDefaults(suiteName: "group.app.foundry")?.string(forKey: "selectedProductId")
        else { return nil }

        guard let url = URL(string: "\(baseURL)/api/dashboard?product_id=\(productId)") else { return nil }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 10

        do {
            let (data, _) = try await URLSession.shared.data(for: request)
            let decoded = try JSONDecoder.foundry.decode(WidgetDashboardData.self, from: data)
            return FoundryEntry(
                date: Date(),
                signal: decoded.signal.score,
                riskState: decoded.signal.riskState,
                focusItem: decoded.signal.prose,
                stressors: decoded.stressors.prefix(3).map { MiniStressor(name: $0.stressorName, severity: $0.severity) },
                productName: decoded.productName,
                isPlaceholder: false
            )
        } catch {
            return nil
        }
    }
}

// ─── Widget Config Intent ─────────────────────────────────────────────────────

struct FoundryWidgetConfigIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Foundry Signal"
    static var description = IntentDescription("Shows your Foundry Signal score.")
}

// ─── Views ────────────────────────────────────────────────────────────────────

struct FoundryWidgetEntryView: View {
    var entry: FoundryEntry
    @Environment(\.widgetFamily) var family

    var riskColor: Color {
        switch entry.riskState {
        case "red": return .red
        case "yellow": return .orange
        default: return Color(red: 0.188, green: 0.820, blue: 0.345)
        }
    }

    var body: some View {
        switch family {
        case .systemSmall: smallView
        case .systemMedium: mediumView
        case .systemLarge: largeView
        case .accessoryCircular: circularView
        case .accessoryRectangular: rectangularView
        default: smallView
        }
    }

    // Small: score ring + number
    private var smallView: some View {
        ZStack {
            Color(.systemBackground)

            VStack(spacing: 6) {
                ZStack {
                    Circle()
                        .stroke(riskColor.opacity(0.2), lineWidth: 8)
                        .frame(width: 70, height: 70)
                    Circle()
                        .trim(from: 0, to: CGFloat(entry.signal) / 100)
                        .stroke(riskColor, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                        .frame(width: 70, height: 70)
                        .rotationEffect(.degrees(-90))
                    VStack(spacing: 0) {
                        Text("\(entry.signal)")
                            .font(.system(size: 22, weight: .bold, design: .rounded))
                            .foregroundColor(riskColor)
                        Text("/ 100")
                            .font(.system(size: 8))
                            .foregroundColor(.secondary)
                    }
                }

                Text(entry.riskState.uppercased())
                    .font(.system(size: 9, weight: .bold))
                    .foregroundColor(riskColor)

                Text(entry.productName)
                    .font(.system(size: 9))
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }
        }
    }

    // Medium: score ring + focus item
    private var mediumView: some View {
        HStack(spacing: 16) {
            ZStack {
                Circle()
                    .stroke(riskColor.opacity(0.2), lineWidth: 10)
                    .frame(width: 90, height: 90)
                Circle()
                    .trim(from: 0, to: CGFloat(entry.signal) / 100)
                    .stroke(riskColor, style: StrokeStyle(lineWidth: 10, lineCap: .round))
                    .frame(width: 90, height: 90)
                    .rotationEffect(.degrees(-90))
                VStack(spacing: 1) {
                    Text("\(entry.signal)")
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                        .foregroundColor(riskColor)
                    Text("/ 100")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("SIGNAL")
                        .font(.caption2.bold())
                        .foregroundColor(.secondary)
                    Spacer()
                    Text(entry.riskState.uppercased())
                        .font(.caption2.bold())
                        .foregroundColor(riskColor)
                }

                Divider()

                Text("Today's Focus")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                Text(entry.focusItem)
                    .font(.caption.bold())
                    .foregroundColor(.primary)
                    .lineLimit(3)
            }
        }
        .padding(14)
    }

    // Large: score + stressors
    private var largeView: some View {
        VStack(spacing: 0) {
            // Top: score row
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.productName)
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text("Signal Score")
                        .font(.headline)
                }
                Spacer()
                ZStack {
                    Circle()
                        .stroke(riskColor.opacity(0.2), lineWidth: 8)
                        .frame(width: 56, height: 56)
                    Circle()
                        .trim(from: 0, to: CGFloat(entry.signal) / 100)
                        .stroke(riskColor, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                        .frame(width: 56, height: 56)
                        .rotationEffect(.degrees(-90))
                    Text("\(entry.signal)")
                        .font(.system(size: 17, weight: .bold, design: .rounded))
                        .foregroundColor(riskColor)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 10)

            Divider().padding(.horizontal, 16)

            // Stressors
            if entry.stressors.isEmpty {
                Text("No active stressors")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .padding(16)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Active Stressors")
                        .font(.caption.bold())
                        .foregroundColor(.secondary)
                    ForEach(entry.stressors, id: \.name) { stressor in
                        HStack(spacing: 8) {
                            Circle()
                                .fill(stressorColor(stressor.severity))
                                .frame(width: 7, height: 7)
                            Text(stressor.name)
                                .font(.callout)
                                .lineLimit(1)
                            Spacer()
                            Text(stressor.severity.uppercased())
                                .font(.caption2.bold())
                                .foregroundColor(stressorColor(stressor.severity))
                        }
                    }
                }
                .padding(16)
            }

            Spacer()

            // Focus
            VStack(alignment: .leading, spacing: 4) {
                Text("TODAY'S FOCUS")
                    .font(.caption2.bold())
                    .foregroundColor(.secondary)
                Text(entry.focusItem)
                    .font(.caption)
                    .foregroundColor(.primary)
                    .lineLimit(2)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 14)
        }
    }

    // Lock screen circular
    private var circularView: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 1) {
                Text("\(entry.signal)")
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                Text(entry.riskState == "red" ? "🔴" : entry.riskState == "yellow" ? "🟡" : "🟢")
                    .font(.system(size: 10))
            }
        }
    }

    // Lock screen rectangular
    private var rectangularView: some View {
        HStack(spacing: 8) {
            Text("\(entry.signal)")
                .font(.system(size: 24, weight: .bold, design: .rounded))
                .foregroundColor(riskColor)
            VStack(alignment: .leading, spacing: 2) {
                Text("Signal")
                    .font(.caption2.bold())
                Text(entry.riskState.capitalized)
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
    }

    private func stressorColor(_ severity: String) -> Color {
        switch severity {
        case "critical": return .red
        case "elevated": return .orange
        default: return .yellow
        }
    }
}

// ─── Widget Definition ────────────────────────────────────────────────────────

struct FoundrySignalWidget: Widget {
    let kind = "FoundrySignalWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: FoundryWidgetConfigIntent.self, provider: FoundryProvider()) { entry in
            FoundryWidgetEntryView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Foundry Signal")
        .description("See your business Signal score at a glance.")
        .supportedFamilies([
            .systemSmall, .systemMedium, .systemLarge,
            .accessoryCircular, .accessoryRectangular,
        ])
    }
}

// ─── Widget Bundle ────────────────────────────────────────────────────────────

@main
struct FoundryWidgetBundle: WidgetBundle {
    var body: some Widget {
        FoundrySignalWidget()
    }
}

// ─── API Models ───────────────────────────────────────────────────────────────

struct WidgetDashboardData: Codable {
    let signal: WidgetSignal
    let stressors: [WidgetStressor]
    let productName: String

    enum CodingKeys: String, CodingKey {
        case signal, stressors
        case productName = "product_name"
    }
}

struct WidgetSignal: Codable {
    let score: Int
    let riskState: String
    let prose: String

    enum CodingKeys: String, CodingKey {
        case score
        case riskState = "risk_state"
        case prose
    }
}

struct WidgetStressor: Codable {
    let stressorName: String
    let severity: String

    enum CodingKeys: String, CodingKey {
        case stressorName = "stressor_name"
        case severity
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

extension JSONDecoder {
    static let foundry: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        d.dateDecodingStrategy = .custom { decoder in
            let s = try decoder.singleValueContainer().decode(String.self)
            return fmt.date(from: s) ?? Date()
        }
        return d
    }()
}

// Keychain stub for widget — reads shared keychain group
final class KeychainHelper {
    static let shared = KeychainHelper()
    private init() {}

    func read(service: String, account: String) -> String? {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecReturnData: true,
            kSecAttrAccessGroup: "group.app.foundry",
        ]
        var result: AnyObject?
        SecItemCopyMatching(query as CFDictionary, &result)
        guard let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
