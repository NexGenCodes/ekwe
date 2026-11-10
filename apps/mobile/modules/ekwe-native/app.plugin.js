const fs = require("fs");
const path = require("path");
const {
  withAndroidManifest,
  withMainActivity,
  withAndroidStyles,
  withAppBuildGradle,
  withDangerousMod,
  withEntitlementsPlist,
  AndroidConfig,
} = require("expo/config-plugins");
const {
  generateEchoEnvironment,
} = require("../../../../scripts/tokens/native-env.cjs");
const {
  renderDesignTokensSwift,
  renderEchoDesignTokensKotlin,
} = require("../../../../scripts/tokens/native-tokens.cjs");

const APP_GROUP_ID = "group.com.ekwe.app";

/**
 * Adds Intent Filters to AndroidManifest for handling shared audio and text.
 * Intercepts expo-share-intent by stripping ACTION_SEND from MainActivity and
 * routing it to ShareActivity instead for "Ekwe Echo".
 */
const withAndroidIntentFilters = (config) => {
  return withAndroidManifest(config, (config) => {
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(
      config.modResults,
    );
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(
      config.modResults,
    );

    // 1. Force Remove SEND/SEND_MULTIPLE intent filters from MainActivity
    // This is critical to prevent "Double App Icon" in the share tray
    if (mainActivity["intent-filter"]) {
      mainActivity["intent-filter"] = mainActivity["intent-filter"].filter(
        (filter) => {
          const actions = filter.action || [];
          const isShareAction = actions.some(
            (a) =>
              a.$["android:name"] === "android.intent.action.SEND" ||
              a.$["android:name"] === "android.intent.action.SEND_MULTIPLE",
          );

          if (isShareAction) {
            console.log(
              "[EkwePlugin] Stripping share intent-filter from MainActivity",
            );
            return false; // Remove it
          }
          return true; // Keep it
        },
      );
    }

    // 2. EXTRA SAFETY: Strip filters from any other activities that might have been injected
    (mainApplication.activity || []).forEach((activity) => {
      if (
        activity.$["android:name"] !==
          "expo.modules.ekwenative.ShareActivity" &&
        activity["intent-filter"]
      ) {
        activity["intent-filter"] = activity["intent-filter"].filter(
          (filter) => {
            const actions = filter.action || [];
            return !actions.some(
              (a) =>
                a.$["android:name"] === "android.intent.action.SEND" ||
                a.$["android:name"] === "android.intent.action.SEND_MULTIPLE",
            );
          },
        );
      }
    });

    // Default filters for ShareActivity if we don't have them
    const strippedFilters = [
      {
        action: [{ $: { "android:name": "android.intent.action.SEND" } }],
        category: [
          { $: { "android:name": "android.intent.category.DEFAULT" } },
        ],
        data: [{ $: { "android:mimeType": "audio/*" } }],
      },
      {
        action: [
          { $: { "android:name": "android.intent.action.SEND_MULTIPLE" } },
        ],
        category: [
          { $: { "android:name": "android.intent.category.DEFAULT" } },
        ],
        data: [{ $: { "android:mimeType": "audio/*" } }],
      },
    ];

    // 3. Inject ShareActivity into application
    if (!mainApplication.activity) mainApplication.activity = [];

    let shareActivity = mainApplication.activity.find(
      (a) => a.$["android:name"] === "expo.modules.ekwenative.ShareActivity",
    );
    if (!shareActivity) {
      shareActivity = {
        $: {
          "android:name": "expo.modules.ekwenative.ShareActivity",
          "android:theme": "@style/Theme.App.Translucent",
          "android:exported": "true",
          "android:excludeFromRecents": "true",
          "android:launchMode": "singleTask",
          "android:taskAffinity": "",
          "android:label": "EKWE",
          // Handle uiMode (device dark/light theme) in-process so the loading
          // card can be re-themed in onConfigurationChanged instead of the
          // activity being recreated with a stale overlay.
          "android:configChanges": "uiMode",
        },
        "intent-filter": [],
      };
      mainApplication.activity.push(shareActivity);
    }

    if (!shareActivity["intent-filter"]) {
      shareActivity["intent-filter"] = [];
    }

    // 4. Attach the filters to ShareActivity
    strippedFilters.forEach((filter) => {
      const actionXml = filter.action[0].$["android:name"];
      const alreadyExists = shareActivity["intent-filter"].some((f) =>
        f.action?.some((a) => a.$["android:name"] === actionXml),
      );

      if (!alreadyExists) {
        shareActivity["intent-filter"].push(filter);
      }
    });

    return config;
  });
};

