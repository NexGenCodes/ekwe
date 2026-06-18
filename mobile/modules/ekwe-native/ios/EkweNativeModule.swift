import ExpoModulesCore

public class EkweNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("EkweNative")

    // ------------------------------------
    // Bubble Overlay — iOS stubs
    // On iOS the bubble is rendered in-app (no SYSTEM_ALERT_WINDOW),
    // so these resolve with sensible defaults.
    // ------------------------------------

    AsyncFunction("hasOverlayPermission") { () -> Bool in
      // iOS doesn't need overlay permission — always true
      return true
    }

    AsyncFunction("requestOverlayPermission") { () in
      // No-op on iOS
    }

    AsyncFunction("startBubbleService") { () in
      // No foreground service on iOS — handled by background modes
    }

    AsyncFunction("stopBubbleService") { () in
      // No-op on iOS
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
    // iOS handles audio processing at the AVAudioSession level,
    // so these are no-ops. Expand here for custom CoreAudio work.
    // ------------------------------------

    AsyncFunction("attachEffects") { (_: Double) -> [String: Bool] in
      return [
        "noiseSuppressor": false,
        "echoCanceler": false,
        "gainControl": false
      ]
    }

    AsyncFunction("releaseEffects") { () in
      // No-op on iOS
    }

    AsyncFunction("updateBubbleVisibility") { (visible: Bool) in
      // iOS — Bubbles are in-app only, visibility is handled in JS
    }

    AsyncFunction("updateBubbleState") { (mode: String, data: String?) in
      // iOS — Update Live Activity state
      print("[Ekwe] Updating iOS Live Activity state: \(mode)")
    }

    AsyncFunction("showFloatingCard") { (transcription: String, translation: String) in
      // iOS — True floating cards are blocked by Apple.
      // We fall back to the in-app SharedVoiceNoteOverlay handled in useShareIntentHandler.
      print("[Ekwe] iOS Ghost Mode: Falling back to in-app overlay")
    }

    OnAppForegrounded {
      // PRO-GRADE EXCLUSIVITY: Kill all background UI (Live Activities)
      // when the user enters the main app.
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
    // TODO: Live Activity / Dynamic Island (ActivityKit)
    // ------------------------------------
  }
}
