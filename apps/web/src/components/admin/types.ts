export type Tab =
  "users" | "billing" | "usage" | "health" | "audit" | "releases";

export type UserRole = "user" | "admin";
export type AccountStatus =
  "active" | "disabled" | "suspended" | "scheduled_deletion";

export interface AdminUser {
  id: string;
  email: string;
  tier: string;
  storedTier?: "FREE" | "PREMIUM";
  role?: UserRole;
  accountStatus?: AccountStatus;
  pro_expires_at: number | null;
  display_name?: string | null;
  avatar_url?: string | null;
  avatar_icon?: string | null;
  created_at: number;
  updated_at?: number;
  isAdmin?: boolean;
  isBootstrapAdmin?: boolean;
  hasPremiumAccess?: boolean;
  effectiveTier?: "FREE" | "PREMIUM";
  disabled_at?: number | null;
  disabled_reason?: string | null;
  isDisabled?: boolean;
  suspended_at?: number | null;
  suspended_reason?: string | null;
  isSuspended?: boolean;
  deleted_at?: number | null;
  delete_after?: number | null;
  isDeletionScheduled?: boolean;
  premiumSources?: string[];
}

export interface AdminEntitlement {
  id: string;
  user_id?: string;
  plan: "premium";
  source: "staff" | "manual" | "billing" | "promo";
  status: "active" | "revoked" | "expired";
  starts_at: number;
  expires_at: number | null;
  granted_by?: string | null;
  reason?: string | null;
  external_ref?: string | null;
  created_at: number;
  updated_at?: number;
  user_email?: string | null;
  user_display_name?: string | null;
  user_role?: string | null;
}

export interface AdminIdentity {
  provider: string;
  email?: string | null;
  created_at: number;
  last_used_at: number;
}

export interface AdminSession {
  id: string;
  created_at: number;
  last_used_at: number;
  expires_at: number;
  revoked_at: number | null;
  user_agent?: string | null;
}

export interface AdminPushToken {
  id: string;
  platform: string;
  app_version?: string | null;
  is_active: number;
  last_used_at: number;
  created_at: number;
}

export interface Subscription {
  user_id: string;
  status: string;
  product_id?: string | null;
  platform: string | null;
  expires_at: number | null;
  created_at?: number;
  updated_at?: number;
  user_email?: string | null;
  user_display_name?: string | null;
  user_role?: string | null;
  user_tier?: string | null;
}

export interface Claim {
  flw_ref: string;
  user_id: string;
  tx_ref?: string | null;
  amount: number | null;
  currency: string | null;
  claimed_at: number;
  expires_at: number;
  user_email?: string | null;
  user_display_name?: string | null;
  user_role?: string | null;
}

export interface BillingList<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface BillingEvent {
  id: string;
  provider: string;
  event_key: string;
  event_type: string;
  status:
    | "succeeded"
    | "pending"
    | "failed"
    | "refunded"
    | "cancelled"
    | "expired"
    | "rejected"
    | "ignored"
    | "unknown";
  user_id: string | null;
  tx_ref: string | null;
  flw_ref: string | null;
  external_id: string | null;
  amount: number | null;
  currency: string | null;
  plan: string | null;
  platform: string | null;
  message: string | null;
  detail: string | null;
  occurred_at: number | null;
  created_at: number;
  user_email?: string | null;
  user_display_name?: string | null;
  user_role?: string | null;
}

export interface BillingAttempt {
  id: string;
  provider: string;
  user_id: string | null;
  tx_ref: string | null;
  flw_ref: string | null;
  transaction_id: string | null;
  event_type: string | null;
  status: string;
  amount: number | null;
  currency: string | null;
  plan: string | null;
  payment_type: string | null;
  processor_response: string | null;
  updated_at: number;
  user_email?: string | null;
  user_display_name?: string | null;
}

