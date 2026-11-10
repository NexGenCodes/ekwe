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
  icon,
}: {
  label: string;
  description: string;
  status: string;
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
        <span className="adm-health-desc">{description}</span>
      </div>
      <Badge tone={healthy ? "success" : "danger"} dot>
        {healthy ? "Operational" : "Error"}
      </Badge>
    </div>
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
        <div className="adm-health-hero adm-health-hero--skeleton">
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

  const degraded = health.degradedProviders;
  const healthy = degraded.length === 0;

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
              {healthy ? "All systems operational" : "Partial degradation"}
            </p>
            <p className="adm-health-sub">
              {healthy
                ? "Bindings are reachable and no AI provider is reporting failures."
                : `${degraded.length} provider${
                    degraded.length === 1 ? "" : "s"
                  } reporting failures. Failover is handling traffic.`}
            </p>
          </div>
        </div>
        <div className="adm-health-hero-meta">
          <Badge tone={healthy ? "success" : "warning"} dot>
            {healthy ? "Healthy" : "Degraded"}
          </Badge>
          <span title={fmtDateTime(health.timestamp)}>
            Last check {fmtRelative(health.timestamp)}
          </span>
        </div>
      </div>

      <div className="adm-health-grid">
        <BindingCard
          label="D1 database"
          description="Primary relational store"
          status={health.bindings.d1}
          icon={<Database size={18} />}
        />
        <BindingCard
          label="KV namespace"
          description="Manifests, caching, cooldowns"
          status={health.bindings.kv}
          icon={<HardDrive size={18} />}
        />
        <div className="adm-health-card">
          <span className="adm-health-icon" aria-hidden="true">
            <BellRing size={18} />
          </span>
          <div className="adm-health-copy">
            <span className="adm-health-label">Push tokens</span>
            <span className="adm-health-desc">
              Reachable Android + iOS devices
            </span>
          </div>
          <span className="adm-health-value">
            {fmtNumber(health.pushActive)}
          </span>
        </div>
        <div className="adm-health-card">
          <span className="adm-health-icon" aria-hidden="true">
            <Cpu size={18} />
          </span>
          <div className="adm-health-copy">
            <span className="adm-health-label">AI providers</span>
            <span className="adm-health-desc">
              STT, translation, and speech
            </span>
          </div>
          <Badge tone={healthy ? "success" : "warning"} dot>
            {healthy ? "All healthy" : `${degraded.length} degraded`}
          </Badge>
        </div>
      </div>

      <SectionCard
        title="Provider detail"
        description="Providers are checked continuously; tripped providers recover automatically."
      >
        {healthy ? (
          <div className="adm-callout adm-callout--success">
            <ShieldCheck size={18} aria-hidden="true" />
            <div>
              <p className="adm-callout-title">No degradation reported</p>
              <p className="adm-callout-desc">
                All configured speech-to-text, translation, and speech providers
                are accepting traffic.
              </p>
            </div>
          </div>
        ) : (
          <div className="adm-callout adm-callout--warning">
            <TriangleAlert size={18} aria-hidden="true" />
            <div>
              <p className="adm-callout-title">
                {degraded.length} provider{degraded.length === 1 ? "" : "s"}{" "}
                degraded
              </p>
              <p className="adm-callout-desc">
                Requests are failing over to healthy providers. Investigate if
                this persists.
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
      </SectionCard>
    </div>
  );
}
