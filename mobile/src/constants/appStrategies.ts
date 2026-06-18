/**
 * Defines the behavior of the translation engine/bubble based on the foreground app.
 */

export type CaptureMode =
  | "SHARE_INTENT"
  | "MEDIA_SCAN"
  | "SYSTEM_AUDIO"
  | "MIC_FALLBACK";

export interface AppStrategy {
  packageName: string;
  appName: string;
  recommendedMode: CaptureMode;
  hideBubble?: boolean; // Should bubble hide completely in this app?
}

export const APP_STRATEGIES: Record<string, AppStrategy> = {
  // Messaging Apps (Native Share is secondary; per user request: hide bubble if app can share)
  "com.whatsapp": {
    packageName: "com.whatsapp",
    appName: "WhatsApp",
    recommendedMode: "MEDIA_SCAN",
    hideBubble: true, // User prefers native share intent
  },
  "org.telegram.messenger": {
    packageName: "org.telegram.messenger",
    appName: "Telegram",
    recommendedMode: "MEDIA_SCAN",
    hideBubble: true, // User prefers native share intent
  },

  // Dating Apps (No share intent, requires Capture/Bubble)
  "com.tinder": {
    packageName: "com.tinder",
    appName: "Tinder",
    recommendedMode: "SYSTEM_AUDIO",
    hideBubble: false,
  },
  "co.hinge.app": {
    packageName: "co.hinge.app",
    appName: "Hinge",
    recommendedMode: "SYSTEM_AUDIO",
    hideBubble: false,
  },
  "com.bumble.app": {
    packageName: "com.bumble.app",
    appName: "Bumble",
    recommendedMode: "SYSTEM_AUDIO",
    hideBubble: false,
  },
};

export const DEFAULT_STRATEGY: AppStrategy = {
  packageName: "unknown",
  appName: "Other",
  recommendedMode: "MIC_FALLBACK",
  hideBubble: true, // Default to hidden for unlisted apps
};

export const getStrategyForApp = (packageName: string | null): AppStrategy => {
  if (!packageName) return DEFAULT_STRATEGY;

  // Explicitly hide in Ekwe apps
  if (packageName === "com.anonymous.ekwe" || packageName === "com.ekwe.app") {
    return { ...DEFAULT_STRATEGY, packageName, hideBubble: true };
  }

  return (
    APP_STRATEGIES[packageName] || {
      ...DEFAULT_STRATEGY,
      packageName,
      hideBubble: true,
    }
  );
};
