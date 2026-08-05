const fs = require('fs');
const path = require('path');

const {
  withAndroidManifest,
  withMainActivity,
  withAndroidStyles,
  withEntitlementsPlist,
  withXcodeProject,
  withDangerousMod,
  AndroidConfig,
} = require('expo/config-plugins');

const APP_GROUP_ID = 'group.com.anonymous.ekwe';

const EXT_NAME = 'ShareExtension';
const EXT_PROD_TYPE = 'com.apple.product-type.app-extension';
const EXT_BUNDLE_ID = 'com.ekwe.app.EchoShare';
const EXT_SOURCE = 'ShareViewController.swift';

/**
 * Adds Intent Filters to AndroidManifest for handling shared audio and text.
 * Intercepts expo-share-intent by stripping ACTION_SEND from MainActivity and
 * routing it to ShareActivity instead for "Ekwe Echo" (Pulse Flow).
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
    if (mainActivity['intent-filter']) {
      mainActivity['intent-filter'] = mainActivity['intent-filter'].filter(
        (filter) => {
          const actions = filter.action || [];
          const isShareAction = actions.some(
            (a) =>
              a.$['android:name'] === 'android.intent.action.SEND' ||
              a.$['android:name'] === 'android.intent.action.SEND_MULTIPLE',
          );

          if (isShareAction) {
            console.log(
              '[EkwePlugin] Stripping share intent-filter from MainActivity',
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
        activity.$['android:name'] !==
          'expo.modules.ekwenative.ShareActivity' &&
        activity['intent-filter']
      ) {
        activity['intent-filter'] = activity['intent-filter'].filter(
          (filter) => {
            const actions = filter.action || [];
            return !actions.some(
              (a) =>
                a.$['android:name'] === 'android.intent.action.SEND' ||
                a.$['android:name'] === 'android.intent.action.SEND_MULTIPLE',
            );
          },
        );
      }
    });

    // Default filters for ShareActivity if we don't have them
    const strippedFilters = [
      {
        action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
        category: [
          { $: { 'android:name': 'android.intent.category.DEFAULT' } },
        ],
        data: [
          { $: { 'android:mimeType': 'audio/*' } },
          { $: { 'android:mimeType': 'text/plain' } },
        ],
      },
      {
        action: [
          { $: { 'android:name': 'android.intent.action.SEND_MULTIPLE' } },
        ],
        category: [
          { $: { 'android:name': 'android.intent.category.DEFAULT' } },
        ],
        data: [{ $: { 'android:mimeType': 'audio/*' } }],
      },
    ];

    // 3. Inject ShareActivity into application
    if (!mainApplication.activity) mainApplication.activity = [];

    let shareActivity = mainApplication.activity.find(
      (a) => a.$['android:name'] === 'expo.modules.ekwenative.ShareActivity',
    );
    if (!shareActivity) {
      shareActivity = {
        $: {
          'android:name': 'expo.modules.ekwenative.ShareActivity',
          'android:theme': '@style/Theme.App.Translucent',
          'android:exported': 'true',
          'android:excludeFromRecents': 'true',
          'android:launchMode': 'singleTask',
          'android:taskAffinity': '',
          'android:label': 'EKWE',
        },
        'intent-filter': [],
      };
      mainApplication.activity.push(shareActivity);
    }

    if (!shareActivity['intent-filter']) {
      shareActivity['intent-filter'] = [];
    }

    // 4. Attach the filters to ShareActivity
    strippedFilters.forEach((filter) => {
      const actionXml = filter.action[0].$['android:name'];
      const alreadyExists = shareActivity['intent-filter'].some((f) =>
        f.action?.some((a) => a.$['android:name'] === actionXml),
      );

      if (!alreadyExists) {
        shareActivity['intent-filter'].push(filter);
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
    if (config.modResults.language === 'kt') {
      let content = config.modResults.contents;
      const onNewIntentImport = 'import android.content.Intent';
      if (!content.includes(onNewIntentImport)) {
        content = content.replace(/package .*\n/, `$&\n${onNewIntentImport}\n`);
      }
      const onNewIntentMethod = `
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
  }
`;
      if (!content.includes('override fun onNewIntent')) {
        content = content.replace(/\n}\s*$/, `${onNewIntentMethod}\n}`);
      }
      config.modResults.contents = content;
    }
    return config;
  });
};

/**
 * IOS: Configures App Groups for sharing persistence.
 */
