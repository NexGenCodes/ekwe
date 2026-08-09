import AVFoundation
import Combine
import Foundation
import UIKit

/// Mirrors `ECHO_SHARE_SIGNATURE` in the RN app (constants/echo.ts).
@available(iOS 16.4, *)
enum EchoSignature {
    static let value = "\n\n— Shared with Ekwe · Speak, we'll handle the rest"
}

/// A language card shown in the "Pick Original Language" grid.
@available(iOS 16.4, *)
struct EchoPickLanguage: Identifiable {
    let code: String
    let name: String
    let flag: String

    var id: String { code }
}

/// State + engine for the fully-native "Ekwe Echo" share sheet.
///
/// This now runs the ENTIRE echo flow natively (no JS runtime, no handoff to a
/// deep link): the audio is decoded and previewed with AVAudio, then uploaded
/// to the Cloudflare Worker for transcription and optional translation. All
/// authenticated with the Supabase session restored from the shared App Group
/// container.
///
///   PickLanguage → Preview → Transcribing → TranscriptResult
///               → Translating → FullResult → close
@available(iOS 16.4, *)
@MainActor
final class EchoShareModel: NSObject, ObservableObject {

    enum Step: Equatable {
        case idle
        case loadingSession
        case signedOut
        case pickingLanguage
        case preview
        case transcribing
        case transcriptionReady
        case translating
        case resultReady
        case failed(String)
    }

    enum TranscribePhase: Equatable {
        case none
        case uploading
        case processing
    }

    // MARK: - Published state

    @Published private(set) var step: Step = .idle
    @Published private(set) var sourceURL: URL?
    @Published private(set) var fileName: String = ""
    @Published private(set) var fileSizeText: String = ""
    @Published private(set) var duration: Double = 0
    @Published private(set) var peaks: [Double] = []

    @Published private(set) var selectedLang: String = "en"
    @Published private(set) var detectedLang: String = ""
    @Published private(set) var targetLang: String = ""

    @Published private(set) var transcriptText: String = ""
    @Published private(set) var transcriptionProvider: String?
    @Published private(set) var transcriptWords: [EchoWorkerClient.Transcript.Word] = []
    @Published private(set) var translationText: String = ""
    @Published private(set) var translationProvider: String?

    @Published private(set) var transcribePhase: TranscribePhase = .none
    @Published private(set) var uploadProgress: Double = 0
    @Published private(set) var didAutoCopy = false

    @Published private(set) var isPlaying = false
    @Published private(set) var progress: Double = 0
    @Published private(set) var rate: Double = 1

    /// Whether the signed-in user's tier allows auto language detection
    /// (mirrored from the app's is_pro flag). Free users see a locked card.
    @Published private(set) var autoDetectAllowed = false

    // MARK: - Dependencies

    private let sessionStore = EchoSessionStore()
    private let worker = EchoWorkerClient()
    private let preferences = EchoUserPreferences()
    private let historyStore = EchoHistoryStore()
    private var player: AVPlayer?
    private var endOfPlaybackObserver: NSObjectProtocol?
    private var progressTimer: Any?

    private let bucketCount = 40
    private var isCancelled = false

    /// Stable identity for a single share session, used as the `sessionKey` so
    /// the transcription and any later translation import as two separate
    /// history entries rather than one combined row.
    private let sessionKey = UUID().uuidString

    /// What `retryOperation()` should re-run after a failure.
    private var lastOperation: LastOperation = .none

    enum LastOperation {
        case none
        case transcribe
        case translate
    }

    // MARK: - Lifecycle

    /// Restores the shared session and (when present) the user's mirrored prefs.
    /// Returns false when the user isn't signed in.
    func start() async -> Bool {
        step = .loadingSession
        autoDetectAllowed = preferences.autoDetectAllowed
        let token = await sessionStore.accessToken()
        if token == nil {
            step = .signedOut
            return false
        }
        return true
    }

    func userLanguages() -> [EchoPickLanguage] {
        let stored = preferences.languages
        let codes = stored.isEmpty ? ["en", "es", "it", "de", "zh"] : stored
        var result: [EchoPickLanguage] = []
        for code in codes.prefix(5) {
            if let lang = EchoLanguages.find(code) {
                result.append(
                    EchoPickLanguage(code: lang.code, name: lang.englishName, flag: lang.flag)
                )
            }
        }
        if result.isEmpty {
            for code in ["en", "es", "it", "de", "zh"] {
                if let lang = EchoLanguages.find(code) {
                    result.append(
                        EchoPickLanguage(code: lang.code, name: lang.englishName, flag: lang.flag)
                    )
                }
            }
        }
        return result
    }

    // MARK: - File preparation

