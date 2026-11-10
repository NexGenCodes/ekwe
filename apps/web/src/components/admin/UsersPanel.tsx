import { useLocation, useNavigate } from "react-router";
import { Crown, Search, Shield, UsersRound, X } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  Pagination,
  StatCard,
  TableSkeleton,
} from "./primitives";
import {
  fmtDate,
  fmtDateTime,
  fmtNumber,
  fmtTimeLeft,
  shortId,
} from "./format";
import type { AdminUser } from "./types";

function statusBadge(user: AdminUser) {
  if (user.isDeletionScheduled || user.accountStatus === "scheduled_deletion") {
    return <Badge tone="danger">Scheduled deletion</Badge>;
  }
  if (user.isSuspended || user.accountStatus === "suspended") {
    return <Badge tone="danger">Suspended</Badge>;
  }
  if (user.isDisabled || user.accountStatus === "disabled") {
    return <Badge tone="danger">Disabled</Badge>;
  }
  return <Badge tone="success">Active</Badge>;
}

function premiumLabel(user: AdminUser, effective: boolean): string | null {
  if (!effective) return null;
  const sources = user.premiumSources ?? [];
  if (sources.includes("billing") || sources.includes("subscription"))
    return "Billing/subscription";
  if (sources.includes("staff") || sources.includes("admin_role"))
    return "Admin entitlement";
  if (sources.includes("manual")) return "Manual grant";
  return null;
}