export interface BillingRefund {
  id: string;
  provider: string;
  provider_refund_id: string | null;
  transaction_id: string | null;
  tx_ref: string | null;
  flw_ref: string | null;
  user_id: string | null;
  amount_refunded: number | null;
  currency: string | null;
  status: string;
  reason: string | null;
  created_at_provider: number | null;
  updated_at: number;
  user_email?: string | null;
  user_display_name?: string | null;
}

export interface BillingDispute {
  id: string;
  provider: string;
  provider_dispute_id: string;
  transaction_id: string | null;
  tx_ref: string | null;
  flw_ref: string | null;
  user_id: string | null;
  amount: number | null;
  currency: string | null;
  status: string;
  stage: string | null;
  reason: string | null;
  evidence_due_at: number | null;
  updated_at: number;
  user_email?: string | null;
  user_display_name?: string | null;
}

export interface BillingSummary {
  activeSubscriptions: number;
  subscriptionsTotal: number;
  activePremiumEntitlements: number;
  entitlementsTotal: number;
  claimsTotal: number;
  claimsWithActiveCoverage: number;
  claimAmountsByCurrency: { currency: string; total: number; count: number }[];
  eventsTotal?: number;
  eventsSucceeded?: number;
  eventsFailed?: number;
  eventsPending?: number;
  eventsRefunded?: number;
}

export interface BillingResponse {
  summary?: BillingSummary;
  subscriptions?: BillingList<Subscription>;
  claims?: BillingList<Claim>;
  entitlements?: BillingList<AdminEntitlement>;
  events?: BillingList<BillingEvent>;
  attempts?: BillingList<BillingAttempt>;
  refunds?: BillingList<BillingRefund>;
  disputes?: BillingList<BillingDispute>;
}

export interface UsageRow {
  user_id: string;
  day?: string;
  month?: string;
  translate_count: number;
  transcribe_count: number;
  transcribe_ms?: number;
  speech_chars: number;
  stream_count?: number;
  stream_ms?: number;
  ai_credits: number;
}

export interface UsageAggregate {
  translate_count: number;
  transcribe_count: number;
  speech_chars: number;
  stream_count: number;
  ai_credits: number;
}

export interface AdminUsageResponse {
  daily: UsageRow[];
  monthly: UsageRow[];
  dailyTotal?: number;
  monthlyTotal?: number;
  dailyAggregate?: UsageAggregate;
  monthlyAggregate?: UsageAggregate;
  limit?: number;
  offset?: number;
  userId?: string | null;
}

export interface HealthProvider {
  name: string;
  status: "healthy" | "degraded" | string;
  failures?: number;
  trippedAt?: number | null;
  openUntil?: number | null;
  capabilities?: string[];
}

export interface HealthRes {
  status: string;
  timestamp: number;
  degradedProviders: string[];
  providers?: HealthProvider[];
  providerSummary?: { total: number; healthy: number; degraded: number };
  bindings: { d1: string; kv: string };
  checks?: { d1Ms: number; kvMs: number };
  pushActive: number;
  push?: { active: number; inactive: number; total: number };
}

export interface AuditRow {
  id: number;
  admin_email: string;
  action: string;
  target_user_id: string | null;
  detail?: string | null;
  created_at: number;
}

export interface Manifest {
  latest_version: string;
  latest_version_code: number;
  min_supported_version_code: number;
  download_url: string;
  checksum_sha256?: string;
  file_size?: number;
  release_notes?: string;
}

export interface ManifestPayload {
  latest_version: string;
  latest_version_code: number;
  min_supported_version_code: number;
  download_url: string;
  checksum_sha256?: string;
  file_size?: number;
  release_notes?: string;
}

export interface NotifyPayload {
  version: string;
  downloadUrl: string;
  versionCode?: number;
  checksumSha256?: string;
}

export interface ReleasePushStats {
  androidActive: number;
  active: number;
  total: number;
}

export interface ReleaseAction {
  id: number;
  admin_email: string;
  action: string;
  detail?: string | null;
  created_at: number;
}

export interface Toast {
  id: number;
  title: string;
  description?: string;
  tone: "success" | "error" | "info";
}