const withIosAppGroup = (config) => {
  return withEntitlementsPlist(config, (config) => {
    if (!config.modResults['com.apple.security.application-groups']) {
      config.modResults['com.apple.security.application-groups'] = [];
    }
    if (
      !config.modResults['com.apple.security.application-groups'].includes(
        APP_GROUP_ID,
      )
    ) {
      config.modResults['com.apple.security.application-groups'].push(
        APP_GROUP_ID,
      );
    }
    return config;
  });
};

/**
 * IOS: Copies the ShareExtension sources into ios/ShareExtension and writes the
 * app-group entitlements file the extension needs. Runs before the build, so the
 * file references added to the Xcode project resolve at build time.
 */
const withShareExtensionFiles = (config) => {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const srcDir = path.join(
        config.modRequest.projectRoot,
        'modules/ekwe-native/ios/ShareExtension',
      );
      const destDir = path.join(config.modRequest.platformProjectRoot, EXT_NAME);
      if (!fs.existsSync(srcDir)) {
        return config;
      }
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of fs.readdirSync(srcDir)) {
        fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
      }
      const entitlementsPath = path.join(destDir, `${EXT_NAME}.entitlements`);
      if (!fs.existsSync(entitlementsPath)) {
        fs.writeFileSync(
          entitlementsPath,
          `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.application-groups</key>
  <array>
    <string>${APP_GROUP_ID}</string>
  </array>
</dict>
</plist>
`,
        );
      }
      return config;
    },
  ]);
};

/**
 * IOS: Adds the ShareExtension app-extension target to the Xcode project and
 * wires it up (source, Info.plist, entitlements, build settings, embed phase,
 * and an app -> extension target dependency).
 */
const withShareExtensionXcodeTarget = (config) => {
  return withXcodeProject(config, (config) => {
    const project = config.modResults;

    // Idempotent: the target already exists on a second prebuild.
    if (project.getTarget(EXT_PROD_TYPE)) {
      return config;
    }

    // Adds the target AND the "Embed App Extensions" copy phase on the app target.
    project.addTarget(EXT_NAME, 'app_extension', EXT_NAME, EXT_BUNDLE_ID);

    const extTarget = project.getTarget(EXT_PROD_TYPE);
    const appTarget = project.getFirstTarget();
    if (!extTarget || !appTarget) {
      return config;
    }

    // 1. Group for the extension files, attached to the project's main group.
    const group = project.addPbxGroup([], EXT_NAME, EXT_NAME, '"<group>"');
    const firstProject = project.getFirstProject();
    const mainGroupUuid =
      project.hash.project.objects.PBXProject[firstProject.uuid].mainGroup;
    project.hash.project.objects.PBXGroup[mainGroupUuid].children.push({
      value: group.uuid,
      comment: EXT_NAME,
    });

    // 2. Make sure the extension has Sources/Frameworks/Resources build phases.
    project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', extTarget.uuid, null);
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', extTarget.uuid, null);
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', extTarget.uuid, null);

    // 3. Add the Swift source to the extension's Sources phase.
    project.addSourceFile(
      `${EXT_NAME}/${EXT_SOURCE}`,
      { target: extTarget.uuid },
      group.uuid,
    );

    // 4. Add Info.plist + entitlements as plain file references (no build phase).
    project.addFile(`${EXT_NAME}/Info.plist`, group.uuid, {});
    project.addFile(`${EXT_NAME}/${EXT_NAME}.entitlements`, group.uuid, {});

    // 5. Configure the extension's Debug/Release build settings.
    const configLists = project.pbxXCConfigurationList();
    const extConfigList = configLists[extTarget.target.buildConfigurationList];
    const buildConfigs = project.pbxXCBuildConfigurationSection();
    (extConfigList.buildConfigurations || []).forEach(({ value: cfgUuid }) => {
      const settings = buildConfigs[cfgUuid].buildSettings;
      settings.GENERATE_INFOPLIST_FILE = 'NO';
      settings.INFOPLIST_FILE = `"${EXT_NAME}/Info.plist"`;
      settings.CODE_SIGN_ENTITLEMENTS = `"${EXT_NAME}/${EXT_NAME}.entitlements"`;
      settings.PRODUCT_BUNDLE_IDENTIFIER = `"${EXT_BUNDLE_ID}"`;
      settings.SWIFT_VERSION = '5.0';
      settings.TARGETED_DEVICE_FAMILY = '"1,2"';
      settings.IPHONEOS_DEPLOYMENT_TARGET = '16.4';
      settings.MARKETING_VERSION = '1.0';
      settings.CURRENT_PROJECT_VERSION = '1';
      settings.SKIP_INSTALL = 'YES';
      settings.LD_RUNPATH_SEARCH_PATHS =
        '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"';
    });

    // 6. App target depends on the extension (build order). The fresh Expo
    //    project has no PBXContainerItemProxy/PBXTargetDependency sections yet,
    //    and xcode's addTargetDependency silently no-ops without them.
    project.hash.project.objects['PBXContainerItemProxy'] =
      project.hash.project.objects['PBXContainerItemProxy'] || {};
    project.hash.project.objects['PBXTargetDependency'] =
      project.hash.project.objects['PBXTargetDependency'] || {};
    project.addTargetDependency(appTarget.uuid, [extTarget.uuid]);

    return config;
  });
};