    /// Decodes and analyzes the shared audio, then goes to the language picker.
    func loadAudio(from url: URL) async {
        let accessing = url.startAccessingSecurityScopedResource()
        defer {
            if accessing { url.stopAccessingSecurityScopedResource() }
        }

        do {
            let (fileDuration, waveform) = try EchoShareModel.analyze(from: url, buckets: bucketCount)

            // AVPlayer streams from disk instead of buffering the decoded PCM
            // in memory the way AVAudioPlayer does — important inside a share
            // extension, where the Jetsam limit is a few tens of MB.
            let player = AVPlayer(url: url)
            player.actionAtItemEnd = .pause
            self.player = player
            addEndOfPlaybackObserver(for: player)
            scheduleProgressTimer()

            sourceURL = url
            fileName = url.lastPathComponent
            fileSizeText = EchoShareModel.fileByteCountString(from: url)
            duration = fileDuration
            peaks = waveform
            step = .pickingLanguage
        } catch {
            step = .failed("Couldn't open this audio file.")
        }
    }

    // MARK: - Language + preview

    func selectLanguage(_ code: String) {
        selectedLang = code
        detectedLang = ""
        targetLang = ""
        step = .preview
    }

    func changeLanguage() {
        step = .pickingLanguage
    }

    /// Copies the transcript (with brand signature), then flips `didAutoCopy`
    /// so the button shows a check briefly.
    func copyTranscript() {
        guard !transcriptText.isEmpty else { return }
        UIPasteboard.general.string = transcriptText + EchoSignature.value
        didAutoCopy = true
    }

    func copyTranslation() {
        guard !translationText.isEmpty else { return }
        UIPasteboard.general.string = translationText + EchoSignature.value
        didAutoCopy = true
    }

    func resetCopied() {
        didAutoCopy = false
    }

    // MARK: - Playback

    func togglePlay() {
        guard let player else { return }
        if isPlaying {
            player.pause()
        } else {
            player.rate = Float(rate)
        }
        isPlaying = player.timeControlStatus == .playing
    }

    func cycleRate() {
        let next = rate < 1.5 ? 1.5 : (rate < 2 ? 2 : 1)
        rate = next
        if isPlaying {
            player?.rate = Float(next)
        }
    }

