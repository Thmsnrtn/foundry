// =============================================================================
// FOUNDRY iOS — API Client
// Typed Swift client for the Foundry backend API.
// Handles auth (Clerk JWT via SecureStorage), multi-product context,
// and all endpoints needed by the app, widgets, and Watch extension.
// =============================================================================

import Foundation
import Combine

// ─── Models ───────────────────────────────────────────────────────────────────

struct SignalResult: Codable, Sendable {
    let score: Int
    let tier: String           // "high" | "mid" | "low"
    let prose: String
    let riskState: String      // "green" | "yellow" | "red"

    enum CodingKeys: String, CodingKey {
        case score, tier, prose
        case riskState = "risk_state"
    }

    var tierColor: String {
        switch riskState {
        case "red": return "#FF3B30"
        case "yellow": return "#FF9F0A"
        default: return "#30D158"
        }
    }
}

struct Product: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let marketCategory: String
    let status: String

    enum CodingKeys: String, CodingKey {
        case id, name, status
        case marketCategory = "market_category"
    }
}

struct Stressor: Codable, Identifiable, Sendable {
    let id: String
    let stressorName: String
    let signal: String
    let severity: String       // "watch" | "elevated" | "critical"
    let neutralizingAction: String
    let status: String

    enum CodingKeys: String, CodingKey {
        case id, signal, severity, status
        case stressorName = "stressor_name"
        case neutralizingAction = "neutralizing_action"
    }
}

struct Decision: Codable, Identifiable, Sendable {
    let id: String
    let productId: String
    let what: String
    let category: String
    let gate: Int
    let status: String
    let createdAt: Date?
    let deadline: Date?
    let decidedAt: Date?
    let chosenOption: String?
    let outcome: String?
    let options: [String]?
    let rationale: String?

    enum CodingKeys: String, CodingKey {
        case id, what, category, gate, status, deadline, outcome, options, rationale
        case productId = "product_id"
        case createdAt = "created_at"
        case decidedAt = "decided_at"
        case chosenOption = "chosen_option"
    }
}

struct VoiceBriefing: Codable, Sendable {
    let id: String
    let briefingText: String
    let signalScore: Int
    let riskState: String
    let focusItem: String?
    let keyMetrics: [BriefingMetric]?

    enum CodingKeys: String, CodingKey {
        case id
        case briefingText = "briefing_text"
        case signalScore = "signal_score"
        case riskState = "risk_state"
        case focusItem = "focus_item"
        case keyMetrics = "key_metrics"
    }
}

struct ConversationReply: Codable, Sendable {
    let messageId: String
    let content: String
    let dataPoints: [DataPoint]
    let intent: String

    struct DataPoint: Codable, Sendable {
        let label: String
        let value: String
    }

    enum CodingKeys: String, CodingKey {
        case content, intent
        case messageId = "message_id"
        case dataPoints = "data_points"
    }
}

struct DashboardData: Codable, Sendable {
    let signal: SignalResult
    let stressors: [Stressor]
    let pendingDecisions: [Decision]
    let mrr: MRRData?

    struct MRRData: Codable, Sendable {
        let total: Int
        let new: Int
        let churned: Int
        let healthRatio: Double?

        enum CodingKeys: String, CodingKey {
            case total, new, churned
            case healthRatio = "health_ratio"
        }
    }

    enum CodingKeys: String, CodingKey {
        case signal, stressors, mrr
        case pendingDecisions = "pending_decisions"
    }
}

// ─── API Client ───────────────────────────────────────────────────────────────

@MainActor
final class FoundryAPI: ObservableObject {
    static let shared = FoundryAPI()

    private let baseURL: String
    private var authToken: String?

    init(baseURL: String = ProcessInfo.processInfo.environment["FOUNDRY_API_URL"] ?? "https://api.foundry.app") {
        self.baseURL = baseURL
    }

    // ── Auth ──────────────────────────────────────────────────────────────────

    func setAuthToken(_ token: String) {
        self.authToken = token
        // Persist to Keychain
        KeychainHelper.save(key: "foundry_auth_token", value: token)
    }

