import { getPosthogClient } from "@/services/posthog";

export const AnalyticsEvents = {
  // Onboarding & Auth
  ONBOARDING_COMPLETED: "onboarding_completed",
  AUTH_OTP_SENT: "auth_otp_sent",
  AUTH_OTP_FAILED: "auth_otp_failed",
  AUTH_OTP_RESENT: "auth_otp_resent",
  AUTH_VERIFY_FAILED: "auth_verify_failed",
  AUTH_NEEDS_LINK: "auth_needs_link",
  AUTH_LINKED: "auth_linked",
  AUTH_LINK_FAILED: "auth_link_failed",
  SIGN_UP: "sign_up",
  SIGN_IN: "sign_in",
  SIGN_OUT: "sign_out",
  DELETE_ACCOUNT: "delete_account",

  // Dictation
  DICTATION_STARTED: "dictation_started",
  DICTATION_CANCELLED: "dictation_cancelled",

  // Transcribing
  TRANSCRIBING_STARTED: "transcribing_started",
  TRANSCRIBING_COMPLETED: "transcribing_completed",
  TRANSCRIPTION_FAILED: "transcription_failed",

  // Translation
  TRANSLATION_COMPLETED: "translation_completed",
  TRANSLATION_FAILED: "translation_failed",

  // Billing
  BILLING_PAGE_VIEWED: "billing_page_viewed",
  BILLING_TOGGLED: "billing_toggled",
  CHECKOUT_INITIATED: "checkout_initiated",

  // Engagement
  TTS_PLAYED: "tts_played",
  RESULT_COPIED: "result_copied",
  RESULT_SHARED: "result_shared",
  RATE_PROMPT_SHOWN: "rate_prompt_shown",
  RATE_PROMPT_RATED: "rate_prompt_rated",
} as const;

type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type AnalyticsProperties = Record<string, JsonValue>;

export function track(event: string, properties?: AnalyticsProperties): void {
  const client = getPosthogClient();
  if (!client) return;
  client.capture(event, properties);
}

export function identify(
  userId: string,
  properties?: AnalyticsProperties,
): void {
  const client = getPosthogClient();
  if (!client) return;
  client.identify(userId, properties);
}

export function reset(): void {
  const client = getPosthogClient();
  if (!client) return;
  client.reset();
}

export function setPersonProperties(properties: AnalyticsProperties): void {
  const client = getPosthogClient();
  if (!client) return;
  client.setPersonProperties(properties);
}
