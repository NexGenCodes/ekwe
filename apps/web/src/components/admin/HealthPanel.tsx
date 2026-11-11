import {
  BellRing,
  Cpu,
  Database,
  HardDrive,
  HeartPulse,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge, SectionCard } from "./primitives";
import { fmtDateTime, fmtNumber, fmtRelative } from "./format";
import type { HealthRes } from "./types";

function BindingCard({
  label,
  description,
  status,
  latencyMs,
  icon,
}: {
  label: string;
  description: string;
  status: string;
  latencyMs?: number;
  icon: ReactNode;
}) {
  const healthy = status === "ok";
  return (
    <div className="adm-health-card">
      <span className="adm-health-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="adm-health-copy">
        <span className="adm-health-label">{label}</span>
        <span className="adm-health-desc">
          {description}
          {typeof latencyMs === "number" ? ` · ${fmtNumber(latencyMs)} ms` : ""}
        </span>
      </div>
      <Badge tone={healthy ? "success" : "danger"} dot>
        {healthy ? "Operational" : "Error"}
      </Badge>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const healthy = status === "healthy";
  const degraded = status === "degraded";
  return (
    <span
      className={`adm-health-provider ${healthy ? "is-healthy" : degraded ? "is-degraded" : "is-unknown"}`}
    >
      <span className="adm-health-provider-dot" aria-hidden="true" />
      <span className="adm-health-provider-name">
        {status === "healthy"
          ? "Healthy"
          : status === "degraded"
            ? "Degraded"
            : status}
      </span>
    </span>
  );
}

export function HealthPanel({
  health,
  loading,
}: {
  health: HealthRes | null;
  loading: boolean;
}) {
  if (!health) {
    return (
      <div className="adm-stack">
        <div
          className="adm-health-hero adm-health-hero--skeleton"
          aria-busy="true"
        >
          <div className="adm-skeleton-bar" style={{ width: "28%" }} />
          <div className="adm-skeleton-bar" style={{ width: "48%" }} />
          <div className="adm-skeleton-bar" style={{ width: "34%" }} />
          {loading && <span className="sr-only">Loading health status</span>}
        </div>
        {!loading && (
          <SectionCard
            title="Health data unavailable"
            description="The worker did not return a health response. Refresh to try again."
          >
            <div className="adm-empty adm-empty--compact">
              <TriangleAlert size={20} aria-hidden="true" />
              <p className="adm-empty-desc">
                Check the Cloudflare Access session and worker availability.
              </p>
            </div>
          </SectionCard>
        )}
      </div>
    );
  }

  const degraded = health.degradedProviders ?? [];
  const providers =
    health.providers ?? degraded.map((name) => ({ name, status: "degraded" }));
  const providerTotal = health.providerSummary?.total ?? providers.length;
  const providerHealthy =
    health.providerSummary?.healthy ??
    Math.max(providerTotal - degraded.length, 0);
  const bindingsHealthy =
    health.bindings.d1 === "ok" && health.bindings.kv === "ok";
  const healthy = degraded.length === 0 && bindingsHealthy;
  const push = health.push ?? {
    active: health.pushActive,
    inactive: 0,
    total: health.pushActive,
  };

  return (
    <div className="adm-stack">
      <div
        className={`adm-health-hero ${healthy ? "adm-health-hero--ok" : "adm-health-hero--warn"}`}
      >
        <div className="adm-health-hero-main">
          <span className="adm-health-pulse" aria-hidden="true">
            <HeartPulse size={22} />
          </span>
          <div>
            <p className="adm-health-title">
              {healthy ? "All systems operational" : "Attention required"}
            </p>
            <p className="adm-health-sub">
              {healthy
                ? "Core bindings are reachable and no AI provider is currently degraded."
                : [
                    !bindingsHealthy
                      ? "A core binding is reporting errors."
                      : null,
                    degraded.length > 0
                      ? `${degraded.length} provider${degraded.length === 1 ? "" : "s"} degraded (failover handles traffic).`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" ")}
            </p>
          </div>
        </div>
        <div className="adm-health-hero-meta">
          <Badge tone={healthy ? "success" : "warning"} dot>
            {healthy ? "Healthy" : "Degraded"}
          </Badge>
          <span title={fmtDateTime(health.timestamp)}>
            Checked {fmtRelative(health.timestamp)}
          </span>
        </div>
      </div>

      <div className="adm-health-grid">
        <BindingCard
          label="D1 database"
          description="Primary relational store"
          status={health.bindings.d1}
          latencyMs={health.checks?.d1Ms}
          icon={<Database size={18} />}
        />
        <BindingCard
          label="KV namespace"
          description="Cache, manifests, cooldowns"
          status={health.bindings.kv}
          latencyMs={health.checks?.kvMs}
          icon={<HardDrive size={18} />}
        />
        <div className="adm-health-card">
          <span className="adm-health-icon" aria-hidden="true">
            <BellRing size={18} />
          </span>
          <div className="adm-health-copy">
            <span className="adm-health-label">Push tokens</span>
            <span className="adm-health-desc">
              {fmtNumber(push.active)} active · {fmtNumber(push.inactive)}{" "}
              inactive · {fmtNumber(push.total)} total
            </span>
          </div>
          <span className="adm-health-value">{fmtNumber(push.active)}</span>
        </div>
        <div className="adm-health-card">
          <span className="adm-health-icon" aria-hidden="true">
            <Cpu size={18} />
          </span>
          <div className="adm-health-copy">
            <span className="adm-health-label">AI providers</span>
            <span className="adm-health-desc">
              {fmtNumber(providerHealthy)} healthy ·{" "}
              {fmtNumber(degraded.length)} degraded · {fmtNumber(providerTotal)}{" "}
              total
            </span>
          </div>
          <Badge tone={degraded.length === 0 ? "success" : "warning"} dot>
            {degraded.length === 0
              ? "All healthy"
              : `${degraded.length} degraded`}
          </Badge>
        </div>
      </div>

      <SectionCard
        title="Provider status"
        description="Circuit state per configured provider. Degraded providers are tripped open and recover automatically; traffic fails over to healthy routes."
      >
        {degraded.length > 0 && (
          <div
            className="adm-callout adm-callout--warning"
            style={{ marginBottom: 16 }}
          >
            <TriangleAlert size={18} aria-hidden="true" />
            <div>
              <p className="adm-callout-title">
                {degraded.length} provider{degraded.length === 1 ? "" : "s"}{" "}
                degraded
              </p>
              <p className="adm-callout-desc">
                Investigate if degradation persists. Requests continue through
                healthy failover routes where available.
              </p>
              <div className="adm-chip-row">
                {degraded.map((name) => (
                  <span className="adm-chip" key={name}>
                    {name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {degraded.length === 0 && (
          <div
            className="adm-callout adm-callout--success"
            style={{ marginBottom: 16 }}
          >
            <ShieldCheck size={18} aria-hidden="true" />
            <div>
              <p className="adm-callout-title">
                No provider degradation reported
              </p>
              <p className="adm-callout-desc">
                All configured providers are currently accepting traffic.
              </p>
            </div>
          </div>
        )}

        {providers.length > 0 ? (
          <ul
            className="adm-health-provider-list"
            aria-label="Provider health statuses"
          >
            {providers.map((provider) => (
              <li key={provider.name} className="adm-health-provider-row">
                <span className="adm-mono adm-health-provider-id">
                  {provider.name}
                </span>
                <StatusPill status={provider.status} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="adm-empty adm-empty--compact">
            <p className="adm-empty-desc">
              No provider status details available.
            </p>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
