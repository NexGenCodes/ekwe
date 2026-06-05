import PostHog from "posthog-react-native";

import logger from "@/utils/logger";

const API_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
const HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

function createClient(): PostHog | undefined {
  if (!API_KEY) {
    logger.debug(
      "[PostHog] EXPO_PUBLIC_POSTHOG_API_KEY is not set. Skipping initialization.",
    );
    return;
  }
  return new PostHog(API_KEY, {
    host: HOST,
    captureAppLifecycleEvents: true,
  });
}

export const posthogClient = createClient();
