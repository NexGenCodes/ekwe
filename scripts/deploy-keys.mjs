#!/usr/bin/env node
/**
 * Deploy secrets to the ekwe-proxy worker.
 *
 *   node scripts/deploy-keys.mjs text                        # push text secrets (all non-WIT) from apps/worker/.dev.vars
 *   node scripts/deploy-keys.mjs wit <LANG> [NEW_VALUE]      # rotate ONE Wit key (updates .dev.vars.wit + .dev.vars + store pool)
 *   node scripts/deploy-keys.mjs merge                       # copy Wit keys from .dev.vars.wit back into .dev.vars (for wrangler dev)
 *   node scripts/deploy-keys.mjs split                       # extract Wit keys from .dev.vars into .dev.vars.wit (one-time; auto-runs on first `wit`)
 *   node scripts/deploy-keys.mjs verify                      # show live counts (text, vars, store pools, both files)
 *
 * TWO SOURCE FILES:
 *   - apps/worker/.dev.vars        normal secrets (numbered + single keys); the file `wrangler dev` reads.
 *   - apps/worker/.dev.vars.wit    Wit keys ONLY (these get pushed to the Secrets Store pools).
 *                                  `.dev.vars` keeps a MIRRORED copy of the Wit keys so local
 *                                  `wrangler dev` and check-providers still work. `wit` and `merge`
 *                                  keep that mirror in sync for you.
 *
 * Requirements: CLOUDFLARE_API_TOKEN must be set (the same "opencode" token used for deploys).
 * Token perms: Workers Scripts Write + Secrets Store Write.
 *
 * Safe to commit: contains NO secret values (only account/store IDs). It prints
 * secret lengths only — never the secret itself. The only files it writes are
 * apps/worker/.dev.vars and apps/worker/.dev.vars.wit (both git-ignored).
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ACCOUNT_ID = "b461d91454b7d2aa5e5a90d8226d9819";
const STORE_ID = "5a18c7b65511452a9d7e1d7999831974";
const SCRIPT = "ekwe-proxy";
const DEV_VARS = resolve(process.cwd(), "apps/worker/.dev.vars");
const WIT_VARS = resolve(process.cwd(), "apps/worker/.dev.vars.wit");
const API = "https://api.cloudflare.com/client/v4";

// Keys that live in wrangler.jsonc as vars, not worker secrets:
const VAR_ONLY = new Set(["APP_ENV", "SUPABASE_URL", "TURNSTILE_HOSTNAMES"]);

function token() {
  const t = process.env.CLOUDFLARE_API_TOKEN;
  if (!t) {
    console.error("Missing CLOUDFLARE_API_TOKEN env var.");
    process.exit(1);
  }
  return t;
}

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    const err = body?.errors?.[0] || `HTTP ${res.status}`;
    throw new Error(`${init.method || "GET"} ${path} failed: ${JSON.stringify(err)}`);
  }
  return body.result;
}

const mask = (v) => (v ? `${v.length} chars` : "(empty)");

function readLines(path) {
  if (!existsSync(path)) return { lines: [], get: () => undefined };
  const map = new Map();
  const lines = readFileSync(path, "utf8").split("\n");
  for (const l of lines) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) map.set(m[1], m[2].trim());
  }
  return { lines, get: (key) => map.get(key) ?? undefined };
}

function readWitEntries(path) {
  const { lines } = readLines(path);
  const entries = [];
  for (const l of lines) {
    const m = l.match(/^WIT_KEY_([A-Z]+)=(.*)$/);
    if (m) entries.push([m[1], m[2].trim()]);
  }
  return entries;
}

function buildWitPools(entries) {
  const sorted = [...entries].sort((a, b) => a[0].localeCompare(b[0]));
  const pools = [];
  for (let i = 0; i < sorted.length; i += 17) {
    pools.push(Object.fromEntries(sorted.slice(i, i + 17)));
  }
  return pools;
}

// If .dev.vars.wit doesn't exist yet, create it from the Wit keys in .dev.vars.
function ensureWitFile() {
  if (existsSync(WIT_VARS)) return;
  const entries = readWitEntries(DEV_VARS);
  writeFileSync(WIT_VARS, entries.map(([l, v]) => `WIT_KEY_${l}=${v}`).sort().join("\n") + "\n");
  console.log(`📄 Created ${WIT_VARS} from the Wit keys in ${DEV_VARS}.`);
}

// Signal-copy the Wit keys from .dev.vars.wit into .dev.vars, keeping all other
// lines/comments untouched so local `wrangler dev` still sees them.
function mirrorIntoDevVars() {
  const witMap = new Map(readWitEntries(WIT_VARS));
  const { lines } = readLines(DEV_VARS);
  const seen = new Set();
  const out = lines.map((l) => {
    const m = l.match(/^WIT_KEY_([A-Z]+)=(.*)$/);
    if (!m) return l;
    if (witMap.has(m[1])) {
      seen.add(m[1]);
      return `WIT_KEY_${m[1]}=${witMap.get(m[1])}`;
    }
    return l;
  });
  const missing = [...witMap.keys()].filter((k) => !seen.has(k)).sort();
  if (missing.length) out.push(...missing.map((k) => `WIT_KEY_${k}=${witMap.get(k)}`));
  writeFileSync(DEV_VARS, out.join("\n"));
}

async function storeSecretIds() {
  const list = await api(`/accounts/${ACCOUNT_ID}/secrets_store/stores/${STORE_ID}/secrets`);
  return new Map(list.map((s) => [s.name, s]));
}

/* ------------------------------------------------------------------ */

