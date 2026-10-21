import ExpoModulesCore
import AVFoundation
import UIKit

public class EkweNativeModule: Module {
  private var audioEngine: AVAudioEngine?
  private var isAudioRecording = false
  private var recordingStartTime: Date?
  private var outputPath: String = ""

  /// Serial, non-real-time queue for feeding PCM into the C++ capture controller.
  /// Keeps Opus encoding + Ogg writes off the audio render thread, and preserves
  /// feed order so the staging buffer sees samples monotonically.
  private let audioQueue = DispatchQueue(label: "com.ekwe.app.audio.capture")

  /// Outcome of a share-path size guard, so callers can distinguish a genuine
  /// "over the cap" rejection (terminal FILE_TOO_LARGE) from an unreadable or
  /// missing file (generic failure) instead of mislabeling every stat error.
  private enum SourcePathOutcome {
    case ok(String)
    case tooLarge
    case invalid
  }

  /// Resolves a share file:// path (stripping scheme) and rejects inputs over
  /// the size cap before any decode work begins.
  private func guardedSourcePath(_ path: String, maxAudioBytes: Int) -> SourcePathOutcome {
    let plainPath = path.hasPrefix("file://") ? String(path.dropFirst("file://".count)) : path
    let url = URL(fileURLWithPath: plainPath)
    // The authoritative limit is PREMIUM_LIMITS.maxAudioBytes in
    // @ekwe/shared/plans, passed in per call; this is a fallback for a caller
    // that omits it.
    let limit = maxAudioBytes > 0 ? maxAudioBytes : 10_485_760
    guard
      let values = try? url.resourceValues(forKeys: [.fileSizeKey]),
      let size = values.fileSize
    else {
      return .invalid
    }
    guard size <= limit else { return .tooLarge }
    return .ok(plainPath)
  }

  /// The view controller a share sheet should be presented from: the key
  /// window's root, plus anything it has already presented. Presenting from a
  /// controller that is mid-presentation fails, and `UIActivityViewController`
  /// refuses to appear over another sheet.
  private static func topViewController() -> UIViewController? {
    let keyWindow = UIApplication.shared.connectedScenes
      .compactMap { ($0 as? UIWindowScene)?.keyWindow }
      .first
    var top = keyWindow?.rootViewController
    while let presented = top?.presentedViewController {
      top = presented
    }
    return top
  }

