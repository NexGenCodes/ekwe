import Foundation

/// Persists completed share-sheet work into the shared App Group container so
/// the main app can import it into Ekwe History on next launch.
///
/// The native share extension has no JS runtime, so it can't call the app's
/// `HistoryService`/`op-sqlite` pipeline directly. Instead it appends pending
/// records to `shared-history.json` (a JSON array inside the same App Group
/// container the app already reads for `shared-session.json`). The app drains
/// this file in `importSharedEchoHistory()` and turns each record into a proper
/// local + cloud history entry, then deletes the file.
///
/// Record lifecycle mirrors the JS flow:
///   1. Transcribe succeeds → transcription-only record is written.
///   2. Translate succeeds  → the SAME `sessionKey` record is rewritten in place
///      with the translation (mirrors JS `sessionMap`), so the app upgrades
///      rather than creating a second entry.
/// A user who closes after transcription but before translation keeps the
/// transcription-only record, exactly like the in-app "Half Transaction".
@available(iOS 16.4, *)
struct EchoHistoryRecord: Codable {
    /// Stable id per share session; used to update the record in place when a
    /// translation lands for the same transcription. Doubles as the history
    /// layer's `capture_id`, so the app can fold the two writes into one row.
    let sessionKey: String
    /// The app the audio was shared from. iOS share extensions are not told
    /// which app sent the item, so this is usually nil — which is honest, and
    /// better than the "ios" sentinel it replaced, which every display path
    /// then had to special-case so it wasn't shown as if it were an app.
    let sourceApp: String?
    let sourceLang: String
    let targetLang: String
    let transcript: String
    let translation: String?
    let transliteration: String?
    let duration: Double
    let provider: String
    /// Which machine-translation provider ran, when one did. Distinct from
    /// `provider`, which is the speech-to-text provider that heard the audio.
    let mtProvider: String?
    let createdAt: String

    init(
        sessionKey: String,
        sourceApp: String? = nil,
        sourceLang: String,
        targetLang: String,
        transcript: String,
        translation: String?,
        transliteration: String? = nil,
        duration: Double,
        provider: String,
        mtProvider: String? = nil
    ) {
        self.sessionKey = sessionKey
        self.sourceApp = sourceApp
        self.sourceLang = sourceLang
        self.targetLang = targetLang
        self.transcript = transcript
        self.translation = translation
        self.transliteration = transliteration
        self.duration = duration
        self.provider = provider
        self.mtProvider = mtProvider
        self.createdAt = ISO8601DateFormatter().string(from: Date())
    }
}

@available(iOS 16.4, *)
final class EchoHistoryStore {

    private struct DecoderRecord: Codable {
        let sessionKey: String
        let sourceApp: String?
        let sourceLang: String
        let targetLang: String
        let transcript: String
        let translation: String?
        let transliteration: String?
        let duration: Double
        let provider: String
        let mtProvider: String?
        let createdAt: String

        init(_ record: EchoHistoryRecord) {
            sessionKey = record.sessionKey
            sourceApp = record.sourceApp
            sourceLang = record.sourceLang
            targetLang = record.targetLang
            transcript = record.transcript
            translation = record.translation
            transliteration = record.transliteration
            duration = record.duration
            provider = record.provider
            mtProvider = record.mtProvider
            createdAt = record.createdAt
        }
    }

    private var fileURL: URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: EchoEnvironment.appGroupID)?
            .appendingPathComponent("shared-history.json")
    }

    private func load() -> [DecoderRecord] {
        guard let fileURL,
              let data = try? Data(contentsOf: fileURL),
              let records = try? JSONDecoder().decode([DecoderRecord].self, from: data)
        else { return [] }
        return records
    }

    /// Appends a new record, or rewrites an existing record sharing the same
    /// `sessionKey` (when a translation upgrades a transcription-only entry).
    func save(_ record: EchoHistoryRecord) {
        guard let fileURL else { return }
        var records = load().filter { $0.sessionKey != record.sessionKey }
        records.append(DecoderRecord(record))
        if let data = try? JSONEncoder().encode(records) {
            try? data.write(to: fileURL, options: [.atomic, .completeUntilFirstUserAuthentication])
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try? fileURL.setResourceValues(values)
        }
    }
}