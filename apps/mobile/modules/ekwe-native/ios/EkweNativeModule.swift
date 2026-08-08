import ExpoModulesCore
import AVFoundation

public class EkweNativeModule: Module {
  private var audioEngine: AVAudioEngine?
  private var isAudioRecording = false
  private var recordingStartTime: Date?
  private var currentAmplitude: Float = 0
  private var captureMode: String = "file"
  private var outputPath: String = ""

  // Authoritative limit lives in @ekwe/shared/plans (PREMIUM_LIMITS.
  // maxAudioBytes); JS passes it in at call time so native never hardcodes it.
  // This is only a defensive default if a caller omits the argument.

  /// Resolves a share file:// path (stripping scheme) and rejects inputs over
  /// the size cap before any decode work begins.
  private func guardedSourcePath(_ path: String, maxAudioBytes: Int) -> String? {
    let plainPath = path.hasPrefix("file://") ? String(path.dropFirst("file://".count)) : path
    let url = URL(fileURLWithPath: plainPath)
    let limit = maxAudioBytes > 0 ? maxAudioBytes : 26_214_400
    guard
      let values = try? url.resourceValues(forKeys: [.fileSizeKey]),
      let size = values.fileSize,
      size <= limit
    else {
      return nil
    }
    return plainPath
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
      guard let sourcePath = self.guardedSourcePath(inputPath, maxAudioBytes: maxAudioBytes) else {
        return [
          "success": false,
          "error": "FILE_TOO_LARGE",
          "durationMs": 0,
          "waveform": [] as [Float],
        ]
      }
      let result = EkweAudioBridge.transcodeToOpusWithWaveform(sourcePath, outputPath: outputPath)
      return [
        "success": result[0] as! Bool,
        "error": result[1] as! String,
        "durationMs": result[2] as! Int,
        "waveform": result[3] as! [Float],
      ]
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
      self.captureMode = isLive ? "live" : "file"

      do {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord,
                                mode: .voiceChat,
                                options: [.allowBluetooth, .defaultToSpeaker])
        try session.setPreferredIOBufferDuration(0.005)
        try session.setActive(true)

        let engine = AVAudioEngine()
        let inputNode = engine.inputNode
        let inputFormat = inputNode.outputFormat(forBus: 0)

        let desiredFormat = AVAudioFormat(commonFormat: .pcmFormatInt16,
                                          sampleRate: 16000,
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
                             bufferSize: 960,
                             format: inputFormat) { (buffer, time) in
          guard let channelData = buffer.floatChannelData else { return }

          let frameLength = Int(buffer.frameLength)
          var pcmBuffer = [Int16](repeating: 0, count: frameLength)

          for i in 0..<frameLength {
            let sample = channelData[0][i]
            let clamped = max(-1.0, min(1.0, Double(sample)))
            pcmBuffer[i] = clamped >= 0
              ? Int16(clamped * 32767.0)
              : Int16(clamped * 32768.0)
          }

          EkweAudioBridge.feedPcm(&pcmBuffer, numSamples: Int32(frameLength))

          self.currentAmplitude = EkweAudioBridge.getAmplitude()
        }

        engine.prepare()
        try engine.start()
        self.audioEngine = engine
        self.isAudioRecording = true
        self.recordingStartTime = Date()

        return ["success": true, "error": ""]
      } catch {
        self.isAudioRecording = false
        self.audioEngine = nil
        return ["success": false, "error": error.localizedDescription]
      }
    }

    AsyncFunction("stopAudioRecording") { () -> [String: Any] in
      if !self.isAudioRecording {
        return ["success": false, "error": "Not recording",
                "durationMs": 0, "waveform": [] as [Float]]
      }

      self.isAudioRecording = false

      if let engine = self.audioEngine {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        self.audioEngine = nil
      }

      EkweAudioBridge.stopCapture()

      let waveformNs = EkweAudioBridge.lastWaveform()
      let waveform = (waveformNs as? [NSNumber])?.map { $0.floatValue } ?? []
      let durationMs = self.recordingStartTime.map {
        Int(Date().timeIntervalSince($0) * 1000)
      } ?? 0
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

    AsyncFunction("getRecordingAmplitude") { () -> Double in
      return Double(self.currentAmplitude)
    }
  }
}