    func loadStoredToken() {
        self.authToken = KeychainHelper.load(key: "foundry_auth_token")
    }

    func clearToken() {
        self.authToken = nil
        KeychainHelper.delete(key: "foundry_auth_token")
    }

    var isAuthenticated: Bool { authToken != nil }

    // ── Products ──────────────────────────────────────────────────────────────

    func getProducts() async throws -> [Product] {
        let response: ProductsResponse = try await get("/api/products")
        return response.products
    }

    private struct ProductsResponse: Codable {
        let products: [Product]
    }

    // ── Signal ────────────────────────────────────────────────────────────────

    func getSignal(productId: String) async throws -> SignalResult {
        let response: SignalResponse = try await get("/api/signal?product_id=\(productId)")
        return response.signal
    }

    private struct SignalResponse: Codable {
        let signal: SignalResult
    }

    // ── Dashboard (bundled for efficiency) ───────────────────────────────────

    func getDashboard(productId: String) async throws -> DashboardData {
        return try await get("/api/dashboard?product_id=\(productId)")
    }

    // ── Decisions ─────────────────────────────────────────────────────────────

    func getDecisions(productId: String) async throws -> [Decision] {
        let response: DecisionsResponse = try await get("/api/decisions?product_id=\(productId)")
        return response.decisions
    }

    func createDecision(productId: String, what: String, category: String, gate: Int) async throws -> Decision {
        return try await post("/api/decisions", body: [
            "product_id": productId,
            "what": what,
            "category": category,
            "gate": gate,
        ] as [String: Any])
    }

    func getDecisionVotes(decisionId: String) async throws -> [DecisionVoteItem] {
        let response: VotesResponse = try await get("/api/decisions/\(decisionId)/votes")
        return response.votes
    }

    func submitVote(decisionId: String, productId: String, vote: String, preferredOption: String?, rationale: String?) async throws {
        var body: [String: Any] = ["vote": vote, "product_id": productId]
        if let p = preferredOption { body["preferred_option"] = p }
        if let r = rationale { body["rationale"] = r }
        let _: EmptyResponse = try await post("/api/decisions/\(decisionId)/vote", body: body)
    }

    private struct DecisionsResponse: Codable {
        let decisions: [Decision]
    }

    private struct VotesResponse: Codable {
        let votes: [DecisionVoteItem]
    }

    // ── Voice Briefing ────────────────────────────────────────────────────────

    func getMorningBriefing(productId: String) async throws -> VoiceBriefing {
        return try await get("/api/voice/briefing?product_id=\(productId)")
    }

    func submitVoiceTranscript(productId: String, transcript: String) async throws -> VoiceTranscriptResult {
        return try await post("/api/voice/transcript", body: [
            "product_id": productId,
            "transcript": transcript,
        ])
    }

    // ── Ask Foundry / Threads ─────────────────────────────────────────────────

    func getThreads(productId: String) async throws -> [ConversationThread] {
        let response: ThreadsListResponse = try await get("/api/threads?product_id=\(productId)")
        return response.threads
    }

    func getThread(threadId: String) async throws -> ThreadDetail {
        return try await get("/api/threads/\(threadId)")
    }

    func createThread(productId: String, message: String) async throws -> (ConversationThread, ConversationReply) {
        let response: CreateThreadResponse = try await post("/api/threads", body: [
            "product_id": productId,
            "message": message,
        ])
        return (response.thread, response.reply)
    }

    func sendMessage(threadId: String, message: String) async throws -> ConversationReply {
        let response: MessageResponse = try await post("/api/threads/\(threadId)/messages", body: ["message": message])
        return response.reply
    }

    func archiveThread(threadId: String) async throws {
        let _: EmptyResponse = try await delete("/api/threads/\(threadId)")
    }

    private struct ThreadsListResponse: Codable {
        let threads: [ConversationThread]
    }

    private struct CreateThreadResponse: Codable {
        let thread: ConversationThread
        let reply: ConversationReply
    }

