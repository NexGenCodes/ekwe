import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { AlertCircle, RefreshCw, ShieldAlert } from "lucide-react";
import { ADMIN_TABS, AdminShell } from "../components/admin/AdminShell";
import {
  Button,
  ConfirmDialog,
  ToastRegion,
} from "../components/admin/primitives";
import { UsersPanel } from "../components/admin/UsersPanel";
import { BillingPanel } from "../components/admin/BillingPanel";
import { UsagePanel } from "../components/admin/UsagePanel";
import { HealthPanel } from "../components/admin/HealthPanel";
import { AuditPanel } from "../components/admin/AuditPanel";
import { ReleasesPanel } from "../components/admin/ReleasesPanel";
import type {
  AdminUser,
  AuditRow,
  HealthRes,
  Manifest,
  ManifestPayload,
  NotifyPayload,
  Tab,
  Toast,
  UsageRow,
} from "../components/admin/types";

const API = "/admin/api";
const PAGE_SIZE = 25;
const POLL_MS = 30_000;

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
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed.";
}

function isAuthError(message: string): boolean {
  return /ACCESS_SESSION_REQUIRED|\b401\b|Access token|rejected the forwarded/i.test(
    message,
  );
}

function tabFromHash(): Tab {
  const hash = window.location.hash.replace(/^#/, "");
  return ADMIN_TABS.some((item) => item.id === hash) ? (hash as Tab) : "users";
}

function pageFromSearch(params: URLSearchParams): number {
  const value = Number(params.get("page"));
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) - 1 : 0;
}

type Confirmation =
  | { kind: "publish"; payload: ManifestPayload }
  | { kind: "notify"; payload: NotifyPayload };

