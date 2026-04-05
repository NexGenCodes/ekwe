import UIKit
import Social
import MobileCoreServices
import UniformTypeIdentifiers

class ShareViewController: SLComposeServiceViewController {
    
    // We use a shared container to pass the file to the main app
    private let APP_GROUP_ID = "group.com.anonymous.ekwe"
    private let APP_SCHEME = "ekwe://share"

    override fun isContentValid() -> Bool {
        // Validation logic - always valid for simple audio share
        return true
    }

    override fun didSelectPost() {
        // This is called after the user taps "Post"
        // We handle the file processing here
        handleSharedAudio()
    }

    override fun configurationItems() -> [Any]! {
        // To add custom configuration items, return an array of SLComposeSheetConfigurationItem
        return []
    }
    
    private func handleSharedAudio() {
        guard let extensionItem = extensionContext?.inputItems.first as? NSExtensionItem,
              let attachment = extensionItem.attachments?.first else {
            self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            return
        }
        
        let audioType = UTType.audio.identifier
        
        if attachment.hasItemConformingToTypeIdentifier(audioType) {
            attachment.loadItem(forTypeIdentifier: audioType, options: nil) { [weak self] (data, error) in
                guard let self = self else { return }
                
                var fileURL: URL?
                
                if let url = data as? URL {
                    fileURL = url
                } else if let data = data as? Data {
                    // Handle memory-only data by writing to a temporary file
                    let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".m4a")
                    try? data.write(to: tempURL)
                    fileURL = tempURL
                }
                
                if let sourceURL = fileURL {
                    self.copyToAppGroupAndOpenApp(sourceURL: sourceURL)
                } else {
                    self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
                }
            }
        } else {
            self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
        }
    }
    
    private func copyToAppGroupAndOpenApp(sourceURL: URL) {
        let fileManager = FileManager.default
        guard let containerURL = fileManager.containerURL(forSecurityApplicationGroupIdentifier: APP_GROUP_ID) else {
            self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            return
        }
        
        let destinationURL = containerURL.appendingPathComponent(sourceURL.lastPathComponent)
        
        try? fileManager.removeItem(at: destinationURL)
        
        do {
            try fileManager.copyItem(at: sourceURL, to: destinationURL)
            
            // Open the main app via URL scheme
            let urlString = "\(APP_SCHEME)?uri=\(destinationURL.path.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")"
            if let openURL = URL(string: urlString) {
                var responder: UIResponder? = self
                while responder != nil {
                    if let application = responder as? UIApplication {
                        application.open(openURL, options: [:], completionHandler: null)
                        break
                    }
                    responder = responder?.next
                }
                
                // Note: Shared extensions don't have direct access to UIApplication.open
                // Standard workaround is using NSExtensionContext if supported, 
                // but the URL scheme approach is legacy and robust for triggered launches.
                self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            }
        } catch {
            self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
        }
    }
}
