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

export interface BillingSummary {
  activeSubscriptions: number;
  subscriptionsTotal: number;
  activePremiumEntitlements: number;
  entitlementsTotal: number;
  claimsTotal: number;
  claimsWithActiveCoverage: number;
  claimAmountsByCurrency: { currency: string; total: number; count: number }[];
}

export interface BillingResponse {
  summary?: BillingSummary;
  subscriptions?: BillingList<Subscription>;
  claims?: BillingList<Claim>;
  entitlements?: BillingList<AdminEntitlement>;
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

export interface HealthRes {
  status: string;
  timestamp: number;
  degradedProviders: string[];
  bindings: { d1: string; kv: string };
  pushActive: number;
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

export interface Toast {
  id: number;
  title: string;
  description?: string;
  tone: "success" | "error" | "info";
}
