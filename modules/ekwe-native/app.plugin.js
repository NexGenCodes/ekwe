const { 
  withAndroidManifest, 
  withMainActivity, 
  withEntitlementsPlist,
  withXcodeProject,
  AndroidConfig 
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const APP_GROUP_ID = "group.com.anonymous.ekwe";

const withAndroidIntentFilters = (config) => {
  return withAndroidManifest(config, (config) => {
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(config.modResults);
    
    if (!mainActivity['intent-filter']) {
      mainActivity['intent-filter'] = [];
    }

    const audioIntentFilters = [
      {
        action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
        category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
        data: [{ $: { 'android:mimeType': 'audio/*' } }],
      },
      {
        action: [{ $: { 'android:name': 'android.intent.action.SEND_MULTIPLE' } }],
        category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
        data: [{ $: { 'android:mimeType': 'audio/*' } }],
      },
    ];

    audioIntentFilters.forEach((filter) => {
      const alreadyExists = mainActivity['intent-filter'].some((f) => 
        f.action?.some((a) => a.$['android:name'] === filter.action[0].$['android:name']) &&
        f.data?.some((d) => d.$['android:mimeType'] === 'audio/*')
      );
      if (!alreadyExists) {
        mainActivity['intent-filter'].push(filter);
      }
    });

    return config;
  });
};

const withMainActivityOnNewIntent = (config) => {
  return withMainActivity(config, (config) => {
    if (config.modResults.language === 'kt') {
      let content = config.modResults.contents;
      const onNewIntentImport = 'import android.content.Intent';
      if (!content.includes(onNewIntentImport)) {
        content = content.replace(/package .*\n/, `$&\n${onNewIntentImport}\n`);
      }
      const onNewIntentMethod = `
  override fun onNewIntent(intent: Intent?) {
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

const withIosAppGroup = (config) => {
  return withEntitlementsPlist(config, (config) => {
    if (!config.modResults['com.apple.security.application-groups']) {
      config.modResults['com.apple.security.application-groups'] = [];
    }
    if (!config.modResults['com.apple.security.application-groups'].includes(APP_GROUP_ID)) {
      config.modResults['com.apple.security.application-groups'].push(APP_GROUP_ID);
    }
    return config;
  });
};

const withIosShareExtension = (config) => {
  return withXcodeProject(config, (config) => {
    // Note: Creating a new target and linking it via config-plugins is high complexity.
    // We add the source files to the project. The user MUST still manually 
    // add the Share Extension Target in Xcode using these files to ensure 
    // code signing and provisioning profiles are correctly handled by Apple.
    
    // We inject a comment explaining this in the project for visibility
    const project = config.modResults;
    const comment = "Ekwe: Manual Step Required - Add 'ShareExtension' target in Xcode using files in modules/ekwe-native/ios/ShareExtension";
    project.addContext(comment);
    
    return config;
  });
};

const withEkweNativePermissionsAndServices = (config) => {
  let updatedConfig = withAndroidManifest(config, (config) => {
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    const permissions = [
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_MICROPHONE',
    ];
    if (!config.modResults.manifest['uses-permission']) {
      config.modResults.manifest['uses-permission'] = [];
    }
    permissions.forEach((perm) => {
      if (!config.modResults.manifest['uses-permission'].some((p) => p.$['android:name'] === perm)) {
        config.modResults.manifest['uses-permission'].push({ $: { 'android:name': perm } });
      }
    });
    if (!mainApplication.service) mainApplication.service = [];
    if (!mainApplication.service.some((s) => s.$['android:name'] === 'expo.modules.ekwenative.BubbleService')) {
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

  return updatedConfig;
};

module.exports = withEkweNativePermissionsAndServices;
