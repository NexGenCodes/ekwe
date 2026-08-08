import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// The principal class for this share extension (matches the
/// NSExtensionPrincipalClass in Info.plist). It hosts the pure-SwiftUI Ekwe Echo
/// sheet and loads the first audio attachment from the share item.
///
/// There is NO deep-link handoff: the entire echo pipeline (decode → waveform →
/// pick language → transcribe → translate → result) runs natively in this
/// extension process, authenticated with the Supabase session the app mirrored
/// into the shared App Group container.
@available(iOS 16.4, *)
final class ShareViewController: UIViewController {

    private let model = EchoShareModel()

    override func viewDidLoad() {
        super.viewDidLoad()

        view.backgroundColor = .clear

        // Register the bundled brand fonts (Outfit/Space Mono) before the
        // SwiftUI sheet renders; falls back to the system font if absent.
        EchoFonts.register()

        let rootView = EchoShareSheet(model: model) { [weak self] in
            self?.cancelShare()
        }
        let host = UIHostingController(rootView: rootView)
        host.view.backgroundColor = .clear
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        host.didMove(toParent: self)

        Task { @MainActor in
            // Restore the session from the shared container first; only proceed
            // to loading audio when the user is signed in.
            if await model.start() {
                loadSharedAudio()
            }
        }
    }

    private func loadSharedAudio() {
        guard
            let extensionItem = extensionContext?.inputItems.first as? NSExtensionItem,
            let attachment = extensionItem.attachments?.first
        else {
            model.fail("No share item found.")
            return
        }

        let audioType = UTType.audio.identifier

        guard attachment.hasItemConformingToTypeIdentifier(audioType) else {
            model.fail("This item isn't audio.")
            return
        }

        attachment.loadItem(forTypeIdentifier: audioType, options: nil) { [weak self] item, _ in
            Task { @MainActor in
                guard let self else { return }

                var url: URL?
                if let sourceURL = item as? URL {
                    url = sourceURL
                } else if let data = item as? Data {
                    let tempURL = FileManager.default.temporaryDirectory
                        .appendingPathComponent(UUID().uuidString + ".m4a")
                    do {
                        try data.write(to: tempURL)
                        url = tempURL
                    } catch {
                        self.model.fail("Couldn't read the audio file.")
                        return
                    }
                }

                guard let url else {
                    self.model.fail("Couldn't read the audio file.")
                    return
                }

                await self.model.loadAudio(from: url)
            }
        }
    }

    private func cancelShare() {
        extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }
}
