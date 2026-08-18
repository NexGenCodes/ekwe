import ExpoModulesCore
import AVFoundation

public class EkweNativeModule: Module {
  private var audioEngine: AVAudioEngine?
  private var isAudioRecording = false
  private var recordingStartTime: Date?
  private var outputPath: String = ""

  /// Serial, non-real-time queue for feeding PCM into the C++ capture controller.
  /// Keeps Opus encoding + Ogg writes off the audio render thread, and preserves
  /// feed order so the staging buffer sees samples monotonically.
  private let audioQueue = DispatchQueue(label: "com.ekwe.app.audio.capture")

  // Authoritative limit lives in @ekwe/shared/plans (PREMIUM_LIMITS.
  // maxAudioBytes); JS passes it in at call time so native never hardcodes it.
  // This is only a defensive default if a caller omits the argument.

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
    let limit = maxAudioBytes > 0 ? maxAudioBytes : 26_214_400
    guard
      let values = try? url.resourceValues(forKeys: [.fileSizeKey]),
      let size = values.fileSize
    else {
      return .invalid
    }
    guard size <= limit else { return .tooLarge }
    return .ok(plainPath)
  }

  public func definition() -> ModuleDefinition {
    Name("EkweNative")

    OnCreate {
      do {
        let rt = try appContext.runtime
        try rt.execute {
          rt.withUnsafePointee { pointer in
            installEkweNativeJSI(pointer)
          }
        }
      } catch {
        NSLog("[EkweNative] Failed to install JSI binding: \(error.localizedDescription)")
      }
    }

    // ------------------------------------
    // Events
    // ------------------------------------
    Events("onOpusPacket", "onVadSilence")

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
    // Audio Conversion
    // ------------------------------------
    AsyncFunction("transcodeToOpusWithWaveform") { (inputPath: String, outputPath: String, maxAudioBytes: Int) -> [String: Any] in
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
        let result = EkweAudioBridge.transcodeToOpusWithWaveform(sourcePath, outputPath: outputPath)
        return [
          "success": result[0] as! Bool,
          "error": result[1] as! String,
          "durationMs": result[2] as! Int,
          "waveform": result[3] as! [Float],
        ]
      }
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

    // Remuxes Ogg Opus into Opus-in-CAF, or re-encodes non-Opus sources to Opus
    // CAF (see cpp::decode_audio_to_caf). CAF is an iOS-supported container, so
    // playback avoids the size and CPU cost of the WAV round-trip.
    AsyncFunction("decodeAudioToCaf") { (inputPath: String, outputPath: String, maxAudioBytes: Int) -> [String: Any] in
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
        let result = EkweAudioBridge.decodeToCafWithSourcePath(sourcePath, outputPath: outputPath, maxAudioBytes: UInt(max(0, maxAudioBytes)))
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

         // Initialize C++ capture controller through bridge with callbacks
         let captureOk = EkweAudioBridge.initCapture(path,
                                                      sampleRate: Int32(sampleRate),
                                                      channels: 1,
                                                      isLive: isLive,
                                                      opusPacketBlock: { [weak self] packet, rms in
           guard let self = self else { return }
           self.sendEvent("onOpusPacket", [
             "packet": packet.base64EncodedString(),
             "rms": rms
           ])
         }, vadSilenceBlock: { [weak self] in
           guard let self = self else { return }
           self.sendEvent("onVadSilence", [:])
         })
         if !captureOk {
           return ["success": false, "error": "Failed to init capture"]
         }

         inputNode.installTap(onBus: 0,
                              bufferSize: 320,
                              format: desiredFormat) { [weak self] buffer, _ in
           guard let channelData = buffer.floatChannelData else { return }

           let frameLength = Int(buffer.frameLength)
           // Copy samples into a stable Int16 buffer (16 kHz mono) before handing
           // them to the capture queue. The C++ side owns no reference to the
           // AVAudioPCMBuffer, so a defensive copy is cheap and race-free.
           var pcmBuffer = [Int16](repeating: 0, count: frameLength)

           for i in 0..<frameLength {
             let sample = channelData[0][i]
             let clamped = max(-1.0, min(1.0, Double(sample)))
             pcmBuffer[i] = clamped >= 0
               ? Int16(clamped * 32767.0)
               : Int16(clamped * 32768.0)
           }

           // Encode off the render thread; feed order is preserved by the serial queue.
           self?.audioQueue.async {
             pcmBuffer.withUnsafeBufferPointer { ptr in
               if let base = ptr.baseAddress {
                 EkweAudioBridge.feedPcm(UnsafeMutablePointer(mutating: base),
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

    AsyncFunction("resolveAndTranscodeToOpus") { (_: String, _: String, _: Int) -> [String: Any] in
      // iOS doesn't receive Android-style content:// URIs; shared files arrive
      // as file:// paths consumable by transcodeToOpusWithWaveform directly.
      return ["success": false, "error": "Use transcodeToOpusWithWaveform on iOS",
              "durationMs": 0, "waveform": [] as [Float]]
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
   }
}