    private struct MessageResponse: Codable {
        let reply: ConversationReply
    }

    // ── Push Notifications ────────────────────────────────────────────────────

    func registerPushToken(_ deviceToken: Data, bundleId: String) async throws {
        let tokenHex = deviceToken.map { String(format: "%02x", $0) }.joined()
        let _: EmptyResponse = try await post("/api/push/register", body: [
            "apns_device_token": tokenHex,
            "apns_bundle_id": bundleId,
            "platform": "ios",
        ])
    }

    func updatePushPreferences(productId: String, prefs: NotificationPreferences) async throws {
        let _: EmptyResponse = try await post("/api/push/preferences", body: [
            "product_id": productId,
            "signal_red": prefs.signalRed,
            "signal_yellow": prefs.signalYellow,
            "new_decision": prefs.newDecision,
            "new_stressor": prefs.newStressor,
            "morning_briefing": prefs.morningBriefing,
            "alignment_drop": prefs.alignmentDrop,
        ] as [String: Any])
    }

    // ── Ping ──────────────────────────────────────────────────────────────────

    func ping() async throws -> Bool {
        let _: EmptyResponse = try await get("/api/ping")
        return true
    }

    private struct EmptyResponse: Codable {}

    // ── Network Layer ─────────────────────────────────────────────────────────

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let fmt2 = ISO8601DateFormatter()
        fmt2.formatOptions = [.withInternetDateTime]
        d.dateDecodingStrategy = .custom { decoder in
            let s = try decoder.singleValueContainer().decode(String.self)
            if let date = fmt.date(from: s) { return date }
            if let date = fmt2.date(from: s) { return date }
            return Date()
        }
        return d
    }()

    private var decoder: JSONDecoder { Self.decoder }

    private func get<T: Codable>(_ path: String) async throws -> T {
        guard let url = URL(string: baseURL + path) else {
            throw FoundryError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        addAuthHeaders(&request)

        let (data, response) = try await URLSession.shared.data(for: request)
        try validateResponse(response, data: data)

        return try decoder.decode(T.self, from: data)
    }

    private func delete<T: Codable>(_ path: String) async throws -> T {
        guard let url = URL(string: baseURL + path) else {
            throw FoundryError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        addAuthHeaders(&request)
        let (data, response) = try await URLSession.shared.data(for: request)
        try validateResponse(response, data: data)
        return try decoder.decode(T.self, from: data)
    }

    private func post<T: Codable>(_ path: String, body: [String: Any]) async throws -> T {
        guard let url = URL(string: baseURL + path) else {
            throw FoundryError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        addAuthHeaders(&request)
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        try validateResponse(response, data: data)

        return try decoder.decode(T.self, from: data)
    }

    private func addAuthHeaders(_ request: inout URLRequest) {
        if let token = authToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
    }

    private func validateResponse(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw FoundryError.invalidResponse
        }
        if http.statusCode == 401 {
            throw FoundryError.unauthorized
        }
        if http.statusCode >= 400 {
            let message = (try? JSONDecoder().decode([String: String].self, from: data))?["error"] ?? "Request failed"
            throw FoundryError.apiError(http.statusCode, message)
        }
    }
}

// ─── Error Types ──────────────────────────────────────────────────────────────

enum FoundryError: LocalizedError {
    case invalidURL
    case invalidResponse
    case unauthorized
    case apiError(Int, String)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid URL"
        case .invalidResponse: return "Invalid server response"
        case .unauthorized: return "Authentication required"
        case .apiError(let code, let msg): return "Error \(code): \(msg)"
        }
    }
}

// ─── Keychain Helper ──────────────────────────────────────────────────────────

enum KeychainHelper {
    static func save(key: String, value: String) {
        let data = value.data(using: .utf8)!
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
        ]
        SecItemDelete(query as CFDictionary)
        SecItemAdd(query as CFDictionary, nil)
    }

    static func load(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        SecItemCopyMatching(query as CFDictionary, &result)
        guard let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
