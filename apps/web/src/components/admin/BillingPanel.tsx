import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  AlertCircle,
  CreditCard,
  Receipt,
  RefreshCw,
  Search,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  CopyButton,
  EmptyState,
  Pagination,
  SegmentedControl,
  StatCard,
  TableSkeleton,
} from "./primitives";
import type { BadgeTone } from "./primitives";
import {
  fmtCurrency,
  fmtDateTime,
  fmtNumber,
  fmtRelative,
  fmtTimeLeft,
  shortId,
} from "./format";
import type {
  AdminEntitlement,
  BillingList,
  BillingResponse,
  BillingSummary,
  Claim,
  Subscription,
} from "./types";

const API = "/admin/api";
const PAGE_SIZE = 25;

type View = "entitlements" | "subscriptions" | "claims";

const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: "entitlements", label: "Entitlements" },
  { value: "subscriptions", label: "Subscriptions" },
  { value: "claims", label: "Claims" },
];

function titleCase(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function statusTone(status: string): BadgeTone {
  const v = status.toLowerCase();
  if (["active", "paid", "succeeded", "completed"].includes(v))
    return "success";
  if (["pending", "processing", "trialing", "open"].includes(v))
    return "warning";
  if (
    [
      "revoked",
      "expired",
      "cancelled",
      "canceled",
      "failed",
      "refunded",
    ].includes(v)
  )
    return "danger";
  return "neutral";
}

function sourceLabel(source: string): string {
  if (source === "staff") return "Staff/admin";
  if (source === "manual") return "Manual grant";
  if (source === "billing") return "Billing";
  if (source === "promo") return "Promo";
  return titleCase(source);
}

function coverageState(expiresAt: number, now: number): "active" | "expired" {
  return expiresAt > now ? "active" : "expired";
}

async function fetchBilling(params: URLSearchParams): Promise<BillingResponse> {
  const res = await fetch(`${API}/billing?${params.toString()}`, {
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`.trim();
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      if (body?.message) message = body.message;
      else if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message || "Failed to load billing data.");
  }
  return (await res.json()) as BillingResponse;
}

function UserCell({
  userId,
  email,
  name,
  onOpen,
}: {
  userId: string;
  email?: string | null;
  name?: string | null;
  onOpen: () => void;
}) {
  const primary = (email || name || "").trim() || shortId(userId, 10);
  const secondary = email && name ? name : !email ? shortId(userId, 12) : null;
  return (
    <div className="adm-user-copy">
      <button type="button" className="adm-row-link" onClick={onOpen}>
        {primary}
      </button>
      {secondary ? (
        <span className="adm-user-meta">
          <span className="adm-mono">{secondary}</span>
        </span>
      ) : null}
    </div>
  );
}

export function BillingPanel() {
  const navigate = useNavigate();
  const [view, setView] = useState<View>("entitlements");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [platform, setPlatform] = useState("");
  const [coverage, setCoverage] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [entitlements, setEntitlements] =
    useState<BillingList<AdminEntitlement> | null>(null);
  const [subscriptions, setSubscriptions] =
    useState<BillingList<Subscription> | null>(null);
  const [claims, setClaims] = useState<BillingList<Claim> | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setPage(0);
  }, [view, debouncedQ, status, source, platform, coverage]);

  useEffect(() => {
    setStatus("");
    setSource("");
    setPlatform("");
    setCoverage("");
    setQ("");
    setDebouncedQ("");
    setPage(0);
  }, [view]);

  const openUser = useCallback(
    (userId: string) => {
      navigate(`/admin/users/${encodeURIComponent(userId)}`, {
        state: { from: "/admin#billing" },
      });
    },
    [navigate],
  );

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          section: view,
          limit: String(PAGE_SIZE),
          offset: String(page * PAGE_SIZE),
        });
        if (debouncedQ) params.set("q", debouncedQ);
        if (status) params.set("status", status);
        if (view === "entitlements" && source) params.set("source", source);
        if (view === "subscriptions" && platform)
          params.set("platform", platform);
        if (view === "claims" && coverage) params.set("coverage", coverage);
        const data = await fetchBilling(params);
        if (data.summary) setSummary(data.summary);
        if (data.entitlements) setEntitlements(data.entitlements);
        if (data.subscriptions) setSubscriptions(data.subscriptions);
        if (data.claims) setClaims(data.claims);
        setLoadedAt(new Date());
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Failed to load billing data.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [view, page, debouncedQ, status, source, platform, coverage],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const activeList =
    view === "entitlements"
      ? entitlements
      : view === "subscriptions"
        ? subscriptions
        : claims;
  const total = activeList?.total ?? 0;
  const itemsCount =
    view === "entitlements"
      ? (entitlements?.items.length ?? 0)
      : view === "subscriptions"
        ? (subscriptions?.items.length ?? 0)
        : (claims?.items.length ?? 0);

  const filtered = Boolean(
    debouncedQ || status || source || platform || coverage,
  );

  const clearFilters = () => {
    setQ("");
    setDebouncedQ("");
    setStatus("");
    setSource("");
    setPlatform("");
    setCoverage("");
    setPage(0);
  };

  const amountSummary = useMemo(() => {
    const rows = summary?.claimAmountsByCurrency ?? [];
    if (rows.length === 0) return "No claim amounts recorded";
    return rows
      .map((r) => `${fmtCurrency(r.total, r.currency)} (${fmtNumber(r.count)})`)
      .join(" · ");
  }, [summary]);

  const now = Date.now();

  return (
    <>
      <div className="adm-stats">
        <StatCard
          label="Active subscriptions"
          value={fmtNumber(summary?.activeSubscriptions ?? 0)}
          hint={`${fmtNumber(summary?.subscriptionsTotal ?? 0)} total records`}
          icon={<Wallet size={17} />}
          tone="success"
        />
        <StatCard
          label="Active premium entitlements"
          value={fmtNumber(summary?.activePremiumEntitlements ?? 0)}
          hint={`${fmtNumber(summary?.entitlementsTotal ?? 0)} total records`}
          icon={<ShieldCheck size={17} />}
          tone="accent"
        />
        <StatCard
          label="Claim records"
          value={fmtNumber(summary?.claimsTotal ?? 0)}
          hint={`${fmtNumber(summary?.claimsWithActiveCoverage ?? 0)} with active coverage window`}
          icon={<Receipt size={17} />}
        />
        <StatCard
          label="Claimed amounts"
          value={
            summary ? fmtNumber(summary.claimAmountsByCurrency.length) : "—"
          }
          hint={amountSummary}
          icon={<CreditCard size={17} />}
        />
      </div>

      <section className="adm-panel" aria-label="Billing records">
        <div className="adm-toolbar">
          <div className="adm-search">
            <Search size={16} className="adm-search-icon" aria-hidden="true" />
            <input
              className="adm-input adm-search-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={
                view === "claims"
                  ? "Search user, email, tx/flw reference…"
                  : "Search user, email, ID, or details…"
              }
              aria-label="Search billing records"
              type="search"
              autoComplete="off"
            />
          </div>
          <div className="adm-toolbar-end">
            <SegmentedControl
              value={view}
              options={VIEW_OPTIONS}
              onChange={setView}
              ariaLabel="Billing view"
            />
          </div>
        </div>

        <div className="adm-toolbar adm-toolbar--inset">
          <div className="adm-toolbar-end" style={{ flexWrap: "wrap", gap: 8 }}>
            {view === "entitlements" && (
              <>
                <label className="adm-select-wrap">
                  <span className="sr-only">Source</span>
                  <select
                    className="adm-select"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    aria-label="Filter by source"
                  >
                    <option value="">All sources</option>
                    <option value="billing">Billing</option>
                    <option value="manual">Manual</option>
                    <option value="staff">Staff/admin</option>
                    <option value="promo">Promo</option>
                  </select>
                </label>
                <label className="adm-select-wrap">
                  <span className="sr-only">Status</span>
                  <select
                    className="adm-select"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    aria-label="Filter by status"
                  >
                    <option value="">All statuses</option>
                    <option value="active">Active</option>
                    <option value="revoked">Revoked</option>
                    <option value="expired">Expired</option>
                  </select>
                </label>
              </>
            )}
            {view === "subscriptions" && (
              <>
                <label className="adm-select-wrap">
                  <span className="sr-only">Status</span>
                  <select
                    className="adm-select"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    aria-label="Filter by status"
                  >
                    <option value="">All statuses</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="expired">Expired</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </label>
                <label className="adm-select-wrap">
                  <span className="sr-only">Platform</span>
                  <select
                    className="adm-select"
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value)}
                    aria-label="Filter by platform"
                  >
                    <option value="">All platforms</option>
                    <option value="web">Web</option>
                    <option value="ios">iOS</option>
                    <option value="android">Android</option>
                  </select>
                </label>
              </>
            )}
            {view === "claims" && (
              <label className="adm-select-wrap">
                <span className="sr-only">Coverage</span>
                <select
                  className="adm-select"
                  value={coverage}
                  onChange={(e) => setCoverage(e.target.value)}
                  aria-label="Filter by coverage window"
                >
                  <option value="">All coverage states</option>
                  <option value="active">Active coverage window</option>
                  <option value="expired">Expired coverage window</option>
                </select>
              </label>
            )}
            {filtered && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                icon={<X size={15} />}
              >
                Clear
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void load(true)}
              loading={refreshing}
              icon={<RefreshCw size={14} />}
            >
              Refresh
            </Button>
          </div>
        </div>

        {error ? (
          <div
            className="adm-alert"
            role="alert"
            style={{ margin: "12px 16px" }}
          >
            <AlertCircle size={18} aria-hidden="true" />
            <div className="adm-alert-copy">
              <strong>Could not load billing data</strong>
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
        ) : null}

        <div style={{ padding: "0 16px 8px", fontSize: 12, opacity: 0.8 }}>
          {view === "entitlements" && (
            <span>
              Entitlements are canonical access grants (staff, manual, billing,
              promo). Effective access may also reflect role and subscriptions.
            </span>
          )}
          {view === "subscriptions" && (
            <span>
              Stored subscription records correlated with billing access.
              Provider lifecycle detail is limited to available fields.
            </span>
          )}
          {view === "claims" && (
            <span>
              Flutterwave claims are verified redemption/coverage records
              (tx/flw reference, amount, coverage window), not a full payment,
              refund, or dispute ledger.
            </span>
          )}
          {loadedAt ? (
            <span className="adm-muted">
              {" "}
              · Updated {fmtRelative(loadedAt.getTime())}
            </span>
          ) : null}
        </div>

        {loading && itemsCount === 0 && !error ? (
          <TableSkeleton rows={7} columns={6} />
        ) : view === "entitlements" ? (
          <EntitlementsTable
            rows={entitlements?.items ?? []}
            total={total}
            loading={loading}
            filtered={filtered}
            onClear={clearFilters}
            onOpenUser={openUser}
            now={now}
          />
        ) : view === "subscriptions" ? (
          <SubscriptionsTable
            rows={subscriptions?.items ?? []}
            total={total}
            loading={loading}
            filtered={filtered}
            onClear={clearFilters}
            onOpenUser={openUser}
            now={now}
          />
        ) : (
          <ClaimsTable
            rows={claims?.items ?? []}
            total={total}
            loading={loading}
            filtered={filtered}
            onClear={clearFilters}
            onOpenUser={openUser}
            now={now}
          />
        )}

        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={setPage}
          disabled={loading || refreshing}
        />
      </section>
    </>
  );
}

function EmptyBilling({
  filtered,
  onClear,
  title,
  description,
}: {
  filtered: boolean;
  onClear: () => void;
  title: string;
  description: string;
}) {
  return (
    <EmptyState
      icon={<Receipt size={22} />}
      title={filtered ? "No records match those filters" : title}
      description={
        filtered ? "Try adjusting or clearing filters." : description
      }
      action={
        filtered ? (
          <Button variant="secondary" size="sm" onClick={onClear}>
            Clear filters
          </Button>
        ) : undefined
      }
    />
  );
}

function EntitlementsTable({
  rows,
  loading,
  filtered,
  onClear,
  onOpenUser,
  now,
  total,
}: {
  rows: AdminEntitlement[];
  total: number;
  loading: boolean;
  filtered: boolean;
  onClear: () => void;
  onOpenUser: (id: string) => void;
  now: number;
}) {
  if (!loading && rows.length === 0) {
    return (
      <EmptyBilling
        filtered={filtered}
        onClear={onClear}
        title="No entitlement records"
        description="Premium entitlements (staff, manual, billing, promo) appear here when granted or synchronized."
      />
    );
  }
  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <thead>
          <tr>
            <th scope="col">Account</th>
            <th scope="col">Source</th>
            <th scope="col">Status</th>
            <th scope="col">Starts / Expires</th>
            <th scope="col">Granted by / Reason</th>
            <th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const userId = e.user_id ?? "";
            const activeNow =
              e.status === "active" &&
              e.starts_at <= now &&
              (e.expires_at == null || e.expires_at > now);
            return (
              <tr key={e.id}>
                <td className="adm-cell-primary" data-label="Account">
                  {userId ? (
                    <UserCell
                      userId={userId}
                      email={e.user_email}
                      name={e.user_display_name}
                      onOpen={() => onOpenUser(userId)}
                    />
                  ) : (
                    "—"
                  )}
                </td>
                <td data-label="Source">
                  <Badge
                    tone={e.source === "billing" ? "accent" : "neutral"}
                    dot
                  >
                    {sourceLabel(e.source)}
                  </Badge>
                  <div className="adm-cell-sub adm-mono adm-mono--soft">
                    {e.plan}
                  </div>
                </td>
                <td data-label="Status">
                  <div
                    className="adm-chip-row"
                    style={{ gap: 6, flexWrap: "wrap" }}
                  >
                    <Badge tone={statusTone(e.status)} dot>
                      {titleCase(e.status)}
                    </Badge>
                    {e.status === "active" && !activeNow ? (
                      <Badge tone="warning">Not currently effective</Badge>
                    ) : null}
                  </div>
                </td>
                <td data-label="Starts / Expires">
                  <div
                    className="adm-cell-sub"
                    title={fmtDateTime(e.starts_at)}
                  >
                    Starts {fmtRelative(e.starts_at)}
                  </div>
                  <div
                    title={e.expires_at ? fmtDateTime(e.expires_at) : undefined}
                  >
                    {e.expires_at
                      ? `Expires ${fmtTimeLeft(e.expires_at)}`
                      : "No expiry"}
                  </div>
                </td>
                <td
                  data-label="Granted by / Reason"
                  className="adm-cell-detail"
                >
                  <div>{e.granted_by || "—"}</div>
                  {e.reason ? (
                    <div className="adm-cell-sub">{e.reason}</div>
                  ) : null}
                  {e.external_ref ? (
                    <div
                      className="adm-cell-sub adm-mono adm-mono--soft"
                      title={e.external_ref}
                    >
                      Ref: {shortId(e.external_ref, 14)}
                    </div>
                  ) : null}
                </td>
                <td data-label="Updated" title={fmtDateTime(e.updated_at)}>
                  {fmtRelative(e.updated_at)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ padding: "8px 16px" }} className="adm-cell-sub">
        Showing {fmtNumber(rows.length)} of {fmtNumber(total)} entitlement
        records.
      </div>
    </div>
  );
}

function SubscriptionsTable({
  rows,
  loading,
  filtered,
  onClear,
  onOpenUser,
  now,
  total,
}: {
  rows: Subscription[];
  total: number;
  loading: boolean;
  filtered: boolean;
  onClear: () => void;
  onOpenUser: (id: string) => void;
  now: number;
}) {
  if (!loading && rows.length === 0) {
    return (
      <EmptyBilling
        filtered={filtered}
        onClear={onClear}
        title="No subscription records"
        description="Subscription records are stored when billing state is synchronized."
      />
    );
  }
  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <thead>
          <tr>
            <th scope="col">Account</th>
            <th scope="col">Status</th>
            <th scope="col">Platform</th>
            <th scope="col">Product</th>
            <th scope="col">Expires</th>
            <th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => {
            const _expiresSoon =
              !!s.expires_at &&
              s.expires_at > now &&
              s.expires_at - now < 7 * 24 * 60 * 60 * 1000;
            void _expiresSoon;
            return (
              <tr key={`${s.user_id}-${i}`}>
                <td className="adm-cell-primary" data-label="Account">
                  <UserCell
                    userId={s.user_id}
                    email={s.user_email}
                    name={s.user_display_name}
                    onOpen={() => onOpenUser(s.user_id)}
                  />
                </td>
                <td data-label="Status">
                  <Badge tone={statusTone(s.status)} dot>
                    {titleCase(s.status)}
                  </Badge>
                </td>
                <td data-label="Platform">
                  {s.platform ? titleCase(s.platform) : "—"}
                </td>
                <td data-label="Product" className="adm-cell-detail">
                  {s.product_id ? (
                    <span
                      className="adm-mono adm-mono--soft"
                      title={s.product_id}
                    >
                      {s.product_id}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td data-label="Expires">
                  {s.expires_at ? (
                    <span title={fmtDateTime(s.expires_at)}>
                      {fmtTimeLeft(s.expires_at)}
                    </span>
                  ) : (
                    "No expiry"
                  )}
                </td>
                <td
                  data-label="Updated"
                  title={s.updated_at ? fmtDateTime(s.updated_at) : undefined}
                >
                  {s.updated_at ? fmtRelative(s.updated_at) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ padding: "8px 16px" }} className="adm-cell-sub">
        Showing {fmtNumber(rows.length)} of {fmtNumber(total)} subscription
        records.
      </div>
    </div>
  );
}

function ClaimsTable({
  rows,
  loading,
  filtered,
  onClear,
  onOpenUser,
  now,
  total,
}: {
  rows: Claim[];
  total: number;
  loading: boolean;
  filtered: boolean;
  onClear: () => void;
  onOpenUser: (id: string) => void;
  now: number;
}) {
  if (!loading && rows.length === 0) {
    return (
      <EmptyBilling
        filtered={filtered}
        onClear={onClear}
        title="No claim records"
        description="Flutterwave transfer redemption/coverage records appear here when transactions are claimed and verified."
      />
    );
  }
  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <thead>
          <tr>
            <th scope="col">Reference</th>
            <th scope="col">Account</th>
            <th scope="col">Amount</th>
            <th scope="col">Coverage window</th>
            <th scope="col">Claimed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((claim) => {
            const state = coverageState(claim.expires_at, now);
            return (
              <tr key={claim.flw_ref}>
                <td className="adm-cell-primary" data-label="Reference">
                  <div className="adm-user-copy">
                    <span
                      className="adm-mono"
                      title={claim.tx_ref ?? claim.flw_ref}
                    >
                      {claim.tx_ref
                        ? shortId(claim.tx_ref, 14)
                        : shortId(claim.flw_ref, 14)}
                    </span>
                    <span className="adm-user-meta">
                      <span
                        className="adm-mono adm-mono--soft"
                        title={claim.flw_ref}
                      >
                        flw: {shortId(claim.flw_ref, 12)}
                      </span>
                      <CopyButton
                        value={claim.tx_ref ?? claim.flw_ref}
                        label="Copy reference"
                      />
                    </span>
                  </div>
                </td>
                <td data-label="Account">
                  <UserCell
                    userId={claim.user_id}
                    email={claim.user_email}
                    name={claim.user_display_name}
                    onOpen={() => onOpenUser(claim.user_id)}
                  />
                </td>
                <td data-label="Amount" className="adm-cell-money">
                  {fmtCurrency(claim.amount, claim.currency)}
                </td>
                <td data-label="Coverage window">
                  <Badge tone={state === "active" ? "success" : "danger"} dot>
                    {state === "active"
                      ? "Active coverage"
                      : "Expired coverage"}
                  </Badge>
                  <div
                    className="adm-cell-sub"
                    title={
                      claim.expires_at
                        ? fmtDateTime(claim.expires_at)
                        : undefined
                    }
                  >
                    {claim.expires_at
                      ? `Until ${fmtTimeLeft(claim.expires_at)}`
                      : "—"}
                  </div>
                </td>
                <td data-label="Claimed">
                  <span
                    className="adm-date"
                    title={fmtDateTime(claim.claimed_at)}
                  >
                    {fmtRelative(claim.claimed_at)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ padding: "8px 16px" }} className="adm-cell-sub">
        Showing {fmtNumber(rows.length)} of {fmtNumber(total)} claim records.
        Summary amount totals are sums of stored claim records by currency, not
        a reconciled ledger.
      </div>
    </div>
  );
}
