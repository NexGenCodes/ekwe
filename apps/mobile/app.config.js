const fs = require("node:fs");
const path = require("node:path");
const { withAppBuildGradle } = require("@expo/config-plugins");

// Wire release APK signing to a gitignored android/keystore.properties file
// (written by CI from the ANDROID_KEYSTORE_B64 secret) instead of the
// hard-coded debug keystore that the RN template ships in the release
// buildType. Falls back to debug signing when no keystore.properties exists
// (local dev, or a release without the secret configured), so builds never
// break just because signing isn't set up.
function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let contents = cfg.modResults.contents;

    if (!contents.includes("keystoreProperties['storeFile']")) {
      const signingIdx = contents.indexOf("signingConfigs {");
      const buildTypesIdx = contents.indexOf("buildTypes {");
      if (signingIdx === -1 || buildTypesIdx === -1)
        throw new Error(
          "Could not find signingConfigs/buildTypes blocks in app/build.gradle",
        );

      const loaderSrc = `

// Load keystore.properties from apps/mobile/secrets/ (survives prebuild, which
// wipes android/), falling back to the legacy android/ location; see app.config.js.
def secretsKeystorePropertiesFile = rootProject.file("../secrets/keystore.properties")
def keystorePropertiesFile = secretsKeystorePropertiesFile.exists()
    ? secretsKeystorePropertiesFile
    : rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
`;
      contents =
        contents.slice(0, signingIdx) + loaderSrc + contents.slice(signingIdx);

      const releaseSigning = `
    release {
        if (keystorePropertiesFile.exists()) {
            storeFile file(keystoreProperties['storeFile'])
            storePassword keystoreProperties['storePassword']
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
        }
    }`;
      const blockStart = contents.indexOf("signingConfigs {");
      const blockEnd = contents.indexOf("buildTypes {");
      const blockText = contents.slice(blockStart, blockEnd);
      const closes = [...blockText.matchAll(/\n\s*}/g)];
      const lastClose = closes[closes.length - 1];
      if (!lastClose)
        throw new Error(
          "Could not find signingConfigs closing brace in app/build.gradle",
        );
      const pos = blockStart + lastClose.index;
      contents = contents.slice(0, pos) + releaseSigning + contents.slice(pos);
    }

    if (!contents.includes("signingConfig keystorePropertiesFile.exists()")) {
      const marker = "signingConfig signingConfigs.debug";
      const replacement =
        "signingConfig keystorePropertiesFile.exists() ? signingConfigs.release : signingConfigs.debug";
      const idx = contents.lastIndexOf(marker);
      if (idx === -1)
        throw new Error(
          "Could not find release signingConfig in app/build.gradle",
        );
      contents =
        contents.slice(0, idx) +
        replacement +
        contents.slice(idx + marker.length);
    }

    cfg.modResults.contents = contents;
    return cfg;
  });
}

function readSharedVersion() {
  const versionTsPath = path.resolve(
    __dirname,
    "../../packages/shared/src/version.ts",
  );
  const content = fs.readFileSync(versionTsPath, "utf8");
  const version = content.match(/APP_VERSION\s*=\s*"([^"]+)"/)?.[1];
  const versionCode = content.match(/APP_VERSION_CODE\s*=\s*(\d+)/)?.[1];
  if (!version || !versionCode) {
    throw new Error(
      `Could not parse APP_VERSION/APP_VERSION_CODE from ${versionTsPath}`,
    );
  }
  return { version, versionCode: Number(versionCode) };
}

module.exports = ({ config }) => {
  // Version lives in packages/shared/src/version.ts (single source of truth).
  const { version, versionCode } = readSharedVersion();

  // Dev builds: build only for the connected device's CPU architecture.
  // Pass the detected arch via EXPO_PUBLIC_DEV_ARCH (set by the android script).
  // Production releases: build all active ABIs to support all Android devices.
  const isProduction =
    process.env.APP_ENV === "production" ||
    process.env.EAS_BUILD === "true" ||
    process.env.NODE_ENV === "production";

  const reactNativeArchitectures = isProduction
    ? "armeabi-v7a,arm64-v8a"
    : process.env.EXPO_PUBLIC_DEV_ARCH || "arm64-v8a";

  // Compress native libraries (.so) in APK builds for a smaller download.
  // RN 0.73+ ships .so files uncompressed (extractNativeLibs=false) for direct
  // mmap — faster startup but larger APK. Keep that for the Play Store AAB
  // (per-ABI delivery, mmap matters); enable legacy packaging everywhere else
  // (preview/internal APK, local builds) to shrink the APK.
  const isPlayStoreBuild = process.env.EAS_BUILD_PROFILE === "production";
  const useLegacyPackaging = !isPlayStoreBuild;

  const plugins = (config.plugins || []).map((plugin) => {
    if (Array.isArray(plugin) && plugin[0] === "expo-build-properties") {
      // Preserve every option that app.json declares for this plugin
      // (minify, shrinkResources, extraProguardRules, buildArchs, png
      // crunch, ...) and only override the fields this file owns.
      const previous = plugin[1] || {};
      return [
        "expo-build-properties",
        {
          ...previous,
          android: {
            ...(previous.android || {}),
            compileSdkVersion: 36,
            targetSdkVersion: 36,
            minSdkVersion: 24,
            ndkVersion: "27.1.12297006",
            useLegacyPackaging,
            reactNativeArchitectures,
          },
        },
      ];
    }
    return plugin;
  });

  plugins.push([
    "@react-native-google-signin/google-signin",
    {
      iosUrlScheme: `com.googleusercontent.apps.${process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID}`,
    },
  ]);

  plugins.push("expo-asset");

  plugins.push(withReleaseSigning);

  const sentryIndex = plugins.findIndex(
    (p) =>
      p === "@sentry/react-native" ||
      (Array.isArray(p) && p[0] === "@sentry/react-native"),
  );

  if (sentryIndex !== -1) {
    plugins[sentryIndex] = [
      "@sentry/react-native",
      {
        organization: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        // Wires the Sentry Android Gradle Plugin into prebuild so the R8/ProGuard
        // mapping.txt is auto-uploaded on release builds. Without it, native stack
        // traces stay obfuscated once minify (R8) is enabled. Requires
        // SENTRY_AUTH_TOKEN to be set during the release build.
        experimental_android: {
          enableAndroidGradlePlugin: true,
          includeProguardMapping: true,
          autoUploadProguardMapping: true,
        },
      },
    ];
  }

  return {
    ...config,
    version,
    android: {
      ...config.android,
      versionCode,
    },
    ios: {
      ...config.ios,
      buildNumber: String(versionCode),
    },
    plugins,
  };
};