/**
 * Ensures onNewIntent is implemented in MainActivity (required for Share Intent delivery).
 */
const withMainActivityOnNewIntent = (config) => {
  return withMainActivity(config, (config) => {
    if (config.modResults.language === "kt") {
      let content = config.modResults.contents;
      const onNewIntentImport = "import android.content.Intent";
      if (!content.includes(onNewIntentImport)) {
        content = content.replace(/package .*\n/, `$&\n${onNewIntentImport}\n`);
      }
      const onNewIntentMethod = `
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
  }
`;
      if (!content.includes("override fun onNewIntent")) {
        content = content.replace(/\n}\s*$/, `${onNewIntentMethod}\n}`);
      }
      config.modResults.contents = content;
    }
    return config;
  });
};

/**
 * IOS: Configures App Groups + shared keychain access group for the main app.
 * The share extension mirrors both in targets/share/expo-target.config.js.
 */
const withIosAppGroup = (config) => {
  return withEntitlementsPlist(config, (config) => {
    if (!config.modResults["com.apple.security.application-groups"]) {
      config.modResults["com.apple.security.application-groups"] = [];
    }
    if (
      !config.modResults["com.apple.security.application-groups"].includes(
        APP_GROUP_ID,
      )
    ) {
      config.modResults["com.apple.security.application-groups"].push(
        APP_GROUP_ID,
      );
    }
    // Shared keychain access group so the extension can restore the session.
    if (!config.modResults["keychain-access-groups"]) {
      config.modResults["keychain-access-groups"] = [];
    }
    const sharedKeychainGroup = "$(AppIdentifierPrefix)com.ekwe.app";
    if (
      !config.modResults["keychain-access-groups"].includes(sharedKeychainGroup)
    ) {
      config.modResults["keychain-access-groups"].push(sharedKeychainGroup);
    }
    return config;
  });
};

/**
 * IOS: Adds the ShareExtension target. Handled by @bacons/apple-targets via
 * the targets/share/ expo-target.config.js — nothing to do here.
 */

/**
 * Placeholder kept in the plugin chain so `withMainActivity` stays wired up.
 * ShareActivity.kt is a hand-written source file, not a generated one; this
 * only reserves the hook and changes nothing.
 */
const withShareActivity = (config) => {
  return withMainActivity(config, (config) => {
    return config;
  });
};

/**
 * Injects the custom Translucent style into styles.xml.
 */
const withTranslucentStyle = (config) => {
  return withAndroidStyles(config, (config) => {
    const translucentStyle = {
      $: {
        name: "Theme.App.Translucent",
        parent: "Theme.AppCompat.DayNight.NoActionBar",
      },
      item: [
        { $: { name: "android:windowIsTranslucent" }, _: "true" },
        {
          $: { name: "android:windowBackground" },
          _: "@android:color/transparent",
        },
        { $: { name: "android:windowContentOverlay" }, _: "@null" },
        { $: { name: "android:windowNoTitle" }, _: "true" },
        { $: { name: "android:windowIsFloating" }, _: "false" },
        { $: { name: "android:backgroundDimEnabled" }, _: "false" }, // We handle our own scrim in RN/native
        {
          $: { name: "android:windowAnimationStyle" },
          _: "@android:style/Animation.Translucent",
        },
      ],
    };

    if (!config.modResults.resources.style) {
      config.modResults.resources.style = [];
    }

    const existingStyleIndex = config.modResults.resources.style.findIndex(
      (s) => s.$.name === "Theme.App.Translucent",
    );

    if (existingStyleIndex !== -1) {
      config.modResults.resources.style[existingStyleIndex] = translucentStyle;
    } else {
      config.modResults.resources.style.push(translucentStyle);
    }

    return config;
  });
};

/**
 * Android: Removes the autofill highlight color from TextInputs
 * so system autofill doesn't add a background tint on paste.
 * Uses tools:targetApi to avoid build failure on minSdk < 26.
 */
const withAutofillHighlightFix = (config) => {
  return withAndroidStyles(config, (config) => {
    const styles = config.modResults.resources.style || [];
    const resources = config.modResults.resources;

    if (!resources.$) resources.$ = {};
    resources.$["xmlns:tools"] = "http://schemas.android.com/tools";

    styles.forEach((style) => {
      const parent = style.$.parent || "";
      if (
        parent.includes("Theme.AppCompat") ||
        parent.includes("Theme.Material")
      ) {
        if (!style.item) style.item = [];
        if (
          !style.item.some((i) => i.$.name === "android:autofilledHighlight")
        ) {
          style.item.push({
            $: { name: "android:autofilledHighlight" },
            _: "@android:color/transparent",
          });
          style.$["tools:targetApi"] = "26";
        }
      }
    });
    return config;
  });
};

