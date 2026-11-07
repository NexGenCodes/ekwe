import { Link, useLocation, useNavigate } from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { siteConfig } from "../data/siteConfig";
import { Logo } from "./Logo";

export function Nav({
  links,
}: {
  links?: { to: string; label: string; external?: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [activeHash, setActiveHash] = useState("");
  const linksRef = useRef<HTMLUListElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);

  const handleLogoClick = (e: React.MouseEvent) => {
    setOpen(false);
    setActiveHash("");
    if (location.pathname === "/") {
      // Already home: don't let router no-op, scroll to top
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (window.location.hash) {
        history.replaceState(null, "", "/");
      }
    } else {
      // Go home; Link will route to "/", then scroll top on arrival
      window.setTimeout(() => window.scrollTo({ top: 0 }), 0);
    }
  };

  const handleAnchorClick = (
    e: React.MouseEvent<HTMLAnchorElement>,
    hash: string,
  ) => {
    setOpen(false);
    if (location.pathname !== "/") {
      e.preventDefault();
      void navigate(`/${hash}`);
      requestAnimationFrame(() => {
        document
          .getElementById(hash.slice(1))
          ?.scrollIntoView({ behavior: "smooth" });
      });
    }
  };

  const items = useMemo(
    () =>
      links ?? [
        { to: "#languages", label: "Languages" },
        { to: "#tech", label: "Technology" },
        { to: "#how-it-works", label: "How it works" },
        { to: "#features", label: "Features" },
        { to: "#download", label: "Download" },
      ],
    [links],
  );

  // Mobile drawer: lock scroll, trap focus, Escape to close, restore focus
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    if (!open) return;
    const linksEl = linksRef.current;
    // copy to local to avoid cleanup-stale-ref
    const first = linksEl?.querySelector<HTMLElement>("a");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key !== "Tab" || !linksEl) return;
      const focusables = Array.from(
        linksEl.querySelectorAll<HTMLElement>("a, button"),
      );
      if (focusables.length === 0) return;
      const firstEl = focusables[0];
      const lastEl = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
      first?.focus();
    };
  }, [open]);

  // Scrollspy for landing sections — clear when back at top (hero has no section)
  useEffect(() => {
    if (location.pathname !== "/") {
      setActiveHash("");
      return;
    }
    const sections = items
      .filter((l) => l.to.startsWith("#"))
      .map((l) => l.to.slice(1));
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) setActiveHash(`#${en.target.id}`);
        });
      },
      { rootMargin: "-30% 0px -60% 0px" },
    );
    sections.forEach((id) => {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    });
    const onScroll = () => {
      if (window.scrollY < 200) setActiveHash("");
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      obs.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, [location.pathname, items]);

  return (
    <nav className="nav">
      <div className="container nav-inner">
        <Link to="/" className="nav-brand" onClick={handleLogoClick}>
          <Logo />
          {siteConfig.app.name}
        </Link>
        {/* overlay for mobile drawer */}
        <div
          className="nav-overlay"
          data-open={open ? "true" : "false"}
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
        <ul
          className="nav-links"
          data-open={open ? "true" : "false"}
          ref={linksRef}
        >
          {items.map((l) => {
            const isRouter = !l.to.startsWith("#");
            const isActive = isRouter
              ? location.pathname === l.to
              : location.pathname === "/" && activeHash === l.to;
            const cls = isActive ? "is-active" : undefined;
            return (
              <li key={l.label}>
                {l.to.startsWith("#") ? (
                  <a
                    href={l.to}
                    className={cls}
                    aria-current={isActive ? "true" : undefined}
                    onClick={(e) => handleAnchorClick(e, l.to)}
                  >
                    {l.label}
                  </a>
                ) : (
                  <Link
                    to={l.to}
                    className={cls}
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => setOpen(false)}
                  >
                    {l.label}
                  </Link>
                )}
              </li>
            );
          })}
          <li className="nav-links-cta">
            <a href={siteConfig.links.download} className="nav-cta">
              Download APK
            </a>
          </li>
        </ul>
        <a
          href={siteConfig.links.download}
          className="nav-cta nav-cta-desktop"
          data-download
        >
          Download APK
        </a>
        <button
          type="button"
          className="nav-burger"
          aria-label="Toggle navigation"
          aria-expanded={open}
          aria-controls="nav-links"
          ref={burgerRef}
          onClick={() => setOpen((v) => !v)}
        >
          <span></span>
          <span></span>
          <span></span>
        </button>
      </div>
    </nav>
  );
}
