import { useMemo, useState } from "react";
import { BarChart3, Filter, TrendingUp } from "lucide-react";
import {
  Button,
  CopyButton,
  EmptyState,
  SegmentedControl,
  SectionCard,
  StatCard,
  TableSkeleton,
} from "./primitives";
import { fmtDuration, fmtNumber, fmtPercent, shortId } from "./format";
import type { UsageAggregate, UsageRow } from "./types";

type UsageView = "daily" | "monthly";

const ZERO_AGG: UsageAggregate = {
  translate_count: 0,
  transcribe_count: 0,
  speech_chars: 0,
  stream_count: 0,
  ai_credits: 0,
};

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
          {fmtNumber(total)} in loaded rows
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
        aria-label={`${label}: ${points.length} periods, ${fmtNumber(total)} total in loaded rows. Latest ${fmtNumber(latest)}.`}
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
  dailyTotal,
  monthlyTotal,
  dailyAggregate,
  monthlyAggregate,
  limit,
  offset,
  userId,
  onUserIdChange,
  onOffsetChange,
  loading,
}: {
  daily: UsageRow[];
  monthly: UsageRow[];
  dailyTotal: number;
  monthlyTotal: number;
  dailyAggregate: UsageAggregate;
  monthlyAggregate: UsageAggregate;
  limit: number;
  offset: number;
  userId: string;
  onUserIdChange: (value: string) => void;
  onOffsetChange: (offset: number) => void;
  loading: boolean;
}) {
  const [view, setView] = useState<UsageView>("daily");
  const [draftUser, setDraftUser] = useState(userId);
  const rows = view === "daily" ? daily : monthly;
  const total = view === "daily" ? dailyTotal : monthlyTotal;
  const aggregate =
    view === "daily" ? dailyAggregate : (monthlyAggregate ?? ZERO_AGG);
  const periodLabel = view === "daily" ? "Day" : "Month";
  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;
  const showingFrom = total === 0 ? 0 : offset + 1;
  const showingTo = Math.min(offset + rows.length, total);

  return (
    <div className="adm-stack">
      <SectionCard
        title="Usage filters"
        description="Scope admin usage rows and aggregates. Totals/aggregates reflect the selected filter; the table is paginated."
        actions={
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <input
              className="adm-input"
              aria-label="Filter usage by user ID"
              placeholder="Filter by user ID"
              value={draftUser}
              onChange={(e) => setDraftUser(e.target.value)}
              style={{ minWidth: 220 }}
            />
            <Button
              variant="secondary"
              size="sm"
              icon={<Filter size={14} />}
              onClick={() => onUserIdChange(draftUser.trim())}
            >
              Apply
            </Button>
            {(userId || draftUser) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraftUser("");
                  onUserIdChange("");
                }}
              >
                Clear
              </Button>
            )}
          </div>
        }
      >
        <p className="adm-muted" style={{ margin: 0 }}>
          {userId ? (
            <>
              Filtered to user{" "}
              <code className="adm-mono">{shortId(userId, 16)}</code>.{" "}
            </>
          ) : (
            "Showing all users. "
          )}
          Credits shown are tracked usage credits (not necessarily a separate
          enforced budget, depending on plan configuration).
        </p>
      </SectionCard>

      <div className="adm-stats">
        <StatCard
          label="Translations"
          value={fmtNumber(aggregate.translate_count)}
          hint={`${view} scope total (${fmtNumber(total)} rows)`}
          icon={<TrendingUp size={17} />}
        />
        <StatCard
          label="Transcriptions"
          value={fmtNumber(aggregate.transcribe_count)}
          hint={`${view} scope total`}
          icon={<BarChart3 size={17} />}
        />
        <StatCard
          label="Speech characters"
          value={fmtNumber(aggregate.speech_chars)}
          hint={`${view} scope total`}
          icon={<BarChart3 size={17} />}
        />
        <StatCard
          label="AI credits"
          value={fmtNumber(aggregate.ai_credits)}
          hint={`${view} scope total`}
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
            Trends reflect up to {Math.min(rows.length, 14)} of the currently
            loaded {view} rows, shown chronologically.
          </p>
        </section>
      )}

      <SectionCard
        title="Consumption by account"
        description={`Showing ${showingFrom}–${showingTo} of ${fmtNumber(total)} ${view} row${total === 1 ? "" : "s"} for the selected scope.`}
        actions={
          <SegmentedControl<UsageView>
            ariaLabel="Usage period"
            value={view}
            onChange={setView}
            options={[
              { value: "daily", label: "Daily", count: dailyTotal },
              { value: "monthly", label: "Monthly", count: monthlyTotal },
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
            description="Usage counters are written on successful billable activity for the selected scope."
          />
        ) : (
          <>
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
                          <CopyButton
                            value={row.user_id}
                            label="Copy user ID"
                          />
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
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 12,
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <span className="adm-muted">
                Page {total === 0 ? 0 : Math.floor(offset / limit) + 1} ·{" "}
                {fmtNumber(total)} total row{total === 1 ? "" : "s"}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!hasPrev || loading}
                  onClick={() => onOffsetChange(Math.max(0, offset - limit))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!hasNext || loading}
                  onClick={() => onOffsetChange(offset + limit)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </SectionCard>
    </div>
  );
}
