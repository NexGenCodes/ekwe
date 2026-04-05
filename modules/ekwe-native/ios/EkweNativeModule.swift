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

    // ------------------------------------
    // TODO: Live Activity / Dynamic Island
    // Add ActivityKit bindings here in Phase 8.
    // ------------------------------------
  }
}
