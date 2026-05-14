const {
  withAndroidManifest,
  withMainActivity,
  withAndroidStyles,
  withEntitlementsPlist,
  withXcodeProject,
  withAppDelegate,
  AndroidConfig,
} = require('@expo/config-plugins');

const APP_GROUP_ID = 'group.com.anonymous.ekwe';

/**
 * Adds Intent Filters to AndroidManifest for handling shared audio and text.
 * Intercepts expo-share-intent by stripping ACTION_SEND from MainActivity and 
 * routing it to ShareActivity instead for "Ekwe Echo" (Pulse Flow).
 */
const withAndroidIntentFilters = (config) => {
  return withAndroidManifest(config, (config) => {
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(config.modResults);
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);

    // 1. Force Remove SEND/SEND_MULTIPLE intent filters from MainActivity
    // This is critical to prevent "Double App Icon" in the share tray
    if (mainActivity['intent-filter']) {
      mainActivity['intent-filter'] = mainActivity['intent-filter'].filter(filter => {
        const actions = filter.action || [];
        const isShareAction = actions.some(
          a => a.$['android:name'] === 'android.intent.action.SEND' || 
               a.$['android:name'] === 'android.intent.action.SEND_MULTIPLE'
        );
        
        if (isShareAction) {
          console.log('[EkwePlugin] Stripping share intent-filter from MainActivity');
          return false; // Remove it
        }
        return true; // Keep it
      });
    }

    // 2. EXTRA SAFETY: Strip filters from any other activities that might have been injected
    (mainApplication.activity || []).forEach(activity => {
      if (activity.$['android:name'] !== 'expo.modules.ekwenative.ShareActivity' && activity['intent-filter']) {
        activity['intent-filter'] = activity['intent-filter'].filter(filter => {
          const actions = filter.action || [];
          return !actions.some(
            a => a.$['android:name'] === 'android.intent.action.SEND' || 
                 a.$['android:name'] === 'android.intent.action.SEND_MULTIPLE'
          );
        });
      }
    });

    // Default filters for ShareActivity if we don't have them
    const strippedFilters = [
      {
        action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
        category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
        data: [{ $: { 'android:mimeType': 'audio/*' } }, { $: { 'android:mimeType': 'text/plain' } }],
      },
      {
        action: [{ $: { 'android:name': 'android.intent.action.SEND_MULTIPLE' } }],
        category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
        data: [{ $: { 'android:mimeType': 'audio/*' } }],
      }
    ];

    // 3. Inject ShareActivity into application
    if (!mainApplication.activity) mainApplication.activity = [];
    
    let shareActivity = mainApplication.activity.find(
      (a) => a.$['android:name'] === 'expo.modules.ekwenative.ShareActivity'
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
          'android:label': 'EKWE'
        },
        'intent-filter': []
      };
      mainApplication.activity.push(shareActivity);
    }
    
    if (!shareActivity['intent-filter']) {
      shareActivity['intent-filter'] = [];
    }

    // 4. Attach the filters to ShareActivity
    strippedFilters.forEach((filter) => {
      const actionXml = filter.action[0].$['android:name'];
      const alreadyExists = shareActivity['intent-filter'].some(
        (f) => f.action?.some((a) => a.$['android:name'] === actionXml)
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
        { $: { name: 'android:windowBackground' }, _: '@android:color/transparent' },
        { $: { name: 'android:windowContentOverlay' }, _: '@null' },
        { $: { name: 'android:windowNoTitle' }, _: 'true' },
        { $: { name: 'android:windowIsFloating' }, _: 'false' },
        { $: { name: 'android:backgroundDimEnabled' }, _: 'false' }, // We handle our own scrim in RN/native
        { $: { name: 'android:windowAnimationStyle' }, _: '@android:style/Animation.Translucent' },
      ],
    };

    if (!config.modResults.resources.style) {
      config.modResults.resources.style = [];
    }

    const existingStyleIndex = config.modResults.resources.style.findIndex(
      (s) => s.$.name === 'Theme.App.Translucent'
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
      'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
      'android.permission.FOREGROUND_SERVICE_MEDIA_PROCESSING',
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
          'android:foregroundServiceType': 'microphone|dataSync|mediaProcessing',
          'android:exported': 'false',
        },
      });
    }
    return config;
  });

  updatedConfig = withAndroidIntentFilters(updatedConfig);
  updatedConfig = withTranslucentStyle(updatedConfig);
  updatedConfig = withShareActivity(updatedConfig);
  updatedConfig = withMainActivityOnNewIntent(updatedConfig);
  updatedConfig = withIosAppGroup(updatedConfig);
  updatedConfig = withIosShareExtension(updatedConfig);
  updatedConfig = withNitroIOSAppDelegate(updatedConfig);

  return updatedConfig;
};

module.exports = withEkweNativePermissionsAndServices;