/**
 * IOS: Regenerates `targets/share/EchoEnvironment.swift` during `expo prebuild`.
 *
 * `expo prebuild` is the one step every consumer runs (local `expo run:*`,
 * EAS cloud builds, CI), which is how EAS/CI get the file even though it isn't
 * committed. Expo injects `.env` into `process.env` before plugins evaluate, so
 * `EXPO_PUBLIC_*` reads straight off the environment; MAX_AUDIO_BYTES comes from
 * the committed `native-cap.json` snapshot written by scripts/tokens/gen-tokens.mjs
 * (its source of truth is packages/shared/src/plans.ts). No JS runtime needs to exist.
 */
const withEchoEnvironment = (config) => {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const capPath = path.join(__dirname, "native-cap.json");
      let maxAudioBytes = 26 * 1024 * 1024;
      try {
        maxAudioBytes = JSON.parse(
          fs.readFileSync(capPath, "utf8"),
        ).maxAudioBytes;
      } catch {
        // Fall back to the hard cap if the snapshot is missing.
      }

      const envVars = {};
      for (const key of Object.keys(process.env)) {
        if (key.startsWith("EXPO_PUBLIC_")) envVars[key] = process.env[key];
      }

      const outFile = path.join(
        projectRoot,
        "targets",
        "share",
        "EchoEnvironment.swift",
      );
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(
        outFile,
        generateEchoEnvironment(envVars, maxAudioBytes),
        "utf8",
      );
      console.log(`[EkwePlugin] Wrote ${outFile}`);
      return config;
    },
  ]);
};

/**
 * IOS + Android: Regenerates the native design-token files during prebuild —
 * `targets/share/DesignTokens.swift` (iOS share ext) and the Android
 * `EchoDesignTokens.kt` — from the committed `native-tokens.json` snapshot
 * (written by scripts/tokens/gen-tokens.mjs from packages/shared/src/token/*.ts).
 * Rendering is shared with the CLI via scripts/tokens/native-tokens.cjs, so
 * prebuild and `pnpm gen:tokens` stay byte-identical and EAS/CI never see
 * stale committed Swift/Kotlin.
 */
const withEchoDesignTokens = (config) => {
  const render = (modName, outFile, renderer) => {
    return withDangerousMod(config, [
      modName,
      async (pluginConfig) => {
        const projectRoot = pluginConfig.modRequest.projectRoot;
        const snapshotPath = path.join(__dirname, "native-tokens.json");
        let snapshot;
        try {
          snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
        } catch {
          throw new Error(
            `[EkwePlugin] Missing ${snapshotPath} — run \`pnpm gen:tokens\` first.`,
          );
        }
        const target = path.join(projectRoot, outFile);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, renderer(snapshot), "utf8");
        console.log(`[EkwePlugin] Wrote ${target}`);
        return pluginConfig;
      },
    ]);
  };

  config = render(
    "ios",
    "targets/share/DesignTokens.swift",
    renderDesignTokensSwift,
  );
  config = render(
    "android",
    "modules/ekwe-native/android/src/main/java/expo/modules/ekwenative/EchoDesignTokens.kt",
    renderEchoDesignTokensKotlin,
  );
  return config;
};

/**
 * Android: APK update system.
 *
 * Replaces Expo's FirebaseMessagingService with our own so `apk_update`
 * data-only messages are handled natively (download + install prompt) and the
 * app never opens. Expo's service lives in a library manifest, so it is removed
 * at merge time with `tools:node="remove"`; the merged result contains only our
 * service for the MESSAGING_EVENT intent.
 *
 * Also registers the foreground download service (dataSync type) and a
 * FileProvider so the downloaded APK can be handed to the installer.
 */
const APK_UPDATE_SERVICE =
  "expo.modules.ekwenative.EkweFirebaseMessagingService";
const APK_DOWNLOAD_SERVICE = "expo.modules.ekwenative.ApkDownloadService";
const EXPO_FCM_SERVICE =
  "expo.modules.notifications.service.ExpoFirebaseMessagingService";

