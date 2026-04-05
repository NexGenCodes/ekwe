const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

const withEkweNativePermissionsAndServices = (config) => {
  return withAndroidManifest(config, (config) => {
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(
      config.modResults
    );

    // Add permissions if missing
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
          (p) => p.$['android:name'] === perm
        )
      ) {
        config.modResults.manifest['uses-permission'].push({
          $: { 'android:name': perm },
        });
      }
    });

    // Add BubbleService to application tag
    if (!mainApplication.service) {
      mainApplication.service = [];
    }
    if (
      !mainApplication.service.some(
        (s) => s.$['android:name'] === '.BubbleService'
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
};

module.exports = withEkweNativePermissionsAndServices;
