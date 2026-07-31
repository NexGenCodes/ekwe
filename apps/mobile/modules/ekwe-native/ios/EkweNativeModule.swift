import ExpoModulesCore
import AVFoundation

public class EkweNativeModule: Module {
  private var audioEngine: AVAudioEngine?
  private var isAudioRecording = false
  private var currentAmplitude: Float = 0
  private var captureMode: String = "file"
  private var outputPath: String = ""

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
    Events("onStateChanged", "onIntentQueued", "onAppForeground", "onAppBackground",
           "onForegroundAppChanged", "onOpusPacket", "onVadSilence")

    // ------------------------------------
    // Bubble Overlay — iOS stubs
    // ------------------------------------

    AsyncFunction("hasOverlayPermission") { () -> Bool in
      return true
    }

    AsyncFunction("requestOverlayPermission") { () in
    }

    AsyncFunction("startBubbleService") { () in
    }

    AsyncFunction("stopBubbleService") { () in
    }

    AsyncFunction("getSavedPosition") { () -> [String: Double]? in
      let x = UserDefaults.standard.double(forKey: "ekwe_bubble_x")
      let y = UserDefaults.standard.double(forKey: "ekwe_bubble_y")
      if x == 0 && y == 0 {
        return nil
      }
      return ["x": x, "y": y]
    }

    AsyncFunction("savePosition") { (x: Double, y: Double) in
      UserDefaults.standard.set(x, forKey: "ekwe_bubble_x")
      UserDefaults.standard.set(y, forKey: "ekwe_bubble_y")
    }

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

    AsyncFunction("updateBubbleVisibility") { (visible: Bool) in
    }

    AsyncFunction("updateBubbleState") { (mode: String, data: String?) in
      print("[Ekwe] Updating iOS Live Activity state: \(mode)")
    }

    AsyncFunction("showFloatingCard") { (transcription: String, translation: String) in
      print("[Ekwe] iOS Ghost Mode: Falling back to in-app overlay")
    }

    OnAppForegrounded {
      print("[Ekwe] App foregrounded — cleaning up iOS background tasks")
    }

    // ------------------------------------
    // Audio Conversion
    // ------------------------------------
    AsyncFunction("extractWavAndWaveform") { (inputPath: String, outputPath: String) -> [String: Any] in
      let result = EkweAudioBridge.extractWavAndWaveform(inputPath, outputPath: outputPath)
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
      return ["success": true, "error": "",
              "durationMs": 0, "waveform": waveform]
    }

    AsyncFunction("resolveAndConvertToOpus") { (_: String, _: String) -> [String: Any] in
      return ["success": false, "error": "Use extractWavAndWaveform on iOS",
              "durationMs": 0, "waveform": [] as [Float]]
    }

    AsyncFunction("getRecordingAmplitude") { () -> Double in
      return Double(self.currentAmplitude)
    }
  }
}
