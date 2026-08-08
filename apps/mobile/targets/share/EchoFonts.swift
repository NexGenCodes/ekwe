import CoreText
import Foundation
import SwiftUI

/// Bundled fonts for the share extension. The extension runs in its own
/// process/bundle, so it can't rely on the main app's font registration —
/// we register the Outfit + Space Mono TTFs directly with CoreText on launch.
/// Missing assets degrade gracefully back to the system font via
/// `Font.custom(_:size:)` fallback.
@available(iOS 16.4, *)
enum EchoFonts {

    /// Wired into the out-of-process startup path (see ShareViewController).
    static func register() {
        guard let urls = findFontURLs() else { return }
        for url in urls {
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }

    /// Wraps `Font.custom`, keeping the call site stable whether the family is
    /// registered or not.
    static func custom(_ family: String, size: CGFloat) -> Font {
        Font.custom(family, size: size)
    }

    private static func findFontURLs() -> [URL]? {
        // Fonts are copied to the extension bundle under Fonts/.
        if let urls = Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: "Fonts"),
            !urls.isEmpty {
            return urls
        }
        // Fallback: scan the whole bundle in case the layout changes.
        guard let resourceURL = Bundle.main.resourceURL else { return nil }
        let fileManager = FileManager.default
        guard let enumerator = fileManager.enumerator(
            at: resourceURL,
            includingPropertiesForKeys: nil
        ) else { return nil }
        var results: [URL] = []
        for case let url as URL in enumerator where url.pathExtension.lowercased() == "ttf" {
            results.append(url)
        }
        return results.isEmpty ? nil : results
    }
}