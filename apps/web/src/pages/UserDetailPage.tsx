import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import {
  AlertCircle,
  AlertTriangle,
  ChevronRight,
  Crown,
  KeyRound,
  Receipt,
  RefreshCw,
  ScrollText,
  ShieldBan,
  ShieldCheck,
  ShieldMinus,
  Smartphone,
  Trash2,
  UserCog,
  Wallet,
} from "lucide-react";
import { AdminShell } from "../components/admin/AdminShell";
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  CopyButton,
  ToastRegion,
} from "../components/admin/primitives";
import {
  fmtCurrency,
  fmtDate,
  fmtDateTime,
  fmtNumber,
  fmtRelative,
  fmtTimeLeft,
} from "../components/admin/format";
import type {
  AdminEntitlement,
  AdminIdentity,
  AdminPushToken,
  AdminSession,
  AdminUser,
  AuditRow,
  Claim,
  Subscription,
  Toast,
  UsageRow,
} from "../components/admin/types";

const API = "/admin/api";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const { headers, ...rest } = init ?? {};
  const res = await fetch(`${API}${path}`, {
    credentials: "include",
    cache: "no-store",
    ...rest,
    headers: { Accept: "application/json", ...headers },
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`.trim();
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      if (body?.message) message = body.message;
      else if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed.";
}

function Fact({
  label,
  value,
  mono,
  wide,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={`adm-fact${wide ? " adm-fact--wide" : ""}`}>
      <dt>{label}</dt>
      <dd className={mono ? "adm-mono" : undefined}>{value}</dd>
    </div>
  );
}

interface DetailsData {
  identities: AdminIdentity[];
  sessions: AdminSession[];
  pushTokens: AdminPushToken[];
  entitlements: AdminEntitlement[];
}

type PendingAction =
  | { kind: "pro"; isPro: boolean }
  | { kind: "role"; role: "admin" | "user" }
  | { kind: "revoke-sessions" }
  | { kind: "disable"; disabled: boolean }
  | { kind: "suspend"; suspended: boolean }
  | { kind: "schedule-delete" }
  | { kind: "cancel-delete" }
  | { kind: "delete" };

function DeleteDialog({
  email,
  busy,
  onConfirm,
  onCancel,
}: {
  email: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const ok = value.trim().toLowerCase() === email.trim().toLowerCase();

  useEffect(() => {
    inputRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [busy, onCancel]);

  return (
    <div className="adm-dialog-scrim" onMouseDown={busy ? undefined : onCancel}>
      <div
        className="adm-dialog adm-dialog--danger"
        role="dialog"
        aria-modal="true"
        aria-labelledby="adm-delete-title"
        aria-describedby="adm-delete-desc"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="adm-dialog-icon adm-dialog-icon--danger"
          aria-hidden="true"
        >
          <AlertTriangle size={20} />
        </div>
        <h2 className="adm-dialog-title" id="adm-delete-title">
          Delete account permanently?
        </h2>
        <p className="adm-dialog-desc" id="adm-delete-desc">
          This permanently removes the account and associated data (sessions,
          identities, usage, history, subscriptions/claims, push tokens). This
          cannot be undone. Type <strong>{email}</strong> to confirm.
        </p>
        <label className="adm-field" htmlFor="adm-delete-confirm">
          <span className="adm-label">Confirm email</span>
          <input
            ref={inputRef}
            id="adm-delete-confirm"
            className="adm-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={email}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
        </label>
        <div className="adm-dialog-actions">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={onConfirm}
            disabled={!ok}
            icon={<Trash2 size={15} />}
          >
            Delete account
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function UserDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const backTo =
    (location.state as { from?: string } | null)?.from || "/admin#users";

  const [user, setUser] = useState<AdminUser | null>(null);
  const [billing, setBilling] = useState<{
    subscriptions: Subscription[];
    claims: Claim[];
  }>({ subscriptions: [], claims: [] });
  const [usage, setUsage] = useState<{
    daily: UsageRow[];
    monthly: UsageRow[];
  }>({
    daily: [],
    monthly: [],
  });
  const [details, setDetails] = useState<DetailsData>({
    identities: [],
    sessions: [],
    pushTokens: [],
    entitlements: [],
  });
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [auditOffset, setAuditOffset] = useState(0);
  const [auditHasMore, setAuditHasMore] = useState(false);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditAction, setAuditAction] = useState("");
  const [auditQ, setAuditQ] = useState("");
  const [auditQDebounced, setAuditQDebounced] = useState("");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const pushToast = useCallback(
    (tone: Toast["tone"], title: string, description?: string) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t.slice(-2), { id, tone, title, description }]);
      window.setTimeout(() => {
        setToasts((t) => t.filter((x) => x.id !== id));
      }, 6000);
    },
    [],
  );

  useEffect(() => {
    const t = window.setTimeout(() => setAuditQDebounced(auditQ.trim()), 300);
    return () => window.clearTimeout(t);
  }, [auditQ]);

  const loadAudit = useCallback(
    async (
      id: string,
      offset: number,
      append: boolean,
      filters?: { action?: string; q?: string },
    ) => {
      setAuditLoading(true);
      const action = filters?.action ?? auditAction;
      const q = filters?.q ?? auditQDebounced;
      try {
        const params = new URLSearchParams({
          userId: id,
          limit: "30",
          offset: String(offset),
        });
        if (action) params.set("action", action);
        if (q) params.set("q", q);
        const a = await api<{
          entries?: AuditRow[];
          hasMore?: boolean;
          total?: number;
        }>(`/audit?${params}`);
        const entries = a.entries ?? [];
        setAudit((prev) => (append ? [...prev, ...entries] : entries));
        setAuditOffset(offset + entries.length);
        setAuditHasMore(Boolean(a.hasMore));
        setAuditTotal(typeof a.total === "number" ? a.total : entries.length);
      } catch (e) {
        if (!append)
          pushToast("error", "Could not load audit", errorMessage(e));
      } finally {
        setAuditLoading(false);
      }
    },
    [pushToast, auditAction, auditQDebounced],
  );

  const load = useCallback(
    async (silent = false) => {
      if (!userId) return;
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      const id = encodeURIComponent(userId);
      try {
        const [u, b, us, d] = await Promise.all([
          api<{ user: AdminUser }>(`/users/${id}`),
          api<{
            subscriptions?: Subscription[] | { items?: Subscription[] };
            claims?: Claim[] | { items?: Claim[] };
          }>(`/billing?userId=${id}&limit=25`),
          api<{ daily?: UsageRow[]; monthly?: UsageRow[] }>(
            `/usage?userId=${id}&limit=30`,
          ),
          api<DetailsData>(`/users/${id}/details`),
        ]);
        setUser(u.user);
        const subsRaw = b.subscriptions as
          Subscription[] | { items?: Subscription[] } | undefined;
        const claimsRaw = b.claims as Claim[] | { items?: Claim[] } | undefined;
        setBilling({
          subscriptions: Array.isArray(subsRaw)
            ? subsRaw
            : (subsRaw?.items ?? []),
          claims: Array.isArray(claimsRaw)
            ? claimsRaw
            : (claimsRaw?.items ?? []),
        });
        setUsage({ daily: us.daily ?? [], monthly: us.monthly ?? [] });
        setDetails({
          identities: d.identities ?? [],
          sessions: d.sessions ?? [],
          pushTokens: d.pushTokens ?? [],
          entitlements: d.entitlements ?? [],
        });
        setLastSync(new Date());
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [userId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!userId) return;
    setAudit([]);
    setAuditOffset(0);
    setAuditHasMore(false);
    void loadAudit(userId, 0, false, {
      action: auditAction,
      q: auditQDebounced,
    });
  }, [userId, auditAction, auditQDebounced, loadAudit]);

  const runAction = async () => {
    if (!user || !pendingAction) return;
    setBusy(true);
    try {
      if (pendingAction.kind === "pro") {
        await api(`/users/${user.id}/pro`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isPro: pendingAction.isPro, expiresAt: null }),
        });
        pushToast(
          "success",
          pendingAction.isPro
            ? "Manual premium granted"
            : "Manual premium revoked",
          pendingAction.isPro
            ? "Manual entitlement applied. Effective access reflects all active sources."
            : "Manual entitlement revoked. Other active entitlements or subscriptions still apply.",
        );
      } else if (pendingAction.kind === "role") {
        await api(`/users/${user.id}/role`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: pendingAction.role }),
        });
        pushToast(
          "success",
          pendingAction.role === "admin"
            ? "Admin role granted"
            : "Admin role removed",
          pendingAction.role === "admin"
            ? "Admin access and the default staff premium entitlement are now active."
            : "Staff admin premium entitlement removed. Other paid entitlements, if any, remain.",
        );
      } else if (pendingAction.kind === "revoke-sessions") {
        const res = await api<{ revoked?: number }>(
          `/users/${user.id}/revoke-sessions`,
          { method: "POST" },
        );
        pushToast(
          "success",
          "Sessions revoked",
          `${res.revoked ?? 0} active session(s) revoked. Active tokens may take a short time to expire where KV is unavailable.`,
        );
      } else if (pendingAction.kind === "disable") {
        await api(`/users/${user.id}/disable`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ disabled: pendingAction.disabled }),
        });
        pushToast(
          "success",
          pendingAction.disabled ? "Account disabled" : "Account enabled",
          pendingAction.disabled
            ? "Sign-in is blocked and active sessions were revoked."
            : "The account can sign in again.",
        );
      } else if (pendingAction.kind === "suspend") {
        await api(`/users/${user.id}/suspend`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ suspended: pendingAction.suspended }),
        });
        pushToast(
          "success",
          pendingAction.suspended ? "Account suspended" : "Suspension removed",
          pendingAction.suspended
            ? "Sign-in is blocked and active sessions were revoked."
            : "The account can sign in again unless otherwise blocked.",
        );
      } else if (pendingAction.kind === "schedule-delete") {
        const res = await api<{ deleteAfter?: number }>(
          `/users/${user.id}/schedule-delete`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ days: 30 }),
          },
        );
        pushToast(
          "success",
          "Deletion scheduled",
          res.deleteAfter
            ? `Scheduled for ${fmtDateTime(res.deleteAfter)} (30-day retention). Sign-in is blocked and sessions were revoked.`
            : user.email,
        );
      } else if (pendingAction.kind === "cancel-delete") {
        await api(`/users/${user.id}/cancel-delete`, { method: "POST" });
        pushToast("success", "Scheduled deletion cancelled", user.email);
      } else if (pendingAction.kind === "delete") {
        await api(`/users/${user.id}/delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmEmail: user.email }),
        });
        pushToast("success", "Account deleted", user.email);
        setPendingAction(null);
        navigate(backTo, { replace: true });
        return;
      }
      setPendingAction(null);
      await Promise.all([
        load(true),
        loadAudit(user.id, 0, false, {
          action: auditAction,
          q: auditQDebounced,
        }),
      ]);
    } catch (e) {
      pushToast("error", "Action failed", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const effectivePremium = user?.hasPremiumAccess ?? user?.tier === "PREMIUM";
  const storedPremium = (user?.storedTier ?? user?.tier) === "PREMIUM";
  const role = user?.role ?? (user?.isAdmin ? "admin" : "user");
  const accountStatus = user?.accountStatus ?? "active";
  const premiumSources = user?.premiumSources ?? [];
  const hasManualPremium =
    details.entitlements.some(
      (e) => e.source === "manual" && e.status === "active",
    ) || premiumSources.includes("manual");
  const displayName = user?.display_name?.trim() || user?.email || "Account";
  const usageTotals = usage.daily.reduce(
    (acc, row) => ({
      translate: acc.translate + (row.translate_count ?? 0),
      transcribe: acc.transcribe + (row.transcribe_count ?? 0),
      speech: acc.speech + (row.speech_chars ?? 0),
      credits: acc.credits + (row.ai_credits ?? 0),
    }),
    { translate: 0, transcribe: 0, speech: 0, credits: 0 },
  );

  const breadcrumbs = (
    <>
      <span className="adm-crumbs-root">Admin</span>
      <ChevronRight size={14} aria-hidden="true" />
      <button
        type="button"
        className="adm-crumb-link"
        onClick={() => navigate(backTo)}
      >
        Users
      </button>
      <ChevronRight size={14} aria-hidden="true" />
      <span className="adm-crumbs-current">
        {user?.email || userId || "Account"}
      </span>
    </>
  );

  const confirm = (() => {
    if (!pendingAction || !user) return null;
    if (pendingAction.kind === "pro") {
      return {
        title: pendingAction.isPro
          ? "Grant manual premium?"
          : "Revoke manual premium?",
        description: pendingAction.isPro
          ? `${user.email} will receive a manual premium entitlement (lifetime unless changed later). This affects only the manual entitlement and is audited.`
          : `${user.email} will lose the manual premium entitlement only. Billing, staff/admin, or other entitlements remain unchanged.`,
        label: pendingAction.isPro
          ? "Grant manual premium"
          : "Revoke manual premium",
        tone: pendingAction.isPro ? ("primary" as const) : ("danger" as const),
      };
    }
    if (pendingAction.kind === "role") {
      return pendingAction.role === "admin"
        ? {
            title: "Grant admin role?",
            description:
              "This grants admin access and provisions the default staff premium entitlement. The change is audited.",
            label: "Grant admin role",
            tone: "primary" as const,
          }
        : {
            title: "Remove admin role?",
            description:
              "This removes admin access and revokes the staff premium entitlement. Any separate paid or manual entitlement will remain.",
            label: "Remove admin role",
            tone: "danger" as const,
          };
    }
    if (pendingAction.kind === "revoke-sessions") {
      return {
        title: "Revoke all sessions?",
        description:
          "All active sessions for this account will be revoked. The user will need to sign in again on their devices.",
        label: "Revoke sessions",
        tone: "danger" as const,
      };
    }
    if (pendingAction.kind === "disable") {
      return pendingAction.disabled
        ? {
            title: "Disable account sign-in?",
            description:
              "This blocks new sign-ins and revokes active sessions. Existing access tokens are also rejected via the disabled-account check (best effort when KV is available). You can re-enable the account later.",
            label: "Disable account",
            tone: "danger" as const,
          }
        : {
            title: "Enable account?",
            description:
              "This allows the account to sign in again if no other block applies.",
            label: "Enable account",
            tone: "primary" as const,
          };
    }
    if (pendingAction.kind === "suspend") {
      return pendingAction.suspended
        ? {
            title: "Suspend account?",
            description:
              "This suspends the account, blocks sign-in, and revokes active sessions. Use this for policy or security holds that are distinct from deletion.",
            label: "Suspend account",
            tone: "danger" as const,
          }
        : {
            title: "Remove suspension?",
            description:
              "This removes the suspension if no other block applies.",
            label: "Remove suspension",
            tone: "primary" as const,
          };
    }
    if (pendingAction.kind === "schedule-delete") {
      return {
        title: "Schedule account deletion?",
        description:
          "The account will be blocked from sign-in, active sessions will be revoked, and it will be permanently deleted after a 30-day retention window. You can cancel the scheduled deletion before then.",
        label: "Schedule deletion",
        tone: "danger" as const,
      };
    }
    if (pendingAction.kind === "cancel-delete") {
      return {
        title: "Cancel scheduled deletion?",
        description:
          "This removes the scheduled deletion and re-enables sign-in for the account.",
        label: "Cancel scheduled deletion",
        tone: "primary" as const,
      };
    }
    return null;
  })();

  return (
    <>
      <AdminShell
        tab="users"
        onTabChange={(t) => navigate(`/admin#${t}`)}
        title={displayName}
        description={
          user ? `Account record for ${user.email}.` : "Loading account record…"
        }
        eyebrow="Account record"
        breadcrumbs={breadcrumbs}
        lastSync={lastSync}
        refreshing={refreshing || (loading && !!user)}
        onRefresh={() => void load(true)}
        onLogout={() => window.location.assign("/cdn-cgi/access/logout")}
      >
        {error && (
          <div className="adm-alert" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <div className="adm-alert-copy">
              <strong>Could not load this account</strong>
              <p>{error}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void load()}
              icon={<RefreshCw size={14} />}
            >
              Retry
            </Button>
          </div>
        )}

        {loading && !user ? (
          <div className="adm-panel adm-record-skeleton" aria-busy="true">
            <div className="adm-skeleton-table">
              {Array.from({ length: 5 }).map((_, i) => (
                <div className="adm-skeleton-row" key={i}>
                  <span className="adm-skeleton-bar" style={{ width: "30%" }} />
                  <span className="adm-skeleton-bar" style={{ width: "55%" }} />
                </div>
              ))}
            </div>
          </div>
        ) : user ? (
          <div className="adm-record">
            <section
              className={`adm-record-hero${effectivePremium ? " is-premium" : ""}${user.isDisabled || user.isDeletionScheduled ? " is-disabled" : ""}`}
              aria-label="Account summary"
            >
              <div className="adm-record-identity">
                <Avatar name={user.display_name} email={user.email} size="md" />
                <div className="adm-record-identity-copy">
                  <h2 className="adm-record-name">{displayName}</h2>
                  <p className="adm-record-email">{user.email}</p>
                  <div className="adm-chip-row">
                    <Badge tone={role === "admin" ? "success" : "neutral"} dot>
                      {role === "admin" ? "Admin role" : "User role"}
                    </Badge>
                    <Badge tone={effectivePremium ? "accent" : "neutral"} dot>
                      {effectivePremium ? "Premium access" : "Free access"}
                    </Badge>
                    {effectivePremium && premiumSources.length > 0 && (
                      <Badge tone="neutral">
                        Sources: {premiumSources.join(", ")}
                      </Badge>
                    )}
                    {user.isDeletionScheduled ||
                    accountStatus === "scheduled_deletion" ? (
                      <Badge tone="danger">Scheduled deletion</Badge>
                    ) : user.isSuspended || accountStatus === "suspended" ? (
                      <Badge tone="danger">Suspended</Badge>
                    ) : user.isDisabled || accountStatus === "disabled" ? (
                      <Badge tone="danger">Disabled</Badge>
                    ) : (
                      <Badge tone="success">Active</Badge>
                    )}
                  </div>
                </div>
              </div>
              <div className="adm-record-actions">
                <div className="adm-action-buttons">
                  <Button
                    variant={role === "admin" ? "ghost" : "secondary"}
                    onClick={() =>
                      setPendingAction({
                        kind: "role",
                        role: role === "admin" ? "user" : "admin",
                      })
                    }
                    icon={<ShieldCheck size={15} />}
                  >
                    {role === "admin" ? "Remove admin" : "Make admin"}
                  </Button>
                  <Button
                    variant={hasManualPremium ? "ghost" : "secondary"}
                    onClick={() =>
                      setPendingAction({
                        kind: "pro",
                        isPro: !hasManualPremium,
                      })
                    }
                    icon={
                      hasManualPremium ? (
                        <ShieldMinus size={15} />
                      ) : (
                        <Crown size={15} />
                      )
                    }
                  >
                    {hasManualPremium
                      ? "Revoke manual premium"
                      : "Grant manual premium"}
                  </Button>
                </div>
              </div>
            </section>

            {role === "admin" && (
              <p className="adm-note">
                <ShieldCheck size={14} aria-hidden="true" />
                Admin role includes a staff premium entitlement by default.
                Manual or billing entitlements are tracked separately and remain
                subject to their own grants.
              </p>
            )}
            {!effectivePremium ? null : premiumSources.length > 0 ? (
              <p className="adm-note">
                Effective premium sources:{" "}
                <span className="adm-mono">{premiumSources.join(", ")}</span>.
              </p>
            ) : null}
            {user.isDeletionScheduled ||
            accountStatus === "scheduled_deletion" ? (
              <p className="adm-note adm-note--danger" role="status">
                <ShieldBan size={14} aria-hidden="true" />
                Deletion is scheduled
                {user.delete_after
                  ? ` for ${fmtDateTime(user.delete_after)} (${fmtTimeLeft(user.delete_after)})`
                  : ""}
                . Sign-in is blocked and sessions were revoked.
              </p>
            ) : user.isSuspended || accountStatus === "suspended" ? (
              <p className="adm-note adm-note--danger" role="status">
                <ShieldBan size={14} aria-hidden="true" />
                Account is suspended
                {user.suspended_reason
                  ? `: ${user.suspended_reason}`
                  : "."}{" "}
                Sign-in is blocked.
              </p>
            ) : user.isDisabled || accountStatus === "disabled" ? (
              <p className="adm-note adm-note--danger" role="status">
                <ShieldBan size={14} aria-hidden="true" />
                Sign-in is disabled
                {user.disabled_reason ? `: ${user.disabled_reason}` : "."}
              </p>
            ) : null}

            <div className="adm-record-grid">
              <section
                className="adm-panel adm-record-panel"
                aria-labelledby="adm-facts-title"
              >
                <div className="adm-record-panel-head">
                  <h3 id="adm-facts-title">Account details</h3>
                </div>
                <dl className="adm-facts">
                  <Fact
                    label="User ID"
                    wide
                    mono
                    value={
                      <span className="adm-fact-inline">
                        <span title={user.id}>{user.id}</span>
                        <CopyButton value={user.id} label="Copy user ID" />
                      </span>
                    }
                  />
                  <Fact
                    label="Role"
                    value={role === "admin" ? "Admin" : "User"}
                  />
                  <Fact
                    label="Status"
                    value={accountStatus.replace("_", " ")}
                  />
                  <Fact
                    label="Joined"
                    value={
                      <span title={fmtDateTime(user.created_at)}>
                        {fmtDate(user.created_at)}{" "}
                        <span className="adm-muted">
                          ({fmtRelative(user.created_at)})
                        </span>
                      </span>
                    }
                  />
                  <Fact
                    label="Last updated"
                    value={
                      user.updated_at ? (
                        <span title={fmtDateTime(user.updated_at)}>
                          {fmtRelative(user.updated_at)}
                        </span>
                      ) : (
                        "—"
                      )
                    }
                  />
                  <Fact
                    label="Stored premium expiry"
                    wide
                    value={
                      user.pro_expires_at ? (
                        <span title={fmtDateTime(user.pro_expires_at)}>
                          {fmtDateTime(user.pro_expires_at)}{" "}
                          <span className="adm-muted">
                            ({fmtTimeLeft(user.pro_expires_at)})
                          </span>
                        </span>
                      ) : storedPremium ? (
                        "No expiry set"
                      ) : (
                        "—"
                      )
                    }
                  />
                </dl>
              </section>

              <section
                className="adm-panel adm-record-panel"
                aria-labelledby="adm-usage-title"
              >
                <div className="adm-record-panel-head">
                  <h3 id="adm-usage-title">Usage</h3>
                  <p>Recent usage totals.</p>
                </div>
                {usage.daily.length === 0 && usage.monthly.length === 0 ? (
                  <div className="adm-record-empty">
                    No usage recorded for this account.
                  </div>
                ) : usage.daily.length === 0 ? (
                  <div className="adm-record-empty">
                    No daily usage in the retained window.
                  </div>
                ) : (
                  <div className="adm-metrics">
                    <div className="adm-metric">
                      <span className="adm-metric-label">Translations</span>
                      <strong>{fmtNumber(usageTotals.translate)}</strong>
                    </div>
                    <div className="adm-metric">
                      <span className="adm-metric-label">Transcriptions</span>
                      <strong>{fmtNumber(usageTotals.transcribe)}</strong>
                    </div>
                    <div className="adm-metric">
                      <span className="adm-metric-label">
                        Speech characters
                      </span>
                      <strong>{fmtNumber(usageTotals.speech)}</strong>
                    </div>
                    <div className="adm-metric">
                      <span className="adm-metric-label">AI credits</span>
                      <strong>{fmtNumber(usageTotals.credits)}</strong>
                    </div>
                  </div>
                )}
              </section>
            </div>

            <div className="adm-record-grid">
              <RecordTable<AdminIdentity>
                title="Identities"
                icon={<KeyRound size={16} aria-hidden="true" />}
                count={details.identities.length}
                empty="No linked identities."
                columns={["Provider", "Email", "Created", "Last used"]}
                rows={details.identities}
                rowKey={(r, i) => `${r.provider}-${i}`}
                renderRow={(r) => (
                  <>
                    <td data-label="Provider">
                      <Badge tone="neutral">{r.provider}</Badge>
                    </td>
                    <td data-label="Email">{r.email || "—"}</td>
                    <td data-label="Created">{fmtRelative(r.created_at)}</td>
                    <td data-label="Last used">
                      {fmtRelative(r.last_used_at)}
                    </td>
                  </>
                )}
              />
              <RecordTable<AdminPushToken>
                title="Push tokens"
                icon={<Smartphone size={16} aria-hidden="true" />}
                count={details.pushTokens.length}
                empty="No push tokens registered."
                columns={["Platform", "App", "Status", "Last used"]}
                rows={details.pushTokens}
                rowKey={(r) => r.id}
                renderRow={(r) => (
                  <>
                    <td data-label="Platform">{r.platform}</td>
                    <td data-label="App" className="adm-mono adm-mono--soft">
                      {r.app_version || "—"}
                    </td>
                    <td data-label="Status">
                      <Badge tone={r.is_active ? "success" : "neutral"} dot>
                        {r.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td data-label="Last used">
                      {fmtRelative(r.last_used_at)}
                    </td>
                  </>
                )}
              />
            </div>

            <RecordTable<AdminSession>
              title="Sessions"
              icon={<UserCog size={16} aria-hidden="true" />}
              count={details.sessions.length}
              empty="No sessions found."
              columns={["Status", "Created", "Last used", "Expires", "Client"]}
              rows={details.sessions}
              rowKey={(r) => r.id}
              renderRow={(r) => {
                const now = Date.now();
                const revoked = r.revoked_at !== null;
                const expired = r.expires_at <= now;
                const status = revoked
                  ? "Revoked"
                  : expired
                    ? "Expired"
                    : "Active";
                return (
                  <>
                    <td data-label="Status">
                      <Badge
                        tone={
                          revoked ? "danger" : expired ? "neutral" : "success"
                        }
                        dot
                      >
                        {status}
                      </Badge>
                    </td>
                    <td data-label="Created">{fmtRelative(r.created_at)}</td>
                    <td data-label="Last used">
                      {fmtRelative(r.last_used_at)}
                    </td>
                    <td data-label="Expires">{fmtRelative(r.expires_at)}</td>
                    <td
                      data-label="Client"
                      className="adm-cell-detail"
                      title={r.user_agent ?? undefined}
                    >
                      {r.user_agent || "—"}
                    </td>
                  </>
                );
              }}
            />

            <RecordTable<Subscription>
              title="Subscriptions"
              icon={<Wallet size={16} aria-hidden="true" />}
              count={billing.subscriptions.length}
              empty="No subscription records for this account."
              columns={["Status", "Platform", "Product", "Expires", "Updated"]}
              rows={billing.subscriptions}
              rowKey={(_, i) => String(i)}
              renderRow={(s) => {
                const v = (s.status || "").toLowerCase();
                const tone =
                  v === "active"
                    ? "success"
                    : v === "expired" || v === "cancelled" || v === "canceled"
                      ? "danger"
                      : "neutral";
                return (
                  <>
                    <td data-label="Status">
                      <Badge tone={tone} dot>
                        {s.status}
                      </Badge>
                    </td>
                    <td data-label="Platform">{s.platform ?? "—"}</td>
                    <td data-label="Product">
                      <span className="adm-mono adm-mono--soft">
                        {s.product_id ?? "—"}
                      </span>
                    </td>
                    <td data-label="Expires">
                      {s.expires_at ? fmtRelative(s.expires_at) : "—"}
                    </td>
                    <td data-label="Updated">{fmtRelative(s.updated_at)}</td>
                  </>
                );
              }}
            />

            <RecordTable<Claim>
              title="Flutterwave claims"
              icon={<Receipt size={16} aria-hidden="true" />}
              count={billing.claims.length}
              empty="No Flutterwave claim/redemption records for this account."
              columns={["Reference", "Amount", "Coverage", "Claimed"]}
              rows={billing.claims}
              rowKey={(c) => c.flw_ref}
              renderRow={(c) => {
                const activeCoverage =
                  !!c.expires_at && c.expires_at > Date.now();
                return (
                  <>
                    <td data-label="Reference">
                      <span className="adm-mono" title={c.tx_ref ?? undefined}>
                        {c.flw_ref}
                      </span>
                    </td>
                    <td data-label="Amount">
                      {fmtCurrency(c.amount, c.currency)}
                    </td>
                    <td data-label="Coverage">
                      <Badge tone={activeCoverage ? "success" : "danger"} dot>
                        {activeCoverage ? "Active" : "Expired"}
                      </Badge>
                      <div className="adm-cell-sub">
                        {c.expires_at ? fmtRelative(c.expires_at) : "—"}
                      </div>
                    </td>
                    <td data-label="Claimed">{fmtRelative(c.claimed_at)}</td>
                  </>
                );
              }}
            />

            <RecordTable<AdminEntitlement>
              title="Entitlements"
              icon={<Crown size={16} aria-hidden="true" />}
              count={details.entitlements.length}
              empty="No explicit entitlement records. Effective access may still be provided by role, subscriptions, or derived cache state."
              columns={["Plan", "Source", "Status", "Expires", "Granted by"]}
              rows={details.entitlements}
              rowKey={(e) => e.id}
              renderRow={(e) => (
                <>
                  <td data-label="Plan">
                    <Badge tone="accent">{e.plan}</Badge>
                  </td>
                  <td data-label="Source">
                    <span className="adm-mono adm-mono--soft">{e.source}</span>
                  </td>
                  <td data-label="Status">
                    <Badge
                      tone={e.status === "active" ? "success" : "neutral"}
                      dot
                    >
                      {e.status}
                    </Badge>
                  </td>
                  <td data-label="Expires">
                    {e.expires_at ? fmtRelative(e.expires_at) : "—"}
                  </td>
                  <td data-label="Granted by" className="adm-cell-detail">
                    {e.granted_by || e.reason || "—"}
                  </td>
                </>
              )}
            />

            <section
              className="adm-panel adm-record-panel"
              aria-label="Admin audit"
            >
              <div className="adm-record-panel-head adm-record-panel-head--row">
                <div className="adm-record-panel-title">
                  <ScrollText size={16} aria-hidden="true" />
                  <h3>Admin audit</h3>
                </div>
                <span className="adm-record-count">
                  {fmtNumber(audit.length)}
                  {auditTotal > audit.length
                    ? ` of ${fmtNumber(auditTotal)}`
                    : ""}
                </span>
              </div>
              <div className="adm-audit-filters">
                <label className="adm-select-wrap">
                  <span className="sr-only">Filter by action</span>
                  <select
                    className="adm-select"
                    value={auditAction}
                    onChange={(e) => setAuditAction(e.target.value)}
                    aria-label="Filter audit by action"
                  >
                    <option value="">All actions</option>
                    <option value="users.role_admin">users.role_admin</option>
                    <option value="users.role_user">users.role_user</option>
                    <option value="users.grant_pro">users.grant_pro</option>
                    <option value="users.revoke_pro">users.revoke_pro</option>
                    <option value="users.revoke_sessions">
                      users.revoke_sessions
                    </option>
                    <option value="users.disable">users.disable</option>
                    <option value="users.enable">users.enable</option>
                    <option value="users.suspend">users.suspend</option>
                    <option value="users.unsuspend">users.unsuspend</option>
                    <option value="users.delete">users.delete</option>
                    <option value="users.delete_scheduled">
                      users.delete_scheduled
                    </option>
                    <option value="users.delete_cancelled">
                      users.delete_cancelled
                    </option>
                  </select>
                </label>
                <input
                  className="adm-input adm-input--sm"
                  type="search"
                  value={auditQ}
                  onChange={(e) => setAuditQ(e.target.value)}
                  placeholder="Search action, admin, detail…"
                  aria-label="Search audit entries"
                  autoComplete="off"
                />
              </div>
              {audit.length === 0 && !auditLoading ? (
                <div className="adm-record-empty">
                  {auditAction || auditQDebounced
                    ? "No audit entries match the current filters."
                    : "No admin actions have targeted this account."}
                </div>
              ) : (
                <>
                  <div
                    className="adm-table-wrap"
                    aria-busy={auditLoading || undefined}
                  >
                    <table className="adm-table">
                      <thead>
                        <tr>
                          <th scope="col">Action</th>
                          <th scope="col">Admin</th>
                          <th scope="col">Detail</th>
                          <th scope="col">When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {audit.map((e) => (
                          <tr key={e.id}>
                            <td data-label="Action">
                              <span className="adm-mono">{e.action}</span>
                            </td>
                            <td data-label="Admin">{e.admin_email}</td>
                            <td data-label="Detail" className="adm-cell-detail">
                              {e.detail || "—"}
                            </td>
                            <td
                              data-label="When"
                              title={fmtDateTime(e.created_at)}
                            >
                              {fmtRelative(e.created_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {auditHasMore && (
                    <div className="adm-record-foot">
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={auditLoading}
                        onClick={() =>
                          userId && void loadAudit(userId, auditOffset, true)
                        }
                      >
                        Load more
                      </Button>
                    </div>
                  )}
                </>
              )}
            </section>

            <section
              className="adm-panel adm-record-panel"
              aria-labelledby="adm-actions-title"
            >
              <div className="adm-record-panel-head">
                <h3 id="adm-actions-title">Account actions</h3>
                <p>Every action here is written to the audit log.</p>
              </div>
              <div className="adm-actions-grid">
                <div className="adm-action-card">
                  <div>
                    <h4>Sign-in</h4>
                    <p>
                      {user.isDeletionScheduled ||
                      accountStatus === "scheduled_deletion"
                        ? "Blocked while deletion is scheduled."
                        : user.isSuspended || accountStatus === "suspended"
                          ? `Blocked (suspended${user.suspended_reason ? `: ${user.suspended_reason}` : ""}).`
                          : user.isDisabled || accountStatus === "disabled"
                            ? `Blocked${user.disabled_reason ? `: ${user.disabled_reason}` : "."}`
                            : "Allowed on all devices."}
                    </p>
                  </div>
                  <div className="adm-action-buttons">
                    {!user.isDeletionScheduled && (
                      <>
                        <Button
                          variant={user.isDisabled ? "secondary" : "ghost"}
                          size="sm"
                          onClick={() =>
                            setPendingAction({
                              kind: "disable",
                              disabled: !user.isDisabled,
                            })
                          }
                          icon={<ShieldBan size={14} />}
                        >
                          {user.isDisabled
                            ? "Enable sign-in"
                            : "Disable sign-in"}
                        </Button>
                        <Button
                          variant={user.isSuspended ? "secondary" : "ghost"}
                          size="sm"
                          onClick={() =>
                            setPendingAction({
                              kind: "suspend",
                              suspended: !user.isSuspended,
                            })
                          }
                          icon={<ShieldBan size={14} />}
                        >
                          {user.isSuspended ? "Remove suspension" : "Suspend"}
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setPendingAction({ kind: "revoke-sessions" })
                      }
                    >
                      Revoke sessions
                    </Button>
                  </div>
                </div>
                <div className="adm-action-card adm-action-card--danger">
                  <div>
                    <h4>Deletion</h4>
                    <p>
                      {user.isDeletionScheduled && user.delete_after
                        ? `Scheduled for ${fmtDateTime(user.delete_after)} (${fmtTimeLeft(user.delete_after)}). Data is kept until then.`
                        : "Hold for 30 days, or delete permanently now."}
                    </p>
                  </div>
                  <div className="adm-action-buttons">
                    {user.isDeletionScheduled ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          setPendingAction({ kind: "cancel-delete" })
                        }
                        icon={<ShieldCheck size={14} />}
                      >
                        Cancel schedule
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setPendingAction({ kind: "schedule-delete" })
                        }
                        icon={<Trash2 size={14} />}
                      >
                        Schedule deletion
                      </Button>
                    )}
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setPendingAction({ kind: "delete" })}
                      icon={<Trash2 size={14} />}
                    >
                      Delete now
                    </Button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        ) : null}
      </AdminShell>

      {pendingAction?.kind === "delete" && user ? (
        <DeleteDialog
          email={user.email}
          busy={busy}
          onConfirm={() => void runAction()}
          onCancel={() => !busy && setPendingAction(null)}
        />
      ) : (
        <ConfirmDialog
          open={confirm !== null}
          title={confirm?.title ?? ""}
          description={confirm?.description ?? ""}
          confirmLabel={confirm?.label ?? "Confirm"}
          tone={confirm?.tone ?? "primary"}
          busy={busy}
          onConfirm={() => void runAction()}
          onCancel={() => !busy && setPendingAction(null)}
        />
      )}

      <ToastRegion
        toasts={toasts}
        onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))}
      />
    </>
  );
}

function RecordTable<T>({
  title,
  icon,
  count,
  empty,
  columns,
  rows,
  rowKey,
  renderRow,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  empty: string;
  columns: string[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  renderRow: (row: T) => React.ReactNode;
}) {
  return (
    <section className="adm-panel adm-record-panel" aria-label={title}>
      <div className="adm-record-panel-head adm-record-panel-head--row">
        <div className="adm-record-panel-title">
          {icon}
          <h3>{title}</h3>
        </div>
        <span className="adm-record-count">{fmtNumber(count)}</span>
      </div>
      {rows.length === 0 ? (
        <div className="adm-record-empty">{empty}</div>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={rowKey(row, i)}>{renderRow(row)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
