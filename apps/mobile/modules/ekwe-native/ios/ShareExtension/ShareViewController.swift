import UIKit
import Social
import UniformTypeIdentifiers

class ShareViewController: SLComposeServiceViewController {
    
    // We use a shared container to pass the file to the main app
    private let APP_GROUP_ID = "group.com.anonymous.ekwe"
    private let APP_SCHEME = "ekwe://share"

    override func isContentValid() -> Bool {
        return true
    }

    override func didSelectPost() {
        handleSharedAudio()
    }

    override func configurationItems() -> [Any]! {
        return []
    }
    
    private func handleSharedAudio() {
        guard let extensionItem = extensionContext?.inputItems.first as? NSExtensionItem,
              let attachment = extensionItem.attachments?.first else {
            self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            return
        }
        
        let audioType = UTType.audio.identifier
        
        guard attachment.hasItemConformingToTypeIdentifier(audioType) else {
            self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            return
        }
        
        attachment.loadItem(forTypeIdentifier: audioType, options: nil) { [weak self] (data, error) in
            guard let self = self else { return }
            
            var fileURL: URL?
            
            if let url = data as? URL {
                fileURL = url
            } else if let data = data as? Data {
                // Handle memory-only data by writing to a temporary file
                let tempURL = FileManager.default.temporaryDirectory
                    .appendingPathComponent(UUID().uuidString + ".m4a")
                try? data.write(to: tempURL)
                fileURL = tempURL
            }
            
            if let sourceURL = fileURL {
                self.copyToAppGroupAndOpenApp(sourceURL: sourceURL)
            } else {
                self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            }
        }
    }
    
    private func copyToAppGroupAndOpenApp(sourceURL: URL) {
        let fileManager = FileManager.default
        guard let containerURL = fileManager.containerURL(forSecurityApplicationGroupIdentifier: APP_GROUP_ID) else {
            self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            return
        }
        
        // Prune stale copies from previous shares so the shared container doesn't grow unboundedly.
        if let existing = try? fileManager.contentsOfDirectory(
            at: containerURL,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ) {
            existing.forEach { try? fileManager.removeItem(at: $0) }
        }
        
        // Some providers share files without an extension; the app validates
        // by extension, so give the copy a known audio extension in that case.
        let fileName = sourceURL.pathExtension.isEmpty
            ? "\(sourceURL.lastPathComponent).m4a"
            : sourceURL.lastPathComponent
        let destinationURL = containerURL.appendingPathComponent(fileName)
        
        do {
            try fileManager.copyItem(at: sourceURL, to: destinationURL)
        } catch {
            self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            return
        }
        
        // Percent-encode everything except unreserved characters and "/" so the
        // query value can't be corrupted by "&", "?", "#" or "=" inside the path.
        let allowed = CharacterSet(charactersIn: "/-._~").union(.alphanumerics)
        let encodedPath = destinationURL.path
            .addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
        
        guard let openURL = URL(string: "\(APP_SCHEME)?uri=\(encodedPath)") else {
            self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            return
        }
        
        // NSExtensionContext.open is the sanctioned way to launch the host app from
        // a share extension (UIApplication.open is unavailable to extensions).
        self.extensionContext?.open(openURL) { _ in
            self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
        }
    }
}