  public func definition() -> ModuleDefinition {
    Name("EkweNative")

    // ------------------------------------
    // Audio Effects — iOS stubs
    // ------------------------------------

    AsyncFunction("attachEffects") { (_: Double) -> [String: Bool] in
      return [
        "noiseSuppressor": false,
        "echoCanceler": false,
        "gainControl": false
      ]
    }

    AsyncFunction("releaseEffects") { () in
    }

    // ------------------------------------
    // System
    // ------------------------------------
    // Authoritative resolved device theme, mirroring Android's `getSystemTheme`
    // so the JS contract is honest on both platforms. UI traits must be read on
    // the main thread, so unlike Android's synchronous implementation this runs
    // async there and resolves against the active window (falling back to the
    // current trait environment). Returns "light" | "dark".
    AsyncFunction("getSystemTheme") { () -> String in
      let style = UIApplication.shared.connectedScenes
        .compactMap { ($0 as? UIWindowScene)?.keyWindow }
        .first?.traitCollection.userInterfaceStyle
        ?? UITraitCollection.current.userInterfaceStyle
      return style == .dark ? "dark" : "light"
    }.runOnQueue(.main)

    // Who installed Ekwe. On iOS there is no installer concept — the binary can
    // only reach the device through the App Store or TestFlight, never a direct
    // sideload — so the honest answer is always "store". This keeps the JS
    // channel resolver platform-symmetric (no Platform.OS branch needed) and
    // means the "New version" update badge simply never appears on iOS; the
    // day we publish the Android binary to a store, this same code hides it
    // there too, with zero JS changes.
    AsyncFunction("getInstallerSource") { () -> String in
      "store"
    }

    // Decodes the source once and fans out to the Opus artifact plus an optional
    // Vorbis copy.
    AsyncFunction("resolveAudio") { (inputPath: String, options: [String: Any]) -> [String: Any] in
      let opusOutputPath = options["opusOutputPath"] as? String ?? ""
      let vorbisOutputPath = options["vorbisOutputPath"] as? String ?? ""
      let maxAudioBytes = (options["maxAudioBytes"] as? NSNumber)?.intValue ?? 0

      switch self.guardedSourcePath(inputPath, maxAudioBytes: maxAudioBytes) {
      case .tooLarge:
        return [
          "success": false, "error": "FILE_TOO_LARGE", "durationMs": 0,
          "waveform": [] as [Float], "vorbisSuccess": false,
        ]
      case .invalid:
        return [
          "success": false, "error": "INVALID_INPUT_FILE", "durationMs": 0,
          "waveform": [] as [Float], "vorbisSuccess": false,
        ]
      case .ok(let sourcePath):
        let result = EkweAudioBridge.resolveAudio(sourcePath, options: [
          "opusOutputPath": opusOutputPath,
          "vorbisOutputPath": vorbisOutputPath,
          "maxAudioBytes": maxAudioBytes,
        ])
        return [
          "success": result["success"] as? Bool ?? false,
          "error": result["error"] as? String ?? "",
          "durationMs": result["durationMs"] as? Int ?? 0,
          "waveform": result["waveform"] as? [Float] ?? [],
          "vorbisSuccess": result["vorbisSuccess"] as? Bool ?? false,
        ]
      }
    }

    // Decodes the source and writes an M4A/AAC-LC playback copy. Ogg sources go
    // Ogg → WAV bridge → M4A; platform-readable sources decode straight to M4A.
    AsyncFunction("createPlaybackCopy") { (inputPath: String, outputPath: String, maxAudioBytes: Int) -> Bool in
      switch self.guardedSourcePath(inputPath, maxAudioBytes: maxAudioBytes) {
      case .ok(let sourcePath):
        return EkweAudioBridge.createPlaybackCopyWithSourcePath(
          sourcePath, outputPath: outputPath, maxAudioBytes: UInt(max(0, maxAudioBytes)))
      default:
        return false
      }
    }

    AsyncFunction("probeAudioDurationMs") { (inputPath: String) -> Int in
      EkweAudioBridge.probeAudioDurationMs(inputPath)
    }

    // Decodes any audio file to a standalone WAV (see cpp::decode_audio_to_wav).
    // AVPlayer/expo-audio has no Ogg Opus support, so recorded Opus must be
    // decoded to WAV before playback on iOS.
    AsyncFunction("decodeAudioToWav") { (inputPath: String, outputPath: String, maxAudioBytes: Int) -> [String: Any] in
      switch self.guardedSourcePath(inputPath, maxAudioBytes: maxAudioBytes) {
      case .tooLarge:
        return [
          "success": false,
          "error": "FILE_TOO_LARGE",
          "durationMs": 0,
          "waveform": [] as [Float],
        ]
      case .invalid:
        return [
          "success": false,
          "error": "INVALID_INPUT_FILE",
          "durationMs": 0,
          "waveform": [] as [Float],
        ]
      case .ok(let sourcePath):
        let result = EkweAudioBridge.decodeToWavWithSourcePath(sourcePath, outputPath: outputPath, maxAudioBytes: UInt(max(0, maxAudioBytes)))
        return [
          "success": result[0] as! Bool,
          "error": result[1] as! String,
          "durationMs": result[2] as! Int,
          "waveform": result[3] as! [Float],
        ]
      }
    }

    // ------------------------------------
    // Voice Session — iOS voice processing
    // ------------------------------------
    AsyncFunction("configureVoiceSession") { () in
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.playAndRecord,
                              mode: .voiceChat,
                              options: [.allowBluetooth, .defaultToSpeaker])
      try session.setPreferredIOBufferDuration(0.005)
      try session.setActive(true)
    }

