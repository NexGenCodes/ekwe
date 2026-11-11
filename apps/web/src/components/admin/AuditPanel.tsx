import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Download,
  ScrollText,
  Search,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  CopyButton,
  EmptyState,
  SectionCard,
  TableSkeleton,
} from "./primitives";
import type { BadgeTone } from "./primitives";
import { fmtDateTime, fmtNumber, fmtRelative, shortId } from "./format";
import type { AuditRow } from "./types";

function actionTone(action: string): BadgeTone {
  if (
    action.includes("grant") ||
    action.includes("publish") ||
    action.includes("enabled")
  )
    return "success";
  if (
    action.includes("revoke") ||
    action.includes("delete") ||
    action.includes("disable") ||
    action.includes("suspend")
  )
    return "warning";
  if (
    action.startsWith("releases") ||
    action.includes("billing") ||
    action.includes("sync")
  )
    return "accent";
  return "neutral";
}

export function AuditPanel({
  entries,
  total,
  limit,
  offset,
  q,
  action,
  onQChange,
  onActionChange,
  onOffsetChange,
  onExport,
  loading,
}: {
  entries: AuditRow[];
  total: number;
  limit: number;
  offset: number;
  q: string;
  action: string;
  onQChange: (value: string) => void;
  onActionChange: (value: string) => void;
  onOffsetChange: (offset: number) => void;
  onExport?: () => Promise<void>;
  loading: boolean;
}) {
  const [draftQ, setDraftQ] = useState(q);
  const [draftAction, setDraftAction] = useState(action);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [exporting, setExporting] = useState(false);

  useEffect(() => setDraftQ(q), [q]);
  useEffect(() => setDraftAction(action), [action]);

  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;
  const showingFrom = total === 0 ? 0 : offset + 1;
  const showingTo = Math.min(offset + entries.length, total);
  const page = total === 0 ? 0 : Math.floor(offset / limit) + 1;
  const hasFilters = Boolean(q.trim() || action.trim());

  const actionOptions = useMemo(() => {
    const base = new Set<string>([action].filter(Boolean));
    entries.forEach((e) => base.add(e.action));
    return ["", ...Array.from(base).sort()];
  }, [entries, action]);

  const apply = () => {
    onQChange(draftQ.trim());
    onActionChange(draftAction.trim());
  };

  const clear = () => {
    setDraftQ("");
    setDraftAction("");
    onQChange("");
    onActionChange("");
  };

  const toggle = (id: number) =>
    setExpanded((current) => ({ ...current, [id]: !current[id] }));

  return (
    <SectionCard
      title="Admin activity"
      description="Immutable log of privileged actions. Results are server-filtered and paginated. Export downloads the current filtered view (up to 2,000 entries)."
      actions={
        <div className="adm-inline" style={{ gap: 8 }}>
          <Badge tone="neutral">{fmtNumber(total)} total</Badge>
          {onExport ? (
            <Button
              variant="secondary"
              size="sm"
              icon={<Download size={14} />}
              loading={exporting}
              onClick={async () => {
                setExporting(true);
                try {
                  await onExport();
                } finally {
                  setExporting(false);
                }
              }}
            >
              Export CSV
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="adm-stack" style={{ gap: 12 }}>
        <form
          className="adm-toolbar adm-toolbar--inset"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <div className="adm-search">
            <Search size={16} className="adm-search-icon" aria-hidden="true" />
            <label className="sr-only" htmlFor="adm-audit-q">
              Search audit log
            </label>
            <input
              id="adm-audit-q"
              className="adm-input adm-search-input"
              value={draftQ}
              onChange={(event) => setDraftQ(event.target.value)}
              placeholder="Search admin, action, or detail…"
              type="search"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="adm-toolbar-end">
            <label className="sr-only" htmlFor="adm-audit-action">
              Filter by action
            </label>
            <select
              id="adm-audit-action"
              className="adm-input"
              value={draftAction}
              onChange={(e) => setDraftAction(e.target.value)}
              aria-label="Filter by action"
            >
              <option value="">All actions</option>
              {actionOptions
                .filter((value) => value !== "")
                .map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
            </select>
            <Button type="submit" variant="secondary" size="sm">
              Apply
            </Button>
            {hasFilters || draftQ || draftAction ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clear}
                icon={<X size={15} />}
              >
                Clear
              </Button>
            ) : null}
          </div>
        </form>

        {loading && entries.length === 0 ? (
          <TableSkeleton rows={8} columns={5} />
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<ScrollText size={22} />}
            title={
              hasFilters
                ? "No entries match your filters"
                : "No admin activity yet"
            }
            description={
              hasFilters
                ? "Try a different search term or action filter."
                : "Privileged actions will be recorded here automatically."
            }
            action={
              hasFilters ? (
                <Button variant="secondary" size="sm" onClick={clear}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Admin</th>
                    <th scope="col">Action</th>
                    <th scope="col">Target</th>
                    <th scope="col">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="adm-cell-primary" data-label="When">
                        <span
                          className="adm-date"
                          title={fmtDateTime(entry.created_at)}
                        >
                          {fmtRelative(entry.created_at)}
                        </span>
                        <span className="adm-cell-sub">
                          {fmtDateTime(entry.created_at)}
                        </span>
                      </td>
                      <td data-label="Admin">
                        <span className="adm-text">{entry.admin_email}</span>
                      </td>
                      <td data-label="Action">
                        <Badge tone={actionTone(entry.action)}>
                          <span className="adm-mono">{entry.action}</span>
                        </Badge>
                      </td>
                      <td data-label="Target">
                        {entry.target_user_id ? (
                          <div className="adm-id">
                            <span className="adm-mono">
                              {shortId(entry.target_user_id, 12)}
                            </span>
                            <CopyButton
                              value={entry.target_user_id}
                              label="Copy target user ID"
                            />
                          </div>
                        ) : (
                          <span className="adm-muted">—</span>
                        )}
                      </td>
                      <td data-label="Detail">
                        {entry.detail ? (
                          (() => {
                            const isLong = entry.detail.length > 72;
                            const isOpen = !!expanded[entry.id];
                            return (
                              <div className="adm-detail-wrap">
                                <span
                                  className={
                                    isOpen
                                      ? "adm-detail adm-detail--open"
                                      : "adm-detail"
                                  }
                                  title={isOpen ? undefined : entry.detail}
                                >
                                  {entry.detail}
                                </span>
                                <div className="adm-detail-actions">
                                  {isLong && (
                                    <button
                                      type="button"
                                      className="adm-detail-toggle"
                                      aria-expanded={isOpen}
                                      onClick={() => toggle(entry.id)}
                                    >
                                      {isOpen ? (
                                        <>
                                          <ChevronUp
                                            size={13}
                                            aria-hidden="true"
                                          />{" "}
                                          Less
                                        </>
                                      ) : (
                                        <>
                                          <ChevronDown
                                            size={13}
                                            aria-hidden="true"
                                          />{" "}
                                          More
                                        </>
                                      )}
                                    </button>
                                  )}
                                  <CopyButton
                                    value={entry.detail}
                                    label="Copy detail"
                                  />
                                </div>
                              </div>
                            );
                          })()
                        ) : (
                          <span className="adm-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="adm-pagination">
              <p className="adm-pagination-info">
                {showingFrom}–{showingTo} of {fmtNumber(total)} · page {page}
              </p>
              <div className="adm-pagination-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!hasPrev || loading}
                  onClick={() => onOffsetChange(Math.max(0, offset - limit))}
                >
                  Previous
                </Button>
                <Button
                  variant="ghost"
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
      </div>
    </SectionCard>
  );
}