async function textSecrets() {
  const { lines } = readLines(DEV_VARS);
  const payload = {};
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const [key, value] = [m[1], m[2].trim()];
    if (key.startsWith("WIT_KEY_") || VAR_ONLY.has(key)) continue;
    payload[key] = value;
  }
  await api(`/accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT}/secrets-bulk`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  console.log(`✅ Pushed ${Object.keys(payload).length} text secrets (from ${DEV_VARS}).`);
}

/* ------------------------------------------------------------------ */

async function rotateWit(lang, newValue) {
  lang = String(lang || "").toUpperCase();
  ensureWitFile();

  const key = `WIT_KEY_${lang}`;
  const current = readLines(WIT_VARS).get(key);
  if (!current) {
    console.error(`${key} not found in ${WIT_VARS}.`);
    process.exit(1);
  }

  if (newValue) {
    if (/\s/.test(newValue) || newValue.length < 8) {
      console.error("New value looks wrong (whitespace or too short). Refusing.");
      process.exit(1);
    }
    const { lines } = readLines(WIT_VARS);
    writeFileSync(WIT_VARS, lines.map((l) => (l.startsWith(`${key}=`) ? `${key}=${newValue}` : l)).join("\n"));
    console.log(`✏️  Updated ${key} in ${WIT_VARS} -> ${mask(newValue)}`);
    mirrorIntoDevVars();
    console.log(`   mirrored into ${DEV_VARS} for local dev`);
  } else {
    console.log(`📖 Using existing ${key} from ${WIT_VARS} -> ${mask(current)}`);
  }

  const entries = readWitEntries(WIT_VARS);
  const pools = buildWitPools(entries);
  const poolIdx = pools.findIndex((p) => lang in p);
  if (poolIdx < 0) throw new Error(`Lang ${lang} not in any pool`);
  const value = newValue || current;
  if (pools[poolIdx][lang] !== value) {
    throw new Error("Unexpected pool mismatch — aborting.");
  }

  const ids = await storeSecretIds();
  const poolName = `WIT_POOL_${String(poolIdx + 1).padStart(2, "0")}`;
  const secret = ids.get(poolName);
  if (!secret) throw new Error(`${poolName} not found in store`);

  await api(
    `/accounts/${ACCOUNT_ID}/secrets_store/stores/${STORE_ID}/secrets/${secret.id}`,
    { method: "PATCH", body: JSON.stringify({ value: JSON.stringify(pools[poolIdx]), comment: `rotated ${lang}` }) },
  );

  const poolsOther = pools.map((p) => Object.keys(p).length).join("/");
  console.log(`✅ Patched ${poolName} (${Object.keys(pools[poolIdx]).length} langs, pools: ${poolsOther}).`);
  console.log(`   ${lang}: value written (${String(value).length} chars)`);
  console.log("   No redeploy needed — store edits are live immediately.");
}

