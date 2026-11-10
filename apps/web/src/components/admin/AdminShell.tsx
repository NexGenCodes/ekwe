import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  ChevronRight,
  CreditCard,
  HeartPulse,
  LogOut,
  Menu,
  RefreshCw,
  Rocket,
  ScrollText,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Logo } from "../Logo";
import { Button, StatusDot } from "./primitives";
import type { Tab } from "./types";

export const ADMIN_TABS: Array<{
  id: Tab;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    id: "users",
    label: "Users",
    description: "Search accounts, review access, and manage Pro entitlements.",
    icon: Users,
  },
  {
    id: "billing",
    label: "Billing",
    description:
      "Subscriptions and Flutterwave payment claims across the fleet.",
    icon: CreditCard,
  },
  {
    id: "usage",
    label: "Usage",
    description: "Translation, transcription, and AI consumption by account.",
    icon: BarChart3,
  },
  {
    id: "health",
    label: "Health",
    description: "Live status for bindings, push delivery, and AI providers.",
    icon: HeartPulse,
  },
  {
    id: "audit",
    label: "Audit log",
    description: "Every admin action, captured for compliance and review.",
    icon: ScrollText,
  },
  {
    id: "releases",
    label: "Releases",
    description: "Publish Android builds and notify active installations.",
    icon: Rocket,
  },
];

export function AdminShell({
  tab,
  onTabChange,
  title,
  description,
  eyebrow = "Live operations",
  breadcrumbs,
  lastSync,
  refreshing,
  onRefresh,
  onLogout,
  children,
}: {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  title: string;
  description: string;
  eyebrow?: string;
  breadcrumbs?: ReactNode;
  lastSync: Date | null;
  refreshing: boolean;
  onRefresh: () => void;
  onLogout: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    sidebarRef.current?.querySelector<HTMLElement>("button")?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = Array.from(
        sidebarRef.current?.querySelectorAll<HTMLElement>("button, a") ?? [],
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
      previousFocus?.focus();
    };
  }, [open]);

  const selectTab = (next: Tab) => {
    onTabChange(next);
    setOpen(false);
  };

  return (
    <div className="adm">
      <a className="adm-skip" href="#adm-main-content">
        Skip to content
      </a>
      <div className="adm-shell">
        <div
          className="adm-sidebar-scrim"
          data-open={open ? "true" : "false"}
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />

        <aside
          id="adm-sidebar"
          className="adm-sidebar"
          data-open={open ? "true" : "false"}
          ref={sidebarRef}
        >
          <div className="adm-sidebar-head">
            <span className="adm-brand-mark">
              <Logo />
            </span>
            <span className="adm-brand-copy">
              <strong>Ekwe</strong>
              <span>Admin console</span>
            </span>
            <button
              type="button"
              className="adm-icon-btn adm-sidebar-close"
              onClick={() => setOpen(false)}
              aria-label="Close navigation"
            >
              <X size={18} />
            </button>
          </div>

          <nav className="adm-nav" aria-label="Admin sections">
            <p className="adm-nav-label">Operations</p>
            {ADMIN_TABS.map((item) => {
              const Icon = item.icon;
              const isActive = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="adm-nav-link"
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => selectTab(item.id)}
                >
                  <Icon size={17} className="adm-nav-icon" aria-hidden="true" />
                  <span>{item.label}</span>
                  {isActive && (
                    <ChevronRight
                      size={14}
                      className="adm-nav-chevron"
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </nav>

          <div className="adm-sidebar-foot">
            <div className="adm-env">
              <ShieldCheck
                size={18}
                className="adm-env-icon"
                aria-hidden="true"
              />
              <span>
                <strong>Cloudflare Access</strong>
                <span>Protected session</span>
              </span>
            </div>
            <a
              className="adm-sidebar-link"
              href="/"
              target="_blank"
              rel="noreferrer"
            >
              View public site
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </div>
        </aside>

        <div className="adm-main">
          <header className="adm-topbar">
            <button
              type="button"
              className="adm-icon-btn adm-menu-btn"
              onClick={() => setOpen(true)}
              aria-label="Open navigation"
              aria-expanded={open}
              aria-controls="adm-sidebar"
            >
              <Menu size={20} />
            </button>

            <div className="adm-crumbs">
              {breadcrumbs ?? (
                <>
                  <span className="adm-crumbs-root">Admin</span>
                  <ChevronRight size={14} aria-hidden="true" />
                  <span className="adm-crumbs-current">{title}</span>
                </>
              )}
            </div>

            <div className="adm-topbar-actions">
              <span
                className="adm-sync"
                data-state={refreshing ? "busy" : "ready"}
              >
                <StatusDot tone={refreshing ? "warning" : "success"} pulse />
                <span className="adm-sync-text">
                  {refreshing
                    ? "Refreshing…"
                    : lastSync
                      ? `Synced ${lastSync.toLocaleTimeString(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}`
                      : "Connecting…"}
                </span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={onRefresh}
                loading={refreshing}
                aria-label="Refresh data"
                icon={<RefreshCw size={15} />}
              >
                <span className="adm-hide-sm">Refresh</span>
              </Button>
              <span className="adm-topbar-divider" aria-hidden="true" />
              <Button
                size="sm"
                variant="ghost"
                onClick={onLogout}
                aria-label="Sign out"
                icon={<LogOut size={15} />}
              >
                <span className="adm-hide-sm">Sign out</span>
              </Button>
            </div>
            {refreshing && (
              <span className="adm-topbar-progress" aria-hidden="true">
                <span />
              </span>
            )}
          </header>

          <main
            id="adm-main-content"
            className="adm-main-inner"
            tabIndex={-1}
            aria-busy={refreshing || undefined}
          >
            <div className="adm-page-head">
              <div>
                <p className="adm-eyebrow">
                  <Activity size={13} aria-hidden="true" />
                  {eyebrow}
                </p>
                <h1 className="adm-page-title">{title}</h1>
                <p className="adm-page-desc">{description}</p>
              </div>
            </div>

            {children}

            <footer className="adm-footer">
              <span>Ekwe Admin</span>
              <span aria-hidden="true">·</span>
              <span>Protected by Cloudflare Access</span>
              <span aria-hidden="true">·</span>
              <span>Refreshes every 30s while visible</span>
            </footer>
          </main>
        </div>
      </div>
    </div>
  );
}
