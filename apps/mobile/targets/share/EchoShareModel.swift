import AVFoundation
import Combine
import Foundation
import UIKit
import EkweAudioCodec

/// Mirrors `EKWE_SHARE_SIGNATURE` in the RN app (src/constants/share.ts).
/// The string is shared by both directions — Echo copies with it, and Studio
/// share-out sends with it — so it does not live in the Echo constants.
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
            let accessingPath = url.path

            // Duration gate on the ORIGINAL audio, before any decode work.
            // The C++ probe covers Ogg/WAV/MP3/FLAC; MP4/M4A fall back to
            // AVURLAsset's duration.
            let probed = EkweAudioCodecBridge.probeAudioDurationMs(accessingPath)
            let duration: Double
            if probed >= 0 {
                duration = Double(probed) / 1000.0
            } else {
                let asset = AVURLAsset(url: url)
                duration = CMTimeGetSeconds(asset.duration)
            }
            if duration.isFinite, duration > 0,
               Int64(duration * 1000) > EchoEnvironment.maxAudioDurationMs {
                step = .failed("This audio is longer than your plan allows.")
                return
            }

            let durationMs = Int64(duration * 1000)
            let isUnderWitCap = durationMs > 0 && durationMs <= EchoEnvironment.witVorbisMaxDurationMs

            // Output paths
            let opusURL = Self.temporaryURL(withExtension: "opus")
            let vorbisURL = Self.temporaryURL(withExtension: "ogg")

            var activeResult: [Any] = []
            var success = false
            var durationMs = 0
            var waveArr: [Double] = []
            var vorbisPathForUpload: String?

            if isUnderWitCap {
                // ≤ 296s: single decode, dual encode (Opus for playback, Vorbis for upload)
                let dualResult = await Task.detached(priority: .userInitiated) {
                    EkweAudioCodecBridge.transcodeToDualWithWaveform(
                        accessingPath,
                        opusOutputPath: opusURL.path,
                        vorbisOutputPath: vorbisURL.path,
                        maxAudioBytes: UInt(EchoEnvironment.maxAudioBytes))
                }.value
                let opusResult = dualResult[0] as! [Any]
                let vorbisResult = dualResult[1] as! [Any]
                let opusSuccess = (opusResult[0] as? NSNumber)?.boolValue ?? false
                let vorbisSuccess = (vorbisResult[0] as? NSNumber)?.boolValue ?? false

                if opusSuccess && vorbisSuccess {
                    success = true
                    durationMs = (opusResult[2] as? NSNumber)?.intValue ?? 0
                    waveArr = (opusResult[3] as? [NSNumber])?.map { $0.doubleValue } ?? []
                    vorbisPathForUpload = vorbisURL.path
                } else if let pcm = try? await Self.decodeToPcmFile(url: url) {
                    // C++ core can't read this container (MP3/FLAC/…): decode
                    // once through AVFoundation and fan out to both encoders.
                    let fallbacks = await Task.detached(priority: .userInitiated) {
                        (EkweAudioCodecBridge.encodePcmToOpus(
                            pcm.data, sampleRate: pcm.sampleRate,
                            channels: pcm.channels, outputPath: opusURL.path),
                         EkweAudioCodecBridge.encodePcmToVorbis(
                            pcm.data, sampleRate: pcm.sampleRate,
                            channels: pcm.channels, outputPath: vorbisURL.path))
                    }.value
                    let opusFallback = fallbacks.0
                    let vorbisFallback = fallbacks.1
                    let opusOk = (opusFallback[0] as? NSNumber)?.boolValue ?? false
                    let vorbisOk = (vorbisFallback[0] as? NSNumber)?.boolValue ?? false
                    if opusOk && vorbisOk {
                        success = true
                        durationMs = (opusFallback[2] as? NSNumber)?.intValue ?? 0
                        waveArr = (opusFallback[3] as? [NSNumber])?.map { $0.doubleValue } ?? []
                        vorbisPathForUpload = vorbisURL.path
                    }
                }
            } else {
                // > 296s or unknown duration: Opus only (Wit rejects Vorbis anyway)
                let opusResult = await Task.detached(priority: .userInitiated) {
                    EkweAudioCodecBridge.transcodeToOpusWithWaveform(accessingPath, outputPath: opusURL.path)
                }.value
                var activeResult = opusResult
                var success = (opusResult[0] as? NSNumber)?.boolValue ?? false
                if !success {
                    // AAC/M4A/AMR/3GP — fall back to AVAssetReader, then feed
                    // raw PCM into the shared C++ Opus encoder.
                    do {
                        let pcm = try await Self.decodeToPcmFile(url: url)
                        let fallback = await Task.detached(priority: .userInitiated) {
                            EkweAudioCodecBridge.encodePcmToOpus(
                                pcm.data,
                                sampleRate: pcm.sampleRate,
                                channels: pcm.channels,
                                outputPath: opusURL.path)
                        }.value
                        success = (fallback[0] as? NSNumber)?.boolValue ?? false
                        activeResult = fallback
                    } catch {
                        step = .failed(error.localizedDescription)
                        return
                    }
                }

                if !success {
                    let msg = activeResult[1] as? String ?? "Couldn't transcode this audio file."
                    step = .failed(msg)
                    return
                }

                durationMs = (activeResult[2] as? NSNumber)?.intValue ?? 0
                waveArr = (activeResult[3] as? [NSNumber])?.map { $0.doubleValue } ?? []
            }

            if !success {
                let msg = activeResult[1] as? String ?? "Couldn't transcode this audio file."
                step = .failed(msg)
                return
            }

            // AVPlayer has no Ogg support — encode an M4A copy for in-sheet preview.
            let m4aURL = Self.temporaryURL(withExtension: "m4a")
            let playback = await Task.detached(priority: .userInitiated) {
                EkweAudioCodecBridge.encodePlaybackCopyWithSourcePath(
                    url.path,
                    outputPath: m4aURL.path,
                    maxAudioBytes: UInt(EchoEnvironment.maxAudioBytes))
            }.value
            let didEncode = (playback[0] as? NSNumber)?.boolValue ?? false

            let player = AVPlayer(url: didEncode ? m4aURL : url)
            player.actionAtItemEnd = .pause
            self.player = player
            addEndOfPlaybackObserver(for: player)
            scheduleProgressTimer()

            // For upload: Vorbis when under Wit cap, Opus otherwise.
            // Playback always uses the M4A copy encoded above.
            sourceURL = URL(fileURLWithPath: vorbisPathForUpload ?? opusURL.path)
            fileName = url.lastPathComponent
            fileSizeText = EchoShareModel.fileByteCountString(from: url)
            self.duration = Double(max(durationMs, 0)) / 1000.0
            peaks = waveArr
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
            isPlaying = false
            return
        }
        activateAudioSession()
        player.rate = Float(rate)
        isPlaying = true
    }

    private func activateAudioSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try? session.setActive(true)
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
                accessToken: accessToken,
                durationMs: Int(duration * 1000)
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
            // iOS does not tell a share extension which app sent the item.
            sourceApp: nil,
            sourceLang: detectedLang.isEmpty ? selectedLang : detectedLang,
            targetLang: targetLang.isEmpty ? "en" : targetLang,
            transcript: transcriptText,
            translation: translation,
            transliteration: transliteration,
            duration: duration,
            provider: transcriptionProvider ?? "unknown",
            mtProvider: translation != nil ? translationProvider : nil
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

    // MARK: - Helpers

    private static func fileByteCount(from url: URL) -> Int64 {
        let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
        return (attrs?[.size] as? NSNumber)?.int64Value ?? 0
    }

    private static func temporaryURL(withExtension ext: String) -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("ekwe-\(UUID().uuidString)")
            .appendingPathExtension(ext)
    }

    private struct PcmSlice {
        let data: Data
        let sampleRate: Int
        let channels: Int
    }

    /// Decodes AAC/M4A/AMR/3GP containers the C++ decoder cannot parse into
    /// raw 16-bit interleaved PCM (mono, 16 kHz). Throws when the asset has
    /// no audio track or fails to decode.
    private static func decodeToPcmFile(url: URL) async throws -> PcmSlice {
        let asset = AVURLAsset(url: url)
        guard let track = asset.tracks(withMediaType: .audio).first else {
            throw NSError(
                domain: "EchoShareModel", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "No audio track in this file."])
        }
        let reader = try AVAssetReader(asset: asset)
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: 16_000,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsNonInterleavedKey: false,
        ])
        output.alwaysCopiesSampleData = false
        reader.add(output)
        guard reader.startReading() else {
            throw reader.error ?? NSError(
                domain: "EchoShareModel", code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Couldn't decode this audio file."])
        }
        var data = Data()
        while let sample = output.copyNextSampleBuffer() {
            defer { CMSampleBufferInvalidate(sample) }
            if let block = CMSampleBufferGetDataBuffer(sample) {
                var length = 0
                var ptr: UnsafeMutablePointer<Int8>?
                CMBlockBufferGetDataPointer(block, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &ptr)
                if let ptr, length > 0 {
                    data.append(ptr, count: length)
                }
            }
        }
        if reader.status == .failed {
            throw reader.error ?? NSError(
                domain: "EchoShareModel", code: 3,
                userInfo: [NSLocalizedDescriptionKey: "Couldn't decode this audio file."])
        }
        return PcmSlice(data: data, sampleRate: 16_000, channels: 1)
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