/* ------------------------------------------------------------------ */

async function verify() {
  const named = await api(`/accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT}/secrets`);
  const vars = await api(`/accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT}/settings`).catch(() => null);
  const varNames = (vars?.bindings || []).map((b) => b.name);

  const numbered = named.filter((s) => /_KEY_\d+$/.test(s.name));
  const singles = named.filter((s) => !/_KEY_\d+$/.test(s.name));

  console.log(`Worker ${SCRIPT} text secrets: ${named.length}`);
  console.log(`  numbered: ${numbered.length}`);
  console.log(`  singles: ${singles.map((s) => s.name).join(", ")}`);
  console.log(`Wrangler vars in config: ${varNames.filter((n) => VAR_ONLY.has(n)).join(", ")}`);

  const pools = await storeSecretIds();
  console.log(`Secrets Store pools: ${pools.size}`);
  const rows = [...pools.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => `  ${s.name}: ${s.comment || "—"} (modified ${(s.modified || "").slice(0, 16)} UTC)`);
  console.log(rows.join("\n"));

  const dev = readLines(DEV_VARS);
  const witInDev = readWitEntries(DEV_VARS).length;
  const nonWitDev = dev.lines.filter((l) => {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    return m && !m[1].startsWith("WIT_KEY_") && !VAR_ONLY.has(m[1]);
  }).length;
  const witInWit = readWitEntries(WIT_VARS).length;
  console.log(`Files: ${DEV_VARS} = ${nonWitDev} non-WIT + ${witInDev} WIT (mirror)`);
  console.log(`       ${WIT_VARS} = ${witInWit} WIT (source for store)`);

  try {
    const res = await fetch(`https://${SCRIPT}.ekwe.workers.dev/health`);
    const body = await res.json().catch(() => null);
    console.log(`health: HTTP ${res.status} -> ${body?.status ?? body ?? "n/a"}`);
  } catch (e) {
    console.log(`health: unreachable (${e.message})`);
  }
}

/* ------------------------------------------------------------------ */

const [cmd, a, b] = process.argv.slice(2);
try {
  if (cmd === "text") await textSecrets();
  else if (cmd === "wit") await rotateWit(a, b);
  else if (cmd === "merge") {
    ensureWitFile();
    mirrorIntoDevVars();
    const n = readWitEntries(WIT_VARS).length;
    console.log(`✅ Mirrored ${n} Wit keys from ${WIT_VARS} into ${DEV_VARS}.`);
  } else if (cmd === "split") {
    const entries = readWitEntries(DEV_VARS);
    writeFileSync(WIT_VARS, entries.map(([l, v]) => `WIT_KEY_${l}=${v}`).sort().join("\n") + "\n");
    console.log(`✅ Wrote ${entries.length} Wit keys from ${DEV_VARS} into ${WIT_VARS}.`);
  } else if (cmd === "verify") await verify();
  else {
    console.error(
      "Usage:\n  node scripts/deploy-keys.mjs text\n  node scripts/deploy-keys.mjs wit <LANG> [NEW_VALUE]\n  node scripts/deploy-keys.mjs merge\n  node scripts/deploy-keys.mjs split\n  node scripts/deploy-keys.mjs verify",
    );
    process.exit(1);
  }
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exit(1);
}