const withApkUpdateNative = (config) => {
  return withAndroidManifest(config, (config) => {
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(
      config.modResults,
    );
    const manifest = config.modResults.manifest;

    // tools namespace is required for tools:node="remove" below.
    if (!manifest.$) manifest.$ = {};
    manifest.$["xmlns:tools"] = "http://schemas.android.com/tools";

    // Permissions
    const permissions = [
      "android.permission.REQUEST_INSTALL_PACKAGES",
      "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
    ];
    if (!manifest["uses-permission"]) manifest["uses-permission"] = [];
    permissions.forEach((perm) => {
      if (
        !manifest["uses-permission"].some((p) => p.$["android:name"] === perm)
      ) {
        manifest["uses-permission"].push({ $: { "android:name": perm } });
      }
    });

    // Remove Expo's FCM service (from its library manifest, at merge time) and
    // register ours in its place.
    if (!mainApplication.service) mainApplication.service = [];
    mainApplication.service = mainApplication.service.filter(
      (s) => s.$ && s.$["android:name"] !== EXPO_FCM_SERVICE,
    );
    mainApplication.service.push({
      $: { "android:name": EXPO_FCM_SERVICE, "tools:node": "remove" },
    });
    mainApplication.service.push({
      $: { "android:name": APK_UPDATE_SERVICE, "android:exported": "false" },
      "intent-filter": [
        {
          action: [
            { $: { "android:name": "com.google.firebase.MESSAGING_EVENT" } },
          ],
        },
      ],
    });
    mainApplication.service.push({
      $: {
        "android:name": APK_DOWNLOAD_SERVICE,
        "android:exported": "false",
        "android:foregroundServiceType": "dataSync",
      },
    });

    // FileProvider for handing the downloaded APK to the package installer.
    // Own authority, distinct from the one react-native-webview registers:
    // both default to ${applicationId}.fileprovider, and two providers sharing
    // an authority make ContentResolver lookups ambiguous at runtime.
    const authority = "${applicationId}.apkfileprovider";
    if (!mainApplication.provider) mainApplication.provider = [];
    if (
      !mainApplication.provider.some(
        (p) => p.$ && p.$["android:authorities"] === authority,
      )
    ) {
      mainApplication.provider.push({
        $: {
          "android:name": "androidx.core.content.FileProvider",
          "android:authorities": authority,
          "android:exported": "false",
          "android:grantUriPermissions": "true",
        },
        "meta-data": [
          {
            $: {
              "android:name": "android.support.FILE_PROVIDER_PATHS",
              "android:resource": "@xml/apk_update_file_paths",
            },
          },
        ],
      });
    }

    return config;
  });
};

/**
 * Android: Writes res/xml/apk_update_file_paths.xml (FileProvider paths).
 * The APK is cached in cacheDir, so <cache-path> covers it.
 */
const withApkFileProviderPaths = (config) => {
  return withDangerousMod(config, [
    "android",
    (pluginConfig) => {
      const outFile = path.join(
        pluginConfig.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "res",
        "xml",
        "apk_update_file_paths.xml",
      );
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(
        outFile,
        `<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
  <cache-path name="apk" path="."/>
</paths>
`,
        "utf8",
      );
      console.log(`[EkwePlugin] Wrote ${outFile}`);
      return pluginConfig;
    },
  ]);
};

/**
 * Android: FileProvider for handing outgoing shares to other apps, plus the
 * <queries> entry that Android 11+ package visibility needs.
 *
 * This deliberately does not reuse expo-sharing's SharingFileProvider. That
 * module builds the share intent with Intent.setTypeAndNormalize(), which
 * truncates the type at the first ";" — so "audio/ogg; codecs=opus" would
 * arrive as "audio/ogg". That parameter is what WhatsApp and Telegram require
 * to treat the file as a voice note rather than an audio document.
 */
const SHARE_PROVIDER_SUFFIX = "ekweshareprovider";

