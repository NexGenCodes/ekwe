import { useMemo, useState } from "react";
import { BarChart3, TrendingUp } from "lucide-react";
import {
  CopyButton,
  EmptyState,
  SegmentedControl,
  SectionCard,
  StatCard,
  TableSkeleton,
} from "./primitives";
import { fmtDuration, fmtNumber, fmtPercent, shortId } from "./format";
import type { UsageRow } from "./types";

type UsageView = "daily" | "monthly";

function sum(rows: UsageRow[], key: keyof UsageRow): number {
  return rows.reduce((total, row) => {
    const value = row[key];
    return total + (typeof value === "number" ? value : 0);
  }, 0);
}

function periodOf(row: UsageRow): string {
  return row.day ?? row.month ?? "";
}

function MetricBars({
  rows,
  metric,
  label,
}: {
  rows: UsageRow[];
  metric: "translate_count" | "ai_credits";
  label: string;
}) {
  const points = useMemo(() => {
    const chronological = [...rows].reverse().slice(-14);
    return chronological.map((row) => ({
      period: periodOf(row),
      value: row[metric] ?? 0,
    }));
  }, [rows, metric]);

  if (points.length < 2) return null;
  const max = Math.max(1, ...points.map((point) => point.value));
  const total = points.reduce((acc, point) => acc + point.value, 0);
  const latest = points[points.length - 1]?.value ?? 0;
  const previous = points[points.length - 2]?.value ?? 0;
  const delta = previous > 0 ? (latest - previous) / previous : null;

  return (
    <div className="adm-trend">
      <div className="adm-trend-head">
        <span className="adm-trend-label">{label}</span>
        <span className="adm-trend-meta">
          {fmtNumber(total)} total
          {delta !== null && (
            <span
              className={
                delta >= 0 ? "adm-trend-delta is-up" : "adm-trend-delta is-down"
              }
            >
              {delta >= 0 ? "↑" : "↓"} {fmtPercent(Math.abs(delta))}
            </span>
          )}
        </span>
      </div>
      <div
        className="adm-bars"
        role="img"
        aria-label={`${label}: ${points.length} periods, ${fmtNumber(
          total,
        )} total. Latest ${fmtNumber(latest)}.`}
      >
        {points.map((point, index) => (
          <div
            key={`${point.period}-${index}`}
            className="adm-bar"
            title={`${point.period}: ${fmtNumber(point.value)}`}
          >
            <span
              style={{ height: `${Math.max(6, (point.value / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="adm-bars-axis" aria-hidden="true">
        <span>{points[0]?.period}</span>
        <span>{points[points.length - 1]?.period}</span>
      </div>
    </div>
  );
}

export function UsagePanel({
  daily,
  monthly,
  loading,
}: {
  daily: UsageRow[];
  monthly: UsageRow[];
  loading: boolean;
}) {
  const [view, setView] = useState<UsageView>("daily");
  const rows = view === "daily" ? daily : monthly;
  const periodLabel = view === "daily" ? "Day" : "Month";

  const totals = {
    translate: sum(rows, "translate_count"),
    transcribe: sum(rows, "transcribe_count"),
    speech: sum(rows, "speech_chars"),
    credits: sum(rows, "ai_credits"),
  };

  return (
    <div className="adm-stack">
      <div className="adm-stats">
        <StatCard
          label="Translations"
          value={fmtNumber(totals.translate)}
          hint={`${view} window`}
          icon={<TrendingUp size={17} />}
        />
        <StatCard
          label="Transcriptions"
          value={fmtNumber(totals.transcribe)}
          hint={`${view} window`}
          icon={<BarChart3 size={17} />}
        />
        <StatCard
          label="Speech characters"
          value={fmtNumber(totals.speech)}
          hint={`${view} window`}
          icon={<BarChart3 size={17} />}
        />
        <StatCard
          label="AI credits"
          value={fmtNumber(totals.credits)}
          hint={`${view} window`}
          icon={<TrendingUp size={17} />}
        />
      </div>

      {rows.length > 1 && (
        <section
          className="adm-panel adm-trend-panel"
          aria-label="Activity trend"
        >
          <div className="adm-trend-grid">
            <MetricBars
              rows={rows}
              metric="translate_count"
              label="Translation volume"
            />
            <MetricBars
              rows={rows}
              metric="ai_credits"
              label="AI credit usage"
            />
          </div>
          <p className="adm-trend-note">
            Trends reflect the {Math.min(rows.length, 14)} most recent returned{" "}
            {view} rows, shown chronologically.
          </p>
        </section>
      )}

      <SectionCard
        title="Consumption by account"
        description={`Totals across the ${rows.length} most recent ${view} row${
          rows.length === 1 ? "" : "s"
        } returned by the worker.`}
        actions={
          <SegmentedControl<UsageView>
            ariaLabel="Usage period"
            value={view}
            onChange={setView}
            options={[
              { value: "daily", label: "Daily", count: daily.length },
              { value: "monthly", label: "Monthly", count: monthly.length },
            ]}
          />
        }
      >
        {loading && rows.length === 0 ? (
          <TableSkeleton rows={7} columns={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<BarChart3 size={22} />}
            title={`No ${view} usage recorded`}
            description="Usage counters are written as people translate and transcribe audio."
          />
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col">{periodLabel}</th>
                  <th scope="col" className="adm-th-num">
                    Translations
                  </th>
                  <th scope="col" className="adm-th-num">
                    Transcriptions
                  </th>
                  <th scope="col" className="adm-th-num">
                    Speech chars
                  </th>
                  <th scope="col" className="adm-th-num">
                    Streams
                  </th>
                  <th scope="col" className="adm-th-num">
                    AI credits
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.user_id}-${row.day ?? row.month ?? index}`}>
                    <td className="adm-cell-primary" data-label="Account">
                      <div className="adm-id">
                        <span className="adm-mono">
                          {shortId(row.user_id, 12)}
                        </span>
                        <CopyButton value={row.user_id} label="Copy user ID" />
                      </div>
                    </td>
                    <td data-label={periodLabel}>
                      <span className="adm-date adm-mono--soft">
                        {row.day ?? row.month ?? "—"}
                      </span>
                    </td>
                    <td data-label="Translations" className="adm-num">
                      {fmtNumber(row.translate_count)}
                    </td>
                    <td data-label="Transcriptions" className="adm-num">
                      <span className="adm-cell-stack">
                        <span className="adm-num-main">
                          {fmtNumber(row.transcribe_count)}
                        </span>
                        {row.transcribe_ms ? (
                          <span className="adm-num-sub">
                            {fmtDuration(row.transcribe_ms)}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td data-label="Speech chars" className="adm-num">
                      {fmtNumber(row.speech_chars)}
                    </td>
                    <td data-label="Streams" className="adm-num">
                      <span className="adm-cell-stack">
                        <span className="adm-num-main">
                          {fmtNumber(row.stream_count ?? 0)}
                        </span>
                        {row.stream_ms ? (
                          <span className="adm-num-sub">
                            {fmtDuration(row.stream_ms)}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td data-label="AI credits" className="adm-num">
                      {fmtNumber(row.ai_credits)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
