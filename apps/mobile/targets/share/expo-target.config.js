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
    // File sharing: audio payload bridges to the app via the App Group
    // container (group.com.ekwe.app).
    "com.apple.security.application-groups": ["group.com.ekwe.app"],
    // Session sharing: both the app and the extension share a keychain
    // access group so the authenticated session can be restored inside the
    // extension without a login prompt.
    "keychain-access-groups": [
      "$(AppIdentifierPrefix)com.ekwe.app",
      "$(AppIdentifierPrefix)com.ekwe.app.EchoShare",
    ],
  },
};