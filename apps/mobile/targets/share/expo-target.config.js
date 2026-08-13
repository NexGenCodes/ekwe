/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: "share",
  name: "ShareExtension",
  displayName: "EKWE Echo",
  bundleIdentifier: ".EchoShare",
  deploymentTarget: "16.4",
  // Pure native SwiftUI sheet — do NOT bundle the JS runtime.
  exportJs: false,
  frameworks: ["SwiftUI"],
   entitlements: {
     // File sharing: audio payload + session/ settings bridge to the app via the
     // App Group container (`group.com.ekwe.app`). The session is mirrored to a
     // file in that container by the app; no login prompt is needed here.
     "com.apple.security.application-groups": ["group.com.ekwe.app"],
     // Keychain access group retained (shared with the app) so a future
     // migration can store tokens there instead of the mirrored file.
     "keychain-access-groups": [
       "$(AppIdentifierPrefix)com.ekwe.app",
       "$(AppIdentifierPrefix)com.ekwe.app.EchoShare",
     ],
   },
};