const withShareFileProvider = (config) => {
  let updatedConfig = withAndroidManifest(config, (config) => {
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(
      config.modResults,
    );
    const authority = `\${applicationId}.${SHARE_PROVIDER_SUFFIX}`;

    if (!mainApplication.provider) mainApplication.provider = [];
    if (
      !mainApplication.provider.some(
        (p) => p.$ && p.$["android:authorities"] === authority,
      )
    ) {
      mainApplication.provider.push({
        $: {
          "android:name": "androidx.core.content.FileProvider",
          "android:authorities": authority,
          "android:exported": "false",
          "android:grantUriPermissions": "true",
        },
        "meta-data": [
          {
            $: {
              "android:name": "android.support.FILE_PROVIDER_PATHS",
              "android:resource": "@xml/ekwe_share_paths",
            },
          },
        ],
      });
    }

    // Without this, queryIntentActivities() returns nothing on API 30+ and the
    // explicit per-target read grant in shareAudio() silently never happens.
    if (!config.modResults.manifest.queries) {
      config.modResults.manifest.queries = [];
    }
    const hasSendQuery = config.modResults.manifest.queries.some((q) =>
      (q.intent || []).some((i) =>
        (i.action || []).some(
          (a) => a.$["android:name"] === "android.intent.action.SEND",
        ),
      ),
    );
    if (!hasSendQuery) {
      config.modResults.manifest.queries.push({
        intent: [
          {
            action: [{ $: { "android:name": "android.intent.action.SEND" } }],
            data: [{ $: { "android:mimeType": "*/*" } }],
          },
        ],
      });
    }

    return config;
  });

  updatedConfig = withDangerousMod(updatedConfig, [
    "android",
    (pluginConfig) => {
      const outFile = path.join(
        pluginConfig.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "res",
        "xml",
        "ekwe_share_paths.xml",
      );
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(
        outFile,
        `<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
  <cache-path name="ekwe_share_cache" path="." />
  <files-path name="ekwe_share_files" path="." />
  <external-path name="ekwe_share_external" path="." />
</paths>
`,
        "utf8",
      );
      console.log(`[EkwePlugin] Wrote ${outFile}`);
      return pluginConfig;
    },
  ]);

  return updatedConfig;
};

/**
 * Android: Enables R8 optimization passes.
 *
 * The Expo template ships `getDefaultProguardFile("proguard-android.txt")`,
 * which contains `-dontoptimize` — R8 then only shrinks and obfuscates.
 * `proguard-android-optimize.txt` drops that flag (adding
 * `-optimizationpasses 5` + `-allowaccessmodification`), and AGP 9 removes the
 * old file entirely. AGP 8.12 (R8 full mode) is already enabled.
 */
const withOptimizedProguardRules = (config) => {
  return withAppBuildGradle(config, (config) => {
    const contents = config.modResults.contents;
    const legacy = 'getDefaultProguardFile("proguard-android.txt")';
    if (contents.includes(legacy)) {
      config.modResults.contents = contents.replace(
        legacy,
        'getDefaultProguardFile("proguard-android-optimize.txt")',
      );
      console.log(
        "[EkwePlugin] Using proguard-android-optimize.txt (R8 optimization enabled)",
      );
    }
    return config;
  });
};

/**
 * Combined plugin for managing all custom native Ekwe logic.
 */
const withEkweNativePermissionsAndServices = (config) => {
  let updatedConfig = withAndroidManifest(config, (config) => {
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(
      config.modResults,
    );
    const permissions = [
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_MICROPHONE",
      "android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION",
      "android.permission.RECORD_AUDIO",
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.PACKAGE_USAGE_STATS",
    ];
    if (!config.modResults.manifest["uses-permission"]) {
      config.modResults.manifest["uses-permission"] = [];
    }
    permissions.forEach((perm) => {
      if (
        !config.modResults.manifest["uses-permission"].some(
          (p) => p.$["android:name"] === perm,
        )
      ) {
        config.modResults.manifest["uses-permission"].push({
          $: { "android:name": perm },
        });
      }
    });

    const services = [
      {
        $: {
          "android:name": "expo.modules.ekwenative.orb.OrbCaptureService",
          "android:exported": "false",
          "android:foregroundServiceType": "mediaProjection",
        },
      },
    ];
    if (!mainApplication.service) mainApplication.service = [];
    services.forEach((svc) => {
      const alreadyDeclared = mainApplication.service.some(
        (s) => s.$["android:name"] === svc.$["android:name"],
      );
      if (!alreadyDeclared) {
        mainApplication.service.push(svc);
      }
    });
    return config;
  });

  updatedConfig = withAndroidIntentFilters(updatedConfig);
  updatedConfig = withTranslucentStyle(updatedConfig);
  updatedConfig = withShareActivity(updatedConfig);
  updatedConfig = withMainActivityOnNewIntent(updatedConfig);
  updatedConfig = withEchoEnvironment(updatedConfig);
  updatedConfig = withEchoDesignTokens(updatedConfig);
  updatedConfig = withApkUpdateNative(updatedConfig);
  updatedConfig = withApkFileProviderPaths(updatedConfig);
  updatedConfig = withShareFileProvider(updatedConfig);
  if (process.platform === "darwin") {
    updatedConfig = withIosAppGroup(updatedConfig);
  }
  updatedConfig = withAutofillHighlightFix(updatedConfig);
  updatedConfig = withOptimizedProguardRules(updatedConfig);
  return updatedConfig;
};

module.exports = withEkweNativePermissionsAndServices;
