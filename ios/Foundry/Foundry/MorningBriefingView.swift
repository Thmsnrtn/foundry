// =============================================================================
// FOUNDRY iOS — Morning Briefing
// AI-generated spoken briefing with AVSpeechSynthesizer + transcript logging.
// =============================================================================

import SwiftUI
import AVFoundation

struct MorningBriefingView: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var api: FoundryAPI

    @State private var briefing: VoiceBriefing?
    @State private var isLoading = false
    @State private var isPlaying = false
    @State private var isPaused = false
    @State private var transcript = ""
    @State private var isSubmittingTranscript = false
    @State private var showTranscriptInput = false
    @State private var error: String?

    @StateObject private var speechDelegate = SpeechDelegate()

    private let synthesizer = AVSpeechSynthesizer()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    if isLoading {
                        BriefingLoadingView()
                    } else if let briefing {
                        briefingContent(briefing)
                    } else {
                        BriefingEmptyView {
                            Task { await generateBriefing() }
                        }
                    }

                    if let error {
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.red)
                            .multilineTextAlignment(.center)
                    }
                }
                .padding(16)
            }
            .navigationTitle("Morning Briefing")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                if briefing != nil {
                    ToolbarItem(placement: .navigationBarTrailing) {
                        Button {
                            Task { await generateBriefing() }
                        } label: {
                            Image(systemName: "arrow.clockwise")
                        }
                        .disabled(isLoading)
                    }
                }
            }
            .onDisappear {
                stopPlayback()
            }
        }
        .task {
            if appState.selectedProductId != nil {
                await generateBriefing()
            }
        }
        .onChange(of: appState.selectedProductId) { _, _ in
            briefing = nil
            Task { await generateBriefing() }
        }
    }

    @ViewBuilder
    private func briefingContent(_ briefing: VoiceBriefing) -> some View {
        // Signal Badge
        HStack {
            Spacer()
            VStack(spacing: 4) {
                Text("\(briefing.signalScore)")
                    .font(.system(size: 56, weight: .bold, design: .rounded))
                    .foregroundColor(riskColor(briefing.riskState))
                Text("Signal Score")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            Spacer()
        }
        .padding(20)
        .background(riskColor(briefing.riskState).opacity(0.08))
        .cornerRadius(16)

        // Playback card
        VStack(spacing: 16) {
            Text("Today's Briefing")
                .font(.headline)
                .foregroundColor(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)

            Text(briefing.briefingText)
                .font(.callout)
                .lineSpacing(6)
                .foregroundColor(.primary)

            // Playback controls
            HStack(spacing: 24) {
                Spacer()

                Button {
                    restartPlayback(text: briefing.briefingText)
                } label: {
                    Image(systemName: "backward.fill")
                        .font(.title2)
                        .foregroundColor(.secondary)
                }

                Button {
                    if isPlaying {
                        pausePlayback()
                    } else if isPaused {
                        resumePlayback()
                    } else {
                        startPlayback(text: briefing.briefingText)
                    }
                } label: {
                    Image(systemName: isPlaying ? "pause.circle.fill" : "play.circle.fill")
                        .font(.system(size: 52))
                        .foregroundColor(.blue)
                }

                Button {
                    stopPlayback()
                } label: {
                    Image(systemName: "stop.fill")
                        .font(.title2)
                        .foregroundColor(.secondary)
                }
                .disabled(!isPlaying && !isPaused)

                Spacer()
            }
            .padding(.vertical, 4)
        }
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground))
        .cornerRadius(16)

        // Key metrics
        if let metrics = briefing.keyMetrics, !metrics.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Text("Key Numbers")
                    .font(.headline)
                    .foregroundColor(.secondary)

                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    ForEach(metrics, id: \.label) { metric in
                        BriefingMetricTile(metric: metric)
                    }
                }
            }
            .padding(16)
            .background(Color(.secondarySystemGroupedBackground))
            .cornerRadius(16)
        }

        // Focus item
        if let focus = briefing.focusItem {
            VStack(alignment: .leading, spacing: 8) {
                Label("Today's Focus", systemImage: "target")
                    .font(.headline)
                    .foregroundColor(.orange)
                Text(focus)
                    .font(.callout)
                    .foregroundColor(.primary)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.orange.opacity(0.08))
            .cornerRadius(16)

        }

        // Voice transcript input
        VStack(alignment: .leading, spacing: 12) {
            Button {
                withAnimation { showTranscriptInput.toggle() }
            } label: {
                HStack {
                    Label("Log a voice update", systemImage: "mic.fill")
                        .font(.callout.bold())
                        .foregroundColor(.primary)
                    Spacer()
                    Image(systemName: showTranscriptInput ? "chevron.up" : "chevron.down")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            if showTranscriptInput {
                TextField("Type or paste your update...", text: $transcript, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(3...6)
                    .padding(12)
                    .background(Color(.tertiarySystemGroupedBackground))
                    .cornerRadius(8)

                Button {
                    Task { await submitTranscript() }
                } label: {
                    if isSubmittingTranscript {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                    } else {
                        Text("Process Update")
                            .font(.callout.bold())
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(transcript.trimmingCharacters(in: .whitespaces).isEmpty || isSubmittingTranscript)
            }
        }
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground))
        .cornerRadius(16)
    }

    // ─── Playback ─────────────────────────────────────────────────────────────

    private func startPlayback(text: String) {
        configureAudioSession()
        let utterance = makeUtterance(text: text)
        synthesizer.delegate = speechDelegate
        speechDelegate.onFinish = {
            isPlaying = false
            isPaused = false
        }
        synthesizer.speak(utterance)
        isPlaying = true
        isPaused = false
    }

    private func pausePlayback() {
        synthesizer.pauseSpeaking(at: .word)
        isPlaying = false
        isPaused = true
    }

    private func resumePlayback() {
        synthesizer.continueSpeaking()
        isPlaying = true
        isPaused = false
    }

    private func stopPlayback() {
        synthesizer.stopSpeaking(at: .word)
        isPlaying = false
        isPaused = false
    }

    private func restartPlayback(text: String) {
        stopPlayback()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            startPlayback(text: text)
        }
    }

    private func makeUtterance(text: String) -> AVSpeechUtterance {
        let utterance = AVSpeechUtterance(string: text)
        utterance.rate = 0.52
        utterance.pitchMultiplier = 1.0
        utterance.volume = 1.0
        utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        return utterance
    }

    private func configureAudioSession() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: .duckOthers)
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    // ─── Data ─────────────────────────────────────────────────────────────────

    private func generateBriefing() async {
        guard let productId = appState.selectedProductId else { return }
        isLoading = true
        error = nil
        stopPlayback()
        do {
            briefing = try await api.getMorningBriefing(productId: productId)
        } catch {
            self.error = "Could not generate briefing. Try again."
        }
        isLoading = false
    }

    private func submitTranscript() async {
        guard let productId = appState.selectedProductId else { return }
        let text = transcript.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        isSubmittingTranscript = true
        if (try? await api.submitVoiceTranscript(productId: productId, transcript: text)) != nil {
            transcript = ""
            showTranscriptInput = false
        }
        isSubmittingTranscript = false
    }

    private func riskColor(_ state: String) -> Color {
        switch state {
        case "red": return .red
        case "yellow": return .orange
        default: return Color(hex: "#30D158")
        }
    }
}