    // ------------------------------------
    // AudioRecord — iOS native AVAudioEngine capture (dual-path)
    // ------------------------------------
    AsyncFunction("startAudioRecording") { (path: String, sampleRate: Int, isLive: Bool) -> [String: Any] in
      if self.isAudioRecording {
        return ["success": false, "error": "Already recording"]
      }

      self.outputPath = path

       do {
         let session = AVAudioSession.sharedInstance()
         try session.setCategory(.playAndRecord,
                                 mode: .voiceChat,
                                 options: [.allowBluetooth, .defaultToSpeaker])
         try session.setPreferredIOBufferDuration(0.005)
         try session.setActive(true)

         let engine = AVAudioEngine()
         let inputNode = engine.inputNode

         // Tap in 16 kHz mono Float32. Installing the tap with this format makes
         // AVAudioEngine perform the sample-rate conversion + channel downmix from
         // the microphone's native format (~48 kHz). The C++ capture pipeline is
         // hard-wired for 16 kHz mono, so feeding it the unconverted hardware
         // format would record 3× too-fast audio and corrupt durations.
         let desiredFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                           sampleRate: 16_000,
                                           channels: 1,
                                           interleaved: false)!

         // Initialize C++ capture controller through bridge.
         // Pass nil for legacy Expo event blocks since we use Nitro now.
         let captureOk = EkweAudioBridge.initCapture(path,
                                                      sampleRate: Int32(sampleRate),
                                                      channels: 1,
                                                      isLive: isLive,
                                                      opusPacketBlock: nil,
                                                      vadSilenceBlock: nil)
         if !captureOk {
           return ["success": false, "error": "Failed to init capture"]
         }

         inputNode.installTap(onBus: 0,
                              bufferSize: 320,
                              format: desiredFormat) { [weak self] buffer, _ in
           guard let channelData = buffer.floatChannelData else { return }
           let frameLength = Int(buffer.frameLength)
           
           // Defensive copy of the float samples into a stable array. The C++ 
           // side does not own the AVAudioPCMBuffer memory, and the engine 
           // may overwrite it before the async queue processes it.
           let floatBuffer = Array(UnsafeBufferPointer(start: channelData[0], count: frameLength))
           
           // Encode off the render thread; feed order is preserved by the serial queue.
           // The controller handles clamping and float-to-int conversion in one fast C++ pass.
           self?.audioQueue.async {
             floatBuffer.withUnsafeBufferPointer { ptr in
               if let base = ptr.baseAddress {
                 EkweAudioBridge.feedPcmFloat(UnsafeMutablePointer(mutating: base),
                                              numSamples: Int32(frameLength))
               }
             }
           }
         }

         engine.prepare()
         try engine.start()
         self.audioEngine = engine
         self.isAudioRecording = true
         self.recordingStartTime = Date()

         return ["success": true, "error": ""]
       } catch {
         // Roll back capture + session so a failed start leaves no dangling
         // tap/engine/capture-controller (previously this leaked the C++ capture).
         if let engine = self.audioEngine {
           engine.inputNode.removeTap(onBus: 0)
           engine.stop()
           self.audioEngine = nil
         }
         EkweAudioBridge.stopCapture()
         self.isAudioRecording = false
         return ["success": false, "error": error.localizedDescription]
       }
    }

     AsyncFunction("stopAudioRecording") { () -> [String: Any] in
       if !self.isAudioRecording {
         return ["success": false, "error": "Not recording",
                 "durationMs": 0, "waveform": [] as [Float]]
       }

        self.isAudioRecording = false
        // Capture duration before nilling the start time (JS consumes durationMs).
        let durationMs = self.recordingStartTime.map {
          Int(Date().timeIntervalSince($0) * 1000)
        } ?? 0
        self.recordingStartTime = nil

       if let engine = self.audioEngine {
         engine.inputNode.removeTap(onBus: 0)
         engine.stop()
         self.audioEngine = nil
       }

       // Drain the audio queue before tearing down the C++ capture controller,
       // so no queued feedPcm call races with stopCapture() deleting the object.
       self.audioQueue.sync(flags: .barrier, {})

       EkweAudioBridge.stopCapture()

        let waveformNs = EkweAudioBridge.lastWaveform()
        let waveform = (waveformNs as? [NSNumber])?.map { $0.floatValue } ?? []
        return ["success": true, "error": "",
                "durationMs": durationMs, "waveform": waveform]
      }

    AsyncFunction("resolveAndTranscodeToOpus") { (uriString: String, outputPath: String, maxAudioBytes: Int, options: [String: Any]?) -> [String: Any] in
      switch self.guardedSourcePath(uriString, maxAudioBytes: maxAudioBytes) {
      case .tooLarge:
        return [
          "success": false, "error": "FILE_TOO_LARGE", "durationMs": 0,
          "waveform": [] as [Float],
        ]
      case .invalid:
        return [
          "success": false, "error": "INVALID_INPUT_FILE", "durationMs": 0,
          "waveform": [] as [Float],
        ]
      case .ok(let sourcePath):
        if let maxDurationMs = options?["maxDurationMs"] as? Int, maxDurationMs > 0 {
          let probed = EkweAudioBridge.probeAudioDurationMs(sourcePath)
          if probed > maxDurationMs {
            return [
              "success": false, "error": "DURATION_TOO_LONG", "durationMs": probed,
              "waveform": [] as [Float],
            ]
          }
        }
        // M4A playback copy (AAC-LC) from the same decode as the Opus artifact,
        // encoded straight from the decoded PCM — ready before preview.
        let m4aPath = ((outputPath as NSString).deletingPathExtension as String) + ".m4a"
        let result = EkweAudioBridge.resolveAudio(sourcePath, options: [
          "opusOutputPath": outputPath,
          "maxAudioBytes": maxAudioBytes,
          "playbackOutputPath": m4aPath,
        ])
        return [
          "success": result["success"] as? Bool ?? false,
          "error": result["error"] as? String ?? "",
          "durationMs": result["durationMs"] as? Int ?? 0,
          "waveform": result["waveform"] as? [Float] ?? [],
          "playbackUri": result["playbackUri"] as? String ?? "",
        ]
      }
    }

     AsyncFunction("writeSharedFile") { (fileName: String, content: String) -> Bool in
       guard let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.com.ekwe.app") else {
         return false
       }
       let fileURL = dir.appendingPathComponent(fileName)
       guard let data = content.data(using: .utf8) else { return false }
       do {
         try data.write(to: fileURL, options: [.atomic, .completeUntilFirstUserAuthentication])
         var values = URLResourceValues()
         values.isExcludedFromBackup = true
         try fileURL.setResourceValues(values)
         return true
       } catch {
         return false
       }
     }

     AsyncFunction("deleteFile") { (uriString: String) -> Bool in
       let plainPath = uriString.hasPrefix("file://")
         ? String(uriString.dropFirst("file://".count))
         : uriString
       do {
         if FileManager.default.fileExists(atPath: plainPath) {
           try FileManager.default.removeItem(atPath: plainPath)
         }
         return true
       } catch {
         return false
       }
     }

     // ─── Outgoing audio share ──────────────────────────────────────
     // Native rather than expo-sharing: that module builds
     // `UIActivityViewController(activityItems: [url])` and drops the options
     // object entirely, so there is no way to attach the transcript caption
     // through it.
     //
     // `mimeType` is accepted for signature symmetry with Android but is not
     // used — iOS derives org.xiph.ogg-audio from the file's `.ogg` extension,
     // which is what audio-capable activities match on. Voice-note rendering is
     // target-dependent: Telegram's iOS share path attaches the URL as a file
     // item, so it may render as a music player rather than a voice note.
     //
     // `targetPackage` is also ignored: UIActivityViewController cannot force a
     // specific third-party app, so iOS always presents the system activity
     // sheet. The JS sheet still labels the intended target.
     AsyncFunction("shareAudio") {
       (filePath: String, _ mimeType: String, text: String?, _ chooserTitle: String?, _ targetPackage: String?, promise: Promise) in
       let plainPath = filePath.hasPrefix("file://")
         ? String(filePath.dropFirst("file://".count))
         : filePath
       guard FileManager.default.fileExists(atPath: plainPath) else {
         promise.resolve(["success": false, "error": "File not found"])
         return
       }

       // Caption first: share extensions that act on the first text item
       // (mail, notes, most messengers) lead with the readable content.
       var items: [Any] = []
       if let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
         items.append(text)
       }
       items.append(URL(fileURLWithPath: plainPath))

       DispatchQueue.main.async {
         guard let presenter = Self.topViewController() else {
           promise.resolve(["success": false, "error": "No view controller"])
           return
         }

         // `chooserTitle` is deliberately unused. UIActivityViewController has
         // no title bar, so there is nothing to title — and the only way to
         // fake one is the private `subject` property, which only Mail reads
         // (as an email subject line) and which is not App Store safe.
         let controller = UIActivityViewController(activityItems: items, applicationActivities: nil)
         controller.completionWithItemsHandler = { _, _, _, _ in
           promise.resolve(["success": true, "error": ""])
         }

         // Apple requires a popover on iPad or the presentation traps.
         if UIDevice.current.userInterfaceIdiom == .pad,
            let popover = controller.popoverPresentationController {
           popover.sourceView = presenter.view
           popover.sourceRect = CGRect(
             x: presenter.view.bounds.midX,
             y: presenter.view.bounds.maxY,
             width: 0,
             height: 0
           )
           popover.permittedArrowDirections = []
         }

         presenter.present(controller, animated: true)
       }
     }
   }
}