    func seek(to fraction: Double) {
        guard let player, let duration = player.currentItem?.duration.seconds, duration > 0 else { return }
        let clamped = max(0, min(1, fraction))
        let time = CMTime(seconds: duration * clamped, preferredTimescale: 600)
        player.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero)
        progress = clamped
    }

    private func addEndOfPlaybackObserver(for player: AVPlayer) {
        endOfPlaybackObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: player.currentItem,
            queue: .main
        ) { [weak self] _ in
            self?.progress = 1
            self?.isPlaying = false
        }
    }

    private func scheduleProgressTimer() {
        progressTimer?.cancel()
        let cancellable = Timer.publish(every: 0.1, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                guard let self = self else { return }
                guard let player = self.player else { return }
                let duration = player.currentItem?.duration.seconds ?? 0
                if duration > 0 {
                    self.progress = player.currentTime().seconds / duration
                }
                if self.isPlaying, player.timeControlStatus != .playing {
                    self.isPlaying = false
                }
            }
        progressTimer = cancellable
    }

    // MARK: - Transcription

    func cancelActivity() {
        isCancelled = true
        worker.cancel()
        stopPlayer()
        step = .preview
    }

    func setTargetLanguage(_ code: String) {
        targetLang = code
    }

    func transcribe() async {
        guard let sourceURL else {
            step = .failed("No audio file to transcribe.")
            return
        }
        guard let accessToken = await sessionStore.accessToken() else {
            step = .failed("You need to sign in to transcribe.")
            return
        }

        isCancelled = false
        lastOperation = .transcribe
        transcribePhase = .uploading
        uploadProgress = 0
        step = .transcribing

        do {
            let transcript = try await worker.transcribe(
                fileURL: sourceURL,
                lang: selectedLang,
                accessToken: accessToken
            ) { [weak self] fraction in
                Task { @MainActor in
                    guard let self else { return }
                    self.uploadProgress = Double(fraction)
                    if fraction >= 1, self.transcribePhase == .uploading {
                        self.transcribePhase = .processing
                    }
                }
            }

            if isCancelled { step = .preview; return }

            transcriptText = transcript.text
            transcriptionProvider = transcript.provider
            transcriptWords = transcript.words ?? []
            detectedLang = transcript.language ?? ""
            transcribePhase = .none
            step = .transcriptionReady

            // Persist a transcription-only record now; a later translate() writes
            // a separate translation record under the same sessionKey.
            writeHistoryRecord(translation: nil, transliteration: nil)
        } catch {
            if isCancelled { step = .preview; return }
            transcribePhase = .none
            step = .failed(workerMessage(for: error))
        }
    }

    // MARK: - Translation

    func translate() async {
        guard !transcriptText.isEmpty else {
            step = .failed("There's nothing to translate yet.")
            return
        }
        guard let accessToken = await sessionStore.accessToken() else {
            step = .signedOut
            return
        }

        isCancelled = false
        lastOperation = .translate
        step = .translating

        do {
            let sourceLang: String? = (selectedLang == "auto") ? nil : selectedLang
            let translation = try await worker.translate(
                text: transcriptText,
                sourceLang: sourceLang,
                targetLang: targetLang,
                accessToken: accessToken
            )

            if isCancelled { step = .transcriptionReady; return }

            translationText = translation.resultText
            translationProvider = translation.provider

            writeHistoryRecord(translation: translationText)

            if preferences.autoCopy && !translationText.isEmpty {
                UIPasteboard.general.string = translationText + EchoSignature.value
                didAutoCopy = true
            }

            step = .resultReady
        } catch {
            if isCancelled { step = .transcriptionReady; return }
            step = .failed(workerMessage(for: error))
        }
    }

    // MARK: - Retry / nav

    /// Re-runs the last failed operation (matches `retryOperation`).
    func retryOperation() async {
        switch lastOperation {
        case .transcribe:
            await transcribe()
        case .translate:
            setTargetLanguage(targetLang)
            await translate()
        case .none:
            step = .pickingLanguage
        }
    }

    func backToTranscription() {
        if step == .resultReady { step = .transcriptionReady }
    }

    func fail(_ message: String) {
        step = .failed(message)
    }

    func finish() {
        stopPlayer()
    }

    func stopPlayer() {
        player?.pause()
        isPlaying = false
        progress = 0
    }

    /// Persists the current share session into the shared history file. Called
    /// after transcription (translation nil) and again after translation
    /// (rewrites the same record in place via `sessionKey`).
    func writeHistoryRecord(translation: String?, transliteration: String? = nil) {
        guard !transcriptText.isEmpty else { return }
        let record = EchoHistoryRecord(
            sessionKey: sessionKey,
            sourceLang: detectedLang.isEmpty ? selectedLang : detectedLang,
            targetLang: targetLang.isEmpty ? "en" : targetLang,
            transcript: transcriptText,
            translation: translation,
            transliteration: transliteration,
            duration: duration,
            sourceApp: "ios",
            provider: transcriptionProvider ?? "unknown"
        )
        historyStore.save(record)
    }

    // MARK: - Helpers

    func formattedTime(_ seconds: Double) -> String {
        let total = max(Int(seconds.rounded(.down)), 0)
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    private func workerMessage(for error: Error) -> String {
        if let worker = error as? EchoWorkerClient.WorkerError {
            return worker.localizedDescription
        }
        return "Something went wrong. Please try again."
    }

    // MARK: - Static analysis

    private static func analyze(from url: URL, buckets: Int) throws -> (duration: Double, peaks: [Double]) {
        let file = try AVAudioFile(forReading: url)
        let format = file.processingFormat
        let totalFrames = AVAudioFrameCount(file.length)
        guard totalFrames > 0 else { throw EchoWorkerClient.WorkerError.decodeFailed }

        let channels = min(Int(format.channelCount), 2)
        var peaks = Array(repeating: Float(0), count: buckets)
        var maxPeak: Float = 0

        let capacity = AVAudioFrameCount(min(4096, totalFrames))
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else {
            throw EchoWorkerClient.WorkerError.decodeFailed
        }

        var framesRead: AVAudioFrameCount = 0
        while framesRead < totalFrames {
            let readCount = min(capacity, totalFrames - framesRead)
            try file.read(into: buffer, frameCount: readCount)
            let frames = Int(buffer.frameLength)
            guard frames > 0, let channelData = buffer.floatChannelData else { break }

            for frame in 0..<frames {
                let bucketIndex = Int(Double(framesRead + AVAudioFrameCount(frame)) / Double(totalFrames) * Double(buckets))
                let bucket = min(buckets - 1, bucketIndex)
                var peak: Float = 0
                for channel in 0..<channels {
                    let magnitude = abs(channelData[channel][frame])
                    if magnitude > peak { peak = magnitude }
                }
                if peak > peaks[bucket] { peaks[bucket] = peak }
                if peak > maxPeak { maxPeak = peak }
            }
            framesRead += AVAudioFrameCount(frames)
        }

        let fileDuration = Double(file.length) / format.sampleRate
        guard maxPeak > 0 else { return (fileDuration, Array(repeating: 0, count: buckets)) }
        return (fileDuration, peaks.map { Double($0 / maxPeak) })
    }

    private static func fileByteCount(from url: URL) -> Int64 {
        let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
        return (attrs?[.size] as? NSNumber)?.int64Value ?? 0
    }

    private static func fileByteCountString(from url: URL) -> String {
        let size = fileByteCount(from: url)
        if size >= 1_048_576 {
            return String(format: "%.1f MB", Double(size) / 1_048_576)
        }
        let kilobytes = max(Int64(1), (size + 511) / 1024)
        return String(format: "%d KB", kilobytes)
    }

    deinit {
        if let endOfPlaybackObserver {
            NotificationCenter.default.removeObserver(endOfPlaybackObserver)
        }
        progressTimer?.cancel()
        player?.pause()
    }
}