export default function AdminDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [error, setError] = useState<string | null>(null);
  const [authExpired, setAuthExpired] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const q = searchParams.get("q") ?? "";
  const [debouncedQ, setDebouncedQ] = useState(q.trim());
  const role = searchParams.get("role") ?? "";
  const status = searchParams.get("status") ?? "";
  const access = searchParams.get("access") ?? "";
  const page = pageFromSearch(searchParams);

  // billing tab is self-contained (BillingPanel)
  const [usage, setUsage] = useState<{
    daily: UsageRow[];
    monthly: UsageRow[];
    dailyTotal: number;
    monthlyTotal: number;
    dailyAggregate: {
      translate_count: number;
      transcribe_count: number;
      speech_chars: number;
      stream_count: number;
      ai_credits: number;
    };
    monthlyAggregate: {
      translate_count: number;
      transcribe_count: number;
      speech_chars: number;
      stream_count: number;
      ai_credits: number;
    };
    limit: number;
    offset: number;
  }>({
    daily: [],
    monthly: [],
    dailyTotal: 0,
    monthlyTotal: 0,
    dailyAggregate: {
      translate_count: 0,
      transcribe_count: 0,
      speech_chars: 0,
      stream_count: 0,
      ai_credits: 0,
    },
    monthlyAggregate: {
      translate_count: 0,
      transcribe_count: 0,
      speech_chars: 0,
      stream_count: 0,
      ai_credits: 0,
    },
    limit: 50,
    offset: 0,
  });
  const [usageUserId, setUsageUserId] = useState("");
  const [usageOffset, setUsageOffset] = useState(0);
  const [health, setHealth] = useState<HealthRes | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [manifest, setManifest] = useState<Manifest | null>(null);

  const [publishing, setPublishing] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastTimers = useRef<number[]>([]);
  const requestRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const meta = useMemo(
    () => ADMIN_TABS.find((item) => item.id === tab) ?? ADMIN_TABS[0],
    [tab],
  );

  const pushToast = useCallback(
    (tone: Toast["tone"], title: string, description?: string) => {
      const id = Date.now() + Math.random();
      setToasts((current) => [
        ...current.slice(-2),
        { id, tone, title, description },
      ]);
      const timer = window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, 6000);
      toastTimers.current.push(timer);
    },
    [],
  );

  useEffect(
    () => () => {
      toastTimers.current.forEach((timer) => window.clearTimeout(timer));
      abortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const loadAll = useCallback(
    async (silent = false) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const { signal } = controller;
      const requestId = ++requestRef.current;
      const isStale = () => requestId !== requestRef.current || signal.aborted;
      if (!silent) setRefreshing(true);
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(page * PAGE_SIZE),
        });
        if (debouncedQ) params.set("q", debouncedQ);
        if (role) params.set("role", role);
        if (status) params.set("status", status);
        if (access) params.set("access", access);

        // Fetch only what the active tab renders. Polling every 30s otherwise
        // refetches five unused endpoints on every keystroke and interval.
        const usersRequest =
          tab === "users"
            ? api<{ users?: AdminUser[]; total?: number }>(`/users?${params}`, {
                signal,
              })
            : null;
        // billing tab fetches its own data
        const usageRequest =
          tab === "usage"
            ? api<{
                daily?: UsageRow[];
                monthly?: UsageRow[];
                dailyTotal?: number;
                monthlyTotal?: number;
                dailyAggregate?: {
                  translate_count: number;
                  transcribe_count: number;
                  speech_chars: number;
                  stream_count: number;
                  ai_credits: number;
                };
                monthlyAggregate?: {
                  translate_count: number;
                  transcribe_count: number;
                  speech_chars: number;
                  stream_count: number;
                  ai_credits: number;
                };
                limit?: number;
                offset?: number;
              }>(
                `/usage?limit=50&offset=${usageOffset}${
                  usageUserId.trim()
                    ? `&userId=${encodeURIComponent(usageUserId.trim())}`
                    : ""
                }`,
                { signal },
              )
            : null;
        const healthRequest =
          tab === "health" ? api<HealthRes>("/health", { signal }) : null;
        const auditRequest =
          tab === "audit"
            ? api<{ entries?: AuditRow[] }>("/audit?limit=30", { signal })
            : null;
        const manifestRequest =
          tab === "releases"
            ? api<{ manifest?: Manifest | null }>("/update/manifest", {
                signal,
              })
            : null;

        const [
          userResult,
          usageResult,
          healthResult,
          auditResult,
          manifestResult,
        ] = await Promise.allSettled([
          usersRequest ?? Promise.resolve(null),
          usageRequest ?? Promise.resolve(null),
          healthRequest ?? Promise.resolve(null),
          auditRequest ?? Promise.resolve(null),
          manifestRequest ?? Promise.resolve(null),
        ]);

        if (isStale()) return;
        if (userResult.status === "rejected") {
          if (isAbortError(userResult.reason)) return;
          throw userResult.reason;
        }
        if (userResult.status === "fulfilled" && userResult.value) {
          setUsers(userResult.value.users ?? []);
          setTotal(userResult.value.total ?? 0);
        }

        if (usageResult.status === "fulfilled" && usageResult.value) {
          const zeroAgg = {
            translate_count: 0,
            transcribe_count: 0,
            speech_chars: 0,
            stream_count: 0,
            ai_credits: 0,
          };
          setUsage({
            daily: usageResult.value.daily ?? [],
            monthly: usageResult.value.monthly ?? [],
            dailyTotal: usageResult.value.dailyTotal ?? 0,
            monthlyTotal: usageResult.value.monthlyTotal ?? 0,
            dailyAggregate: usageResult.value.dailyAggregate ?? zeroAgg,
            monthlyAggregate: usageResult.value.monthlyAggregate ?? zeroAgg,
            limit: usageResult.value.limit ?? 50,
            offset: usageResult.value.offset ?? usageOffset,
          });
        }

        if (healthResult.status === "fulfilled" && healthResult.value) {
          setHealth(healthResult.value);
        }

        if (auditResult.status === "fulfilled" && auditResult.value) {
          setAudit(auditResult.value.entries ?? []);
        }

        if (manifestResult.status === "fulfilled" && manifestResult.value) {
          setManifest(manifestResult.value.manifest ?? null);
        }

        const failures = [
          usageResult,
          healthResult,
          auditResult,
          manifestResult,
        ].filter((result) => result.status === "rejected");
        setError(
          failures.length > 0
            ? `${failures.length} panel${failures.length === 1 ? "" : "s"} failed to refresh. Data may be stale.`
            : null,
        );
        setAuthExpired(false);
        setLastSync(new Date());
      } catch (caught) {
        if (isStale()) return;
        const message = errorMessage(caught);
        setAuthExpired(isAuthError(message));
        setError(message);
      } finally {
        if (!isStale()) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [debouncedQ, role, status, access, page, tab, usageOffset, usageUserId],
  );

  const updateUserSearch = useCallback(
    (updates: {
      q?: string;
      role?: string;
      status?: string;
      access?: string;
      page?: number;
    }) => {
      const next = new URLSearchParams(searchParams);
      next.delete("tier");
      if (updates.q !== undefined) {
        const value = updates.q.trim();
        if (value) next.set("q", value);
        else next.delete("q");
      }
      if (updates.role !== undefined) {
        if (updates.role) next.set("role", updates.role);
        else next.delete("role");
      }
      if (updates.status !== undefined) {
        if (updates.status) next.set("status", updates.status);
        else next.delete("status");
      }
      if (updates.access !== undefined) {
        if (updates.access) next.set("access", updates.access);
        else next.delete("access");
      }
      if (updates.page !== undefined) {
        if (updates.page > 0) next.set("page", String(updates.page + 1));
        else next.delete("page");
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  useEffect(() => {
    if (total === 0) return;
    const last = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
    if (page > last) updateUserSearch({ page: last });
  }, [total, page, updateUserSearch]);

  useEffect(() => {
    void loadAll(true);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadAll(true);
    }, POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void loadAll(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadAll]);

  const changeTab = (next: Tab) => {
    setTab(next);
    window.history.replaceState(null, "", `#${next}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleLogout = () => {
    window.location.assign("/cdn-cgi/access/logout");
  };

  const handleQChange = (value: string) => {
    updateUserSearch({ q: value, page: 0 });
  };

  const handleRoleChange = (value: string) => {
    updateUserSearch({ role: value, page: 0 });
  };

  const handleStatusChange = (value: string) => {
    updateUserSearch({ status: value, page: 0 });
  };

  const handleAccessChange = (value: string) => {
    updateUserSearch({ access: value, page: 0 });
  };

  const clearFilters = () => {
    setSearchParams(new URLSearchParams(), { replace: true });
    setDebouncedQ("");
  };

  const busy = publishing || notifying;

  const handleConfirm = async () => {
    if (!confirmation) return;

    if (confirmation.kind === "publish") {
      const { payload } = confirmation;
      setPublishing(true);
      try {
        await api("/update/manifest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        pushToast(
          "success",
          `Manifest published: v${payload.latest_version}`,
          "Installed apps will receive the new version gate on next launch.",
        );
        setConfirmation(null);
        await loadAll(true);
      } catch (caught) {
        const message = errorMessage(caught);
        setAuthExpired(isAuthError(message));
        pushToast("error", "Publish failed", message);
      } finally {
        setPublishing(false);
      }
      return;
    }

    const { payload } = confirmation;
    setNotifying(true);
    try {
      const result = await api<{
        sent?: number;
        deactivated?: number;
        errors?: number;
      }>("/update/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      pushToast(
        "success",
        `Update notice sent for v${payload.version}`,
        `${result.sent ?? 0} pushed · ${result.deactivated ?? 0} deactivated · ${
          result.errors ?? 0
        } errors`,
      );
      setConfirmation(null);
      await loadAll(true);
    } catch (caught) {
      const message = errorMessage(caught);
      setAuthExpired(isAuthError(message));
      pushToast("error", "Notification failed", message);
    } finally {
      setNotifying(false);
    }
  };

  const dialogContent = (() => {
    if (!confirmation) return null;
    if (confirmation.kind === "publish") {
      return {
        title: `Publish v${confirmation.payload.latest_version}?`,
        description:
          "Every installed app will read this manifest on next launch. Builds below the minimum supported code will be forced to update.",
        confirmLabel: "Publish manifest",
        tone: "primary" as const,
      };
    }
    return {
      title: `Send update notice for v${confirmation.payload.version}?`,
      description:
        "This pushes a prompt to every active Android device and cannot be recalled.",
      confirmLabel: "Send notice",
      tone: "danger" as const,
    };
  })();

  if (authExpired) {
    return (
      <div className="adm-auth-wrap">
        <div className="adm-auth-card">
          <span className="adm-auth-icon" aria-hidden="true">
            <ShieldAlert size={26} />
          </span>
          <h1>Admin session expired</h1>
          <p>
            Cloudflare Access did not accept this session. Reload to sign in
            again, or check that your email is listed in{" "}
            <code>ADMIN_EMAILS</code>.
          </p>
          {error && <p className="adm-auth-detail">{error}</p>}
          <div className="adm-auth-actions">
            <Button
              variant="primary"
              onClick={() => window.location.reload()}
              icon={<RefreshCw size={15} />}
            >
              Reload dashboard
            </Button>
            <Button variant="ghost" onClick={() => window.location.assign("/")}>
              Return to site
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <AdminShell
        tab={tab}
        onTabChange={changeTab}
        title={meta.label}
        description={meta.description}
        lastSync={lastSync}
        refreshing={refreshing}
        onRefresh={() => void loadAll(false)}
        onLogout={handleLogout}
      >
        {error && (
          <div className="adm-alert" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <div className="adm-alert-copy">
              <strong>Some data could not be refreshed</strong>
              <p>{error}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void loadAll(false)}
              icon={<RefreshCw size={14} />}
            >
              Retry
            </Button>
          </div>
        )}

        {tab === "users" && (
          <UsersPanel
            users={users}
            total={total}
            loading={loading}
            q={q}
            onQChange={handleQChange}
            role={role}
            onRoleChange={handleRoleChange}
            status={status}
            onStatusChange={handleStatusChange}
            access={access}
            onAccessChange={handleAccessChange}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={(nextPage) => updateUserSearch({ page: nextPage })}
            filtered={Boolean(debouncedQ || role || status || access)}
            onClearFilters={clearFilters}
          />
        )}

        {tab === "billing" && <BillingPanel />}

        {tab === "usage" && (
          <UsagePanel
            daily={usage.daily}
            monthly={usage.monthly}
            dailyTotal={usage.dailyTotal}
            monthlyTotal={usage.monthlyTotal}
            dailyAggregate={usage.dailyAggregate}
            monthlyAggregate={usage.monthlyAggregate}
            limit={usage.limit}
            offset={usage.offset}
            userId={usageUserId}
            onUserIdChange={(value) => {
              setUsageUserId(value);
              setUsageOffset(0);
            }}
            onOffsetChange={setUsageOffset}
            loading={loading || refreshing}
          />
        )}

        {tab === "health" && <HealthPanel health={health} loading={loading} />}

        {tab === "audit" && <AuditPanel entries={audit} loading={loading} />}

        {tab === "releases" && (
          <ReleasesPanel
            manifest={manifest}
            loading={loading}
            publishing={publishing}
            notifying={notifying}
            onPublish={(payload) =>
              setConfirmation({ kind: "publish", payload })
            }
            onNotify={(payload) => setConfirmation({ kind: "notify", payload })}
          />
        )}
      </AdminShell>

      <ConfirmDialog
        open={confirmation !== null}
        title={dialogContent?.title ?? ""}
        description={dialogContent?.description ?? ""}
        confirmLabel={dialogContent?.confirmLabel ?? "Confirm"}
        tone={dialogContent?.tone ?? "primary"}
        busy={busy}
        onConfirm={() => void handleConfirm()}
        onCancel={() => {
          if (!busy) setConfirmation(null);
        }}
      />

      <ToastRegion
        toasts={toasts}
        onDismiss={(id) =>
          setToasts((current) => current.filter((toast) => toast.id !== id))
        }
      />
    </>
  );
}