/**
 * Creates the ShareActivity.kt source file.
 */
const withShareActivity = (config) => {
  return withMainActivity(config, (config) => {
    // This plugin placeholder manages the ShareActivity registration logic.
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
        name: 'Theme.App.Translucent',
        parent: 'Theme.AppCompat.DayNight.NoActionBar',
      },
      item: [
        { $: { name: 'android:windowIsTranslucent' }, _: 'true' },
        {
          $: { name: 'android:windowBackground' },
          _: '@android:color/transparent',
        },
        { $: { name: 'android:windowContentOverlay' }, _: '@null' },
        { $: { name: 'android:windowNoTitle' }, _: 'true' },
        { $: { name: 'android:windowIsFloating' }, _: 'false' },
        { $: { name: 'android:backgroundDimEnabled' }, _: 'false' }, // We handle our own scrim in RN/native
        {
          $: { name: 'android:windowAnimationStyle' },
          _: '@android:style/Animation.Translucent',
        },
      ],
    };

    if (!config.modResults.resources.style) {
      config.modResults.resources.style = [];
    }

    const existingStyleIndex = config.modResults.resources.style.findIndex(
      (s) => s.$.name === 'Theme.App.Translucent',
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
    resources.$['xmlns:tools'] = 'http://schemas.android.com/tools';

    styles.forEach((style) => {
      const parent = style.$.parent || '';
      if (parent.includes('Theme.AppCompat') || parent.includes('Theme.Material')) {
        if (!style.item) style.item = [];
        if (!style.item.some((i) => i.$.name === 'android:autofilledHighlight')) {
          style.item.push({
            $: { name: 'android:autofilledHighlight' },
            _: '@android:color/transparent',
          });
          style.$['tools:targetApi'] = '26';
        }
      }
    });
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
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_MICROPHONE',
    ];
    if (!config.modResults.manifest['uses-permission']) {
      config.modResults.manifest['uses-permission'] = [];
    }
    permissions.forEach((perm) => {
      if (
        !config.modResults.manifest['uses-permission'].some(
          (p) => p.$['android:name'] === perm,
        )
      ) {
        config.modResults.manifest['uses-permission'].push({
          $: { 'android:name': perm },
        });
      }
    });
    return config;
  });

  updatedConfig = withAndroidIntentFilters(updatedConfig);
  updatedConfig = withTranslucentStyle(updatedConfig);
  updatedConfig = withShareActivity(updatedConfig);
  updatedConfig = withMainActivityOnNewIntent(updatedConfig);
  if (process.platform === 'darwin') {
    updatedConfig = withIosAppGroup(updatedConfig);
    updatedConfig = withShareExtensionFiles(updatedConfig);
    updatedConfig = withShareExtensionXcodeTarget(updatedConfig);
  }
  updatedConfig = withAutofillHighlightFix(updatedConfig);
  return updatedConfig;
};

module.exports = withEkweNativePermissionsAndServices;