export function UsersPanel({
  users,
  total,
  loading,
  q,
  onQChange,
  role,
  onRoleChange,
  status,
  onStatusChange,
  access,
  onAccessChange,
  page,
  pageSize,
  onPageChange,
  filtered,
  onClearFilters,
}: {
  users: AdminUser[];
  total: number;
  loading: boolean;
  q: string;
  onQChange: (value: string) => void;
  role: string;
  onRoleChange: (value: string) => void;
  status: string;
  onStatusChange: (value: string) => void;
  access: string;
  onAccessChange: (value: string) => void;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  filtered: boolean;
  onClearFilters: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const premiumOnPage = users.filter(
    (u) => u.hasPremiumAccess ?? u.tier === "PREMIUM",
  ).length;
  const adminsOnPage = users.filter(
    (u) => (u.role ?? (u.isAdmin ? "admin" : "user")) === "admin",
  ).length;

  const openUser = (user: AdminUser) => {
    const from = `/admin${location.search}#users`;
    navigate(`/admin/users/${encodeURIComponent(user.id)}`, {
      state: { from },
    });
  };

  return (
    <>
      <div className="adm-stats">
        <StatCard
          label={filtered ? "Accounts matching" : "Total accounts"}
          value={fmtNumber(total)}
          hint={filtered ? "Filters applied" : "All registered accounts"}
          icon={<UsersRound size={17} />}
        />
        <StatCard
          label="Admins on this page"
          value={fmtNumber(adminsOnPage)}
          hint={`${users.length} shown`}
          icon={<Shield size={17} />}
          tone="success"
        />
        <StatCard
          label="Premium on this page"
          value={fmtNumber(premiumOnPage)}
          hint="Effective access"
          icon={<Crown size={17} />}
          tone="success"
        />
      </div>

      <section className="adm-panel">
        <div className="adm-toolbar">
          <div className="adm-search">
            <Search size={16} className="adm-search-icon" aria-hidden="true" />
            <input
              className="adm-input adm-search-input"
              value={q}
              onChange={(e) => onQChange(e.target.value)}
              placeholder="Search by email or name…"
              aria-label="Filter users"
              type="search"
              autoComplete="off"
            />
          </div>
          <div className="adm-toolbar-end">
            <label className="adm-select-wrap">
              <span className="sr-only">Filter by role</span>
              <select
                className="adm-select"
                value={role}
                onChange={(e) => onRoleChange(e.target.value)}
                aria-label="Filter by role"
              >
                <option value="">All roles</option>
                <option value="admin">Admins</option>
                <option value="user">Users</option>
              </select>
            </label>
            <label className="adm-select-wrap">
              <span className="sr-only">Filter by status</span>
              <select
                className="adm-select"
                value={status}
                onChange={(e) => onStatusChange(e.target.value)}
                aria-label="Filter by status"
              >
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
                <option value="suspended">Suspended</option>
                <option value="scheduled_deletion">Scheduled deletion</option>
              </select>
            </label>
            <label className="adm-select-wrap">
              <span className="sr-only">Filter by plan</span>
              <select
                className="adm-select"
                value={access}
                onChange={(e) => onAccessChange(e.target.value)}
                aria-label="Filter by plan"
              >
                <option value="">All plans</option>
                <option value="premium">Premium</option>
                <option value="free">Free</option>
              </select>
            </label>
            {filtered && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClearFilters}
                icon={<X size={15} />}
              >
                Clear
              </Button>
            )}
          </div>
        </div>

        {loading && users.length === 0 ? (
          <TableSkeleton rows={7} columns={4} />
        ) : users.length === 0 ? (
          <EmptyState
            icon={<UsersRound size={22} />}
            title={
              filtered ? "No accounts match those filters" : "No accounts yet"
            }
            description={
              filtered
                ? "Try a different search or filter, or clear filters to see everyone."
                : "Accounts will appear here as people create an Ekwe account."
            }
            action={
              filtered ? (
                <Button variant="secondary" size="sm" onClick={onClearFilters}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col">Role & status</th>
                  <th scope="col">Access</th>
                  <th scope="col">Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const effective =
                    user.hasPremiumAccess ?? user.tier === "PREMIUM";
                  const userRole =
                    user.role ?? (user.isAdmin ? "admin" : "user");
                  const sourceLabel = premiumLabel(user, effective);
                  return (
                    <tr
                      key={user.id}
                      className="adm-row-clickable"
                      onClick={() => openUser(user)}
                    >
                      <td className="adm-cell-primary" data-label="Account">
                        <div className="adm-user">
                          <Avatar
                            name={user.display_name}
                            email={user.email}
                            size="sm"
                          />
                          <div className="adm-user-copy">
                            <button
                              type="button"
                              className="adm-row-link"
                              onClick={(e) => {
                                e.stopPropagation();
                                openUser(user);
                              }}
                            >
                              {user.email}
                            </button>
                            <span className="adm-user-meta">
                              {user.display_name?.trim() || "No display name"}
                              <span className="adm-mono">
                                {shortId(user.id, 8)}
                              </span>
                            </span>
                          </div>
                        </div>
                      </td>
                      <td data-label="Role & status">
                        <div className="adm-chip-row" style={{ gap: 6 }}>
                          <Badge
                            tone={userRole === "admin" ? "success" : "neutral"}
                            dot
                          >
                            {userRole === "admin" ? "Admin" : "User"}
                          </Badge>
                          {statusBadge(user)}
                        </div>
                      </td>
                      <td data-label="Access">
                        <div className="adm-chip-row" style={{ gap: 6 }}>
                          <Badge tone={effective ? "accent" : "neutral"} dot>
                            {effective ? "Premium" : "Free"}
                          </Badge>
                        </div>
                        {sourceLabel ? (
                          <span className="adm-cell-sub">{sourceLabel}</span>
                        ) : null}
                        {effective && user.pro_expires_at ? (
                          <span
                            className="adm-cell-sub"
                            title={fmtDateTime(user.pro_expires_at)}
                          >
                            Expires {fmtTimeLeft(user.pro_expires_at)}
                          </span>
                        ) : null}
                      </td>
                      <td data-label="Joined">
                        <span
                          className="adm-date"
                          title={fmtDateTime(user.created_at)}
                        >
                          {fmtDate(user.created_at)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={onPageChange}
          disabled={loading}
        />
      </section>
    </>
  );
}