// ─── Speech Delegate ──────────────────────────────────────────────────────────

final class SpeechDelegate: NSObject, AVSpeechSynthesizerDelegate, ObservableObject {
    var onFinish: (() -> Void)?

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        DispatchQueue.main.async { self.onFinish?() }
    }
}

// ─── Supporting Views ─────────────────────────────────────────────────────────

struct BriefingLoadingView: View {
    @State private var dots = 0
    let timer = Timer.publish(every: 0.5, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "waveform")
                .font(.system(size: 48))
                .foregroundColor(.blue.opacity(0.6))
                .symbolEffect(.variableColor)
            Text("Generating your briefing\(String(repeating: ".", count: dots))")
                .font(.headline)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.vertical, 60)
        .onReceive(timer) { _ in dots = (dots + 1) % 4 }
    }
}

struct BriefingEmptyView: View {
    let onGenerate: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "sun.horizon")
                .font(.system(size: 56))
                .foregroundColor(.orange.opacity(0.6))
            Text("No briefing yet")
                .font(.title3.bold())
            Text("Get a 60-second spoken summary of your business health, focus item, and key metrics.")
                .font(.callout)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
            Button("Generate Briefing", action: onGenerate)
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.vertical, 60)
    }
}

struct BriefingMetricTile: View {
    let metric: BriefingMetric

    var body: some View {
        VStack(spacing: 4) {
            Text(metric.value)
                .font(.title3.bold())
                .foregroundColor(.primary)
            Text(metric.label)
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(12)
        .background(Color(.tertiarySystemGroupedBackground))
        .cornerRadius(10)
    }
}

// ─── API Models ───────────────────────────────────────────────────────────────

struct BriefingMetric: Codable {
    let label: String
    let value: String
}

struct VoiceTranscriptResult: Codable {
    let actionsCreated: [String]
    let summary: String

    enum CodingKeys: String, CodingKey {
        case actionsCreated = "actions_created"
        case summary
    }
}
