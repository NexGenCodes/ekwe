import { changelog } from "../data/changelog";
import { APP_VERSION } from "@ekwe/shared/version";
import { Nav } from "../components/Nav";
import { Footer } from "../components/Footer";

export default function Changelog() {
  const latestDocumented = changelog[0]?.version ?? null;
  const currentDocumented = changelog.some((c) => c.version === APP_VERSION);
  return (
    <>
      <Nav
        links={[
          { to: "/", label: "Home" },
          { to: "/privacy", label: "Privacy" },
          { to: "/terms", label: "Terms" },
        ]}
      />
      <main className="legal">
        <div className="container">
          <h1>Changelog</h1>
          <p className="legal-date">
            All notable changes to the Ekwe Android app are documented here.
            Current app version: <strong>v{APP_VERSION}</strong>
            {latestDocumented && !currentDocumented ? (
              <> · latest documented release: v{latestDocumented}</>
            ) : null}
          </p>
          {!currentDocumented && latestDocumented ? (
            <p className="legal-note">
              Minor auto-bump releases (v{APP_VERSION}) have no curated notes
              here yet — see GitHub Releases for the full diff.
            </p>
          ) : null}
          <div className="changelog-list">
            {changelog.length === 0 ? (
              <p>No releases yet.</p>
            ) : (
              changelog.map((entry, i) => {
                const tags: string[] = [];
                if (entry.version === APP_VERSION) tags.push("Latest");
                else if (i === 0) tags.push("Latest documented");
                if (/^1\.[01]/.test(entry.version)) tags.push("Legacy");
                return (
                  <div key={entry.version} className="changelog-entry">
                    <div className="changelog-version">
                      <h2>v{entry.version}</h2>
                      {tags.map((t) => (
                        <span
                          key={t}
                          className={t === "Legacy" ? "tag legacy" : "tag"}
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                    <p className="changelog-date">{entry.date}</p>
                    {entry.sections.map((s) => (
                      <div key={s.name}>
                        <h3>{s.name}</h3>
                        <ul>
                          {s.items.map((it, idx) => (
                            <li key={idx}>{it}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
