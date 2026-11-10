import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ScrollText, Search, X } from "lucide-react";
import {
  Badge,
  Button,
  CopyButton,
  EmptyState,
  SectionCard,
  TableSkeleton,
} from "./primitives";
import type { BadgeTone } from "./primitives";
import { fmtDateTime, fmtRelative, shortId } from "./format";
import type { AuditRow } from "./types";

function actionTone(action: string): BadgeTone {
  if (action.includes("grant") || action.includes("publish")) return "success";
  if (action.includes("revoke") || action.includes("delete")) return "warning";
  if (action.startsWith("releases")) return "accent";
  return "neutral";
}

export function AuditPanel({
  entries,
  loading,
}: {
  entries: AuditRow[];
  loading: boolean;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) =>
      [entry.admin_email, entry.action, entry.target_user_id, entry.detail]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle)),
    );
  }, [entries, query]);

  const toggle = (id: number) =>
    setExpanded((current) => ({ ...current, [id]: !current[id] }));

  return (
    <SectionCard
      title="Admin activity"
      description="Chronological record of privileged actions. Entries are immutable."
      actions={<Badge tone="neutral">{entries.length} recent</Badge>}
    >
      <div className="adm-toolbar adm-toolbar--inset">
        <div className="adm-search">
          <Search size={16} className="adm-search-icon" aria-hidden="true" />
          <input
            className="adm-input adm-search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by admin, action, or target…"
            aria-label="Filter audit entries"
            type="search"
            autoComplete="off"
          />
        </div>
        {query && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setQuery("")}
            icon={<X size={15} />}
          >
            Clear
          </Button>
        )}
      </div>

      {loading && entries.length === 0 ? (
        <TableSkeleton rows={8} columns={5} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<ScrollText size={22} />}
          title={
            query ? "No entries match your filter" : "No admin activity yet"
          }
          description={
            query
              ? "Try a different search term."
              : "Privileged actions will be recorded here automatically."
          }
          action={
            query ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setQuery("")}
              >
                Clear filter
              </Button>
            ) : undefined
          }
        />
      ) : (
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
              {filtered.map((entry) => (
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
                                      <ChevronUp size={13} aria-hidden="true" />{" "}
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
      )}
    </SectionCard>
  );
}
