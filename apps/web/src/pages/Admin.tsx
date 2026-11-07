import { useCallback, useEffect, useState } from "react";
import { siteConfig } from "../data/siteConfig";

const API = "https://ekwe-proxy.ekwe.workers.dev";

interface UserRow {
  id: string;
  email: string;
  tier: string;
  pro_expires_at: number | null;
  display_name?: string | null;
  created_at: number;
}

export default function Admin() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [tier, setTier] = useState("");
  const [lastSync, setLastSync] = useState<string>("");

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (q.trim()) params.set("q", q.trim());
      if (tier) params.set("tier", tier);
      const res = await fetch(`${API}/admin/users?${params}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const body = (await res.json()) as { users?: UserRow[]; total?: number };
      setUsers(body.users ?? []);
      setTotal(body.total ?? 0);
      setError(null);
      setLastSync(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setUsers([]);
    }
  }, [q, tier]);

  async function setPro(id: string, isPro: boolean) {
    if (
      !window.confirm(
        isPro
          ? "Grant lifetime Pro to this user?"
          : "Revoke Pro from this user?",
      )
    )
      return;
    try {
      const res = await fetch(`${API}/admin/users/${id}/pro`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isPro, expiresAt: isPro ? null : null }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    }
  }

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 20_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <main className="legal">
      <div className="container">
        <h1>Admin — {siteConfig.app.name}</h1>
        <p className="legal-date">
          Protected by Cloudflare Access. Polls every 20s. Last sync:{" "}
          {lastSync || "—"} · {total} users
        </p>
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            marginBottom: 16,
          }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by email…"
            aria-label="Filter users by email"
            style={{
              flex: "1 1 220px",
              padding: "12px 16px",
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "var(--bg-secondary)",
              color: "var(--text-primary)",
            }}
          />
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            aria-label="Filter by tier"
            style={{
              padding: "12px 16px",
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "var(--bg-secondary)",
              color: "var(--text-primary)",
            }}
          >
            <option value="">All tiers</option>
            <option value="FREE">FREE</option>
            <option value="PREMIUM">PREMIUM</option>
          </select>
        </div>
        {error && (
          <p style={{ color: "#f87171" }}>
            Could not load users: {error}. Sign in with your ADMIN_EMAILS Google
            account (Access), then refresh.
          </p>
        )}
        {!users && !error && <p>Loading…</p>}
        {users && users.length === 0 && !error && <p>No users match.</p>}
        {users && users.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "0.9rem",
              }}
            >
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: 8 }}>Email</th>
                  <th style={{ textAlign: "left", padding: 8 }}>Tier</th>
                  <th style={{ textAlign: "left", padding: 8 }}>Expires</th>
                  <th style={{ textAlign: "left", padding: 8 }}>Created</th>
                  <th style={{ textAlign: "left", padding: 8 }}></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isPro = u.tier === "PREMIUM";
                  return (
                    <tr
                      key={u.id}
                      style={{ borderTop: "1px solid var(--border)" }}
                    >
                      <td style={{ padding: 8 }}>{u.email}</td>
                      <td style={{ padding: 8 }}>{u.tier}</td>
                      <td style={{ padding: 8 }}>
                        {u.pro_expires_at
                          ? new Date(u.pro_expires_at).toLocaleDateString()
                          : "—"}
                      </td>
                      <td style={{ padding: 8 }}>
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                      <td style={{ padding: 8 }}>
                        <button
                          type="button"
                          onClick={() => void setPro(u.id, !isPro)}
                          style={{
                            padding: "8px 14px",
                            borderRadius: 8,
                            border: "1px solid var(--border)",
                            background: isPro
                              ? "var(--bg-card)"
                              : "var(--accent)",
                            color: isPro
                              ? "var(--text-primary)"
                              : "var(--bg-primary)",
                            cursor: "pointer",
                          }}
                        >
                          {isPro ? "Revoke" : "Grant Pro"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
