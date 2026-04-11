const {
  withAndroidManifest,
  withMainActivity,
  withEntitlementsPlist,
  withXcodeProject,
  withAppDelegate,
  AndroidConfig,
} = require('@expo/config-plugins');

const APP_GROUP_ID = 'group.com.anonymous.ekwe';

/**
 * Adds Intent Filters to AndroidManifest for handling shared audio and text.
 */
const withAndroidIntentFilters = (config) => {
  return withAndroidManifest(config, (config) => {
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(
      config.modResults,
    );

    if (!mainActivity['intent-filter']) {
      mainActivity['intent-filter'] = [];
    }

    const intentFilters = [
      // 1. Single file sharing (Audio, but also catch-all */* for robust support)
      {
        action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
        category: [
          { $: { 'android:name': 'android.intent.category.DEFAULT' } },
        ],
        data: [{ $: { 'android:mimeType': 'audio/*' } }],
      },
      {
        action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
        category: [
          { $: { 'android:name': 'android.intent.category.DEFAULT' } },
        ],
        data: [{ $: { 'android:mimeType': 'text/plain' } }],
      },
      {
        action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
        category: [
          { $: { 'android:name': 'android.intent.category.DEFAULT' } },
        ],
        data: [{ $: { 'android:mimeType': '*/*' } }],
      },
      // 2. Multiple file sharing
      {
        action: [
          { $: { 'android:name': 'android.intent.action.SEND_MULTIPLE' } },
        ],
        category: [
          { $: { 'android:name': 'android.intent.category.DEFAULT' } },
        ],
        data: [{ $: { 'android:mimeType': 'audio/*' } }],
      },
      {
        action: [
          { $: { 'android:name': 'android.intent.action.SEND_MULTIPLE' } },
        ],
        category: [
          { $: { 'android:name': 'android.intent.category.DEFAULT' } },
        ],
        data: [{ $: { 'android:mimeType': '*/*' } }],
      },
    ];

    intentFilters.forEach((filter) => {
      const mime = filter.data[0].$['android:mimeType'];
      const action = filter.action[0].$['android:name'];

      const alreadyExists = mainActivity['intent-filter'].some(
        (f) =>
          f.action?.some((a) => a.$['android:name'] === action) &&
          f.data?.some((d) => d.$['android:mimeType'] === mime),
      );

      if (!alreadyExists) {
        mainActivity['intent-filter'].push(filter);
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
 * IOS: Placeholder and comment for manual Share Extension target setup.
 */
const withIosShareExtension = (config) => {
  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const comment =
      "Ekwe: Manual Step Required - Add 'ShareExtension' target in Xcode using files in modules/ekwe-native/ios/ShareExtension";
    project.addContext(comment);
    return config;
  });
};

/**
 * IOS: Injects NotificationCenter broadcasts required by Nitro Share Intent into AppDelegate.
 */
const withNitroIOSAppDelegate = (config) => {
  return withAppDelegate(config, (config) => {
    const contents = config.modResults.contents;

    // 1. Inject broadcast into didFinishLaunchingWithOptions
    if (!contents.includes('AppDidFinishLaunching')) {
      const launchMethod =
        '- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions';
      const replacement = `
  [[NSNotificationCenter defaultCenter] postNotificationName:@"AppDidFinishLaunching" object:nil];
`;
      config.modResults.contents = contents.replace(
        launchMethod,
        `${launchMethod} {\n${replacement}`,
      );
    }

    // 2. Inject broadcast into openURL
    if (!contents.includes('ShareIntentReceived')) {
      const openURLMethod =
        '- (BOOL)application:(UIApplication *)application openURL:(NSURL *)url options:(NSDictionary<UIApplicationOpenURLOptionsKey,id> *)options';
      if (contents.includes(openURLMethod)) {
        config.modResults.contents = contents.replace(
          openURLMethod,
          `${openURLMethod} {\n  [[NSNotificationCenter defaultCenter] postNotificationName:@"ShareIntentReceived" object:nil userInfo:@{@"url": url}];\n`,
        );
      } else {
        const endOfImpl = '@end';
        const customOpenURL = `
- (BOOL)application:(UIApplication *)application openURL:(NSURL *)url options:(NSDictionary<UIApplicationOpenURLOptionsKey,id> *)options {
  [[NSNotificationCenter defaultCenter] postNotificationName:@"ShareIntentReceived" object:nil userInfo:@{@"url": url}];
  return [super application:application openURL:url options:options];
}
`;
        config.modResults.contents = contents.replace(
          new RegExp(`${endOfImpl}$`),
          `${customOpenURL}\n${endOfImpl}`,
        );
      }
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
      'android.permission.SYSTEM_ALERT_WINDOW',
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
    if (!mainApplication.service) mainApplication.service = [];
    if (
      !mainApplication.service.some(
        (s) => s.$['android:name'] === 'expo.modules.ekwenative.BubbleService',
      )
    ) {
      mainApplication.service.push({
        $: {
          'android:name': 'expo.modules.ekwenative.BubbleService',
          'android:foregroundServiceType': 'microphone',
          'android:exported': 'false',
        },
      });
    }
    return config;
  });

  updatedConfig = withAndroidIntentFilters(updatedConfig);
  updatedConfig = withMainActivityOnNewIntent(updatedConfig);
  updatedConfig = withIosAppGroup(updatedConfig);
  updatedConfig = withIosShareExtension(updatedConfig);
  updatedConfig = withNitroIOSAppDelegate(updatedConfig);

  return updatedConfig;
};

module.exports = withEkweNativePermissionsAndServices;
