import PostHog from "posthog-react-native";

import { settings$ } from "@/store/settings";
import logger from "@/utils/logger";

const API_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
const HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

let _client: PostHog | undefined;

function hasConsent(): boolean {
  return settings$.analyticsConsent.get();
}

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
    // Privacy: disable GeoIP / IP-derived location enrichment.
    disableGeoip: true,
    // Privacy: only create person profiles for identified users.
    personProfiles: "identified_only",
    // Session replay only runs while this client exists, which is gated on
    // analytics consent (see getPosthogClient). Mask text/images so
    // transcription content never leaks into replays.
    enableSessionReplay: true,
    sessionReplayConfig: {
      maskAllTextInputs: true,
      maskAllImages: true,
      maskAllSandboxedViews: true,
      captureNetworkTelemetry: false,
    },
  });
}

export function getPosthogClient(): PostHog | undefined {
  if (!hasConsent()) return undefined;
  if (!_client) {
    _client = createClient();
  }
  return _client;
}
