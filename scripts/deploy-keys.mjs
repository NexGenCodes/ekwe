#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT_DIR = resolve(dirname(SCRIPT_PATH), "..");
const WORKER_DIR = join(ROOT_DIR, "apps/worker");
const DEV_VARS_PATH = join(WORKER_DIR, ".dev.vars");
const STORE_VARS_PATH = join(WORKER_DIR, ".dev.vars.store");
const LEGACY_WIT_VARS_PATH = join(WORKER_DIR, ".dev.vars.wit");
const WRANGLER_CONFIG_PATH = join(WORKER_DIR, "wrangler.jsonc");
const WIT_PROVIDER_PATH = join(WORKER_DIR, "src/providers/witai.ts");
const PERSIST_DIR = join(WORKER_DIR, ".wrangler/state");
const WRANGLER_BIN = join(WORKER_DIR, "node_modules/.bin/wrangler");
const DEFAULT_ACCOUNT_ID = "b461d91454b7d2aa5e5a90d8226d9819";
const API_ORIGIN = "https://api.cloudflare.com/client/v4";
const POOL_SIZE = 17;
const MAX_POOL_BYTES = 1024;
const MAX_WORKER_SECRET_BYTES = 5 * 1024;
const WORKER_SCOPES = ["workers"];

function parseJsonc(text) {
  let output = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
        output += character;
      } else {
        output += " ";
      }
      continue;
    }

    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        output += "  ";
        index += 1;
      } else {
        output += character === "\n" ? "\n" : " ";
      }
      continue;
    }

    if (!inString && character === "/" && next === "/") {
      lineComment = true;
      output += "  ";
      index += 1;
      continue;
    }

    if (!inString && character === "/" && next === "*") {
      blockComment = true;
      output += "  ";
      index += 1;
      continue;
    }

    output += character;

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
    } else if (character === '"') {
      inString = true;
    }
  }

  if (inString || blockComment) {
    throw new Error("Invalid JSONC input");
  }

  return JSON.parse(output);
}

function parseEnv(text) {
  const entries = [];
  const values = new Map();

  for (const [lineNumber, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = rawLine.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      throw new Error(`Invalid dotenv assignment at line ${lineNumber + 1}`);
    }

    const key = match[1];
    const rawValue = match[2].trim();
    let value = rawValue;

    if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
      try {
        value = JSON.parse(rawValue);
      } catch {
        value = rawValue.slice(1, -1);
      }
    } else if (rawValue.startsWith("'") && rawValue.endsWith("'")) {
      value = rawValue.slice(1, -1).replace(/\\'/g, "'");
    } else {
      value = rawValue.replace(/\s+#.*$/, "").trim();
    }

    if (typeof value !== "string") {
      throw new Error(`Invalid value for ${key}`);
    }
    if (values.has(key)) {
      throw new Error(`Duplicate dotenv key: ${key}`);
    }

    entries.push([key, value]);
    values.set(key, value);
  }

  return { entries, values };
}

function serializeEnv(entries) {
  return `${entries.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n")}\n`;
}

function canUseDirectDotenv(entries) {
  return entries.every(
    ([, value]) =>
      value === value.trim() &&
      !/[\x00-\x1F\x7F]/.test(value) &&
      !value.includes("#") &&
      !value.includes("\\") &&
      !value.includes('"') &&
      !value.includes("'"),
  );
}

function loadProjectConfig() {
  const config = parseJsonc(readFileSync(WRANGLER_CONFIG_PATH, "utf8"));
  if (!config.name || typeof config.name !== "string") {
    throw new Error(`Missing Worker name in ${WRANGLER_CONFIG_PATH}`);
  }
  if (!Array.isArray(config.secrets_store_secrets) || config.secrets_store_secrets.length === 0) {
    throw new Error(`Missing Secrets Store bindings in ${WRANGLER_CONFIG_PATH}`);
  }

  const poolBindings = config.secrets_store_secrets.map((binding) => {
    if (!binding.binding || !binding.secret_name || !binding.store_id) {
      throw new Error("Invalid Secrets Store binding");
    }
    return {
      binding: binding.binding,
      secretName: binding.secret_name,
      storeId: binding.store_id,
    };
  });
  const storeIds = new Set(poolBindings.map((binding) => binding.storeId));
  if (storeIds.size !== 1) {
    throw new Error("All Secrets Store bindings must use one store_id");
  }

  return {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID || config.account_id || DEFAULT_ACCOUNT_ID,
    workerName: config.name,
    varNames: new Set(Object.keys(config.vars || {})),
    poolBindings,
    storeId: poolBindings[0].storeId,
  };
}

function extractWitLanguages() {
  const source = readFileSync(WIT_PROVIDER_PATH, "utf8");
  const startToken = "const WITAI_LANGUAGES = new Set([";
  const start = source.indexOf(startToken);
  const end = source.indexOf("]);", start);
  if (start < 0 || end < 0) {
    throw new Error(`Unable to find WITAI_LANGUAGES in ${WIT_PROVIDER_PATH}`);
  }
  const block = source.slice(start, end);
  const languages = [...block.matchAll(/"([a-z]{2})"/g)].map((match) => match[1].toUpperCase());
  const unique = [...new Set(languages)].sort();
  if (unique.length === 0) {
    throw new Error("No WIT.ai languages found");
  }
  return unique;
}

function poolDigest(name, values) {
  const hash = createHash("sha256");
  hash.update(name);
  for (const [language, value] of [...values].sort(([left], [right]) => left.localeCompare(right))) {
    hash.update("\0");
    hash.update(language);
    hash.update("\0");
    hash.update(value);
  }
  return hash.digest("hex").slice(0, 20);
}

function buildWitPools(entries, bindings) {
  const sorted = [...entries].sort(([left], [right]) => left.localeCompare(right));
  const chunks = [];
  for (let index = 0; index < sorted.length; index += POOL_SIZE) {
    chunks.push(sorted.slice(index, index + POOL_SIZE));
  }
  if (chunks.length > bindings.length) {
    throw new Error(`${chunks.length} WIT pools require ${bindings.length} configured bindings`);
  }

  return chunks.map((chunk, index) => {
    const binding = bindings[index];
    const languageValues = chunk.map(([key, value]) => [key.slice("WIT_KEY_".length), value]);
    const value = JSON.stringify(Object.fromEntries(languageValues));
    return {
      binding: binding.binding,
      name: binding.secretName,
      value,
      digest: poolDigest(binding.secretName, languageValues),
      languageCount: languageValues.length,
    };
  });
}

function compareNameSets(expected, actual) {
  const expectedSet = expected instanceof Set ? expected : new Set(expected);
  const actualSet = actual instanceof Set ? actual : new Set(actual);
  return {
    missing: [...expectedSet].filter((name) => !actualSet.has(name)).sort(),
    unexpected: [...actualSet].filter((name) => !expectedSet.has(name)).sort(),
  };
}

function isPlaceholder(value) {
  return /^(?:your[-_].*|replace[-_]?me|change[-_]?me|<.*>|\$\{.*\})$/i.test(value);
}

function assertNoIssues(issues) {
  if (issues.length > 0) {
    throw new Error(issues.map((issue) => `- ${issue}`).join("\n"));
  }
}

function readSources() {
  if (!existsSync(DEV_VARS_PATH)) {
    throw new Error(`Missing ${DEV_VARS_PATH}`);
  }
  if (!existsSync(STORE_VARS_PATH)) {
    throw new Error(`Missing ${STORE_VARS_PATH}; run migrate first`);
  }
  return {
    config: loadProjectConfig(),
    dev: parseEnv(readFileSync(DEV_VARS_PATH, "utf8")),
    store: parseEnv(readFileSync(STORE_VARS_PATH, "utf8")),
  };
}

function validateWitEntries(entries, config, label = "WIT source") {
  const issues = [];
  const witEntries = entries.filter(([key]) => key.startsWith("WIT_KEY_"));
  const otherEntries = entries.filter(([key]) => !key.startsWith("WIT_KEY_"));
  if (otherEntries.length > 0) {
    issues.push(`${label} contains ${otherEntries.length} non-WIT keys`);
  }

  const expectedWitNames = new Set(extractWitLanguages().map((language) => `WIT_KEY_${language}`));
  const actualWitNames = new Set(witEntries.map(([key]) => key));
  const witDiff = compareNameSets(expectedWitNames, actualWitNames);
  if (witDiff.missing.length > 0) {
    issues.push(`Missing WIT keys: ${witDiff.missing.join(", ")}`);
  }
  if (witDiff.unexpected.length > 0) {
    issues.push(`Unexpected WIT keys: ${witDiff.unexpected.join(", ")}`);
  }

  for (const [key, value] of witEntries) {
    if (!value.trim()) issues.push(`${key} is empty`);
    if (isPlaceholder(value)) issues.push(`${key} contains a placeholder`);
    if (Buffer.byteLength(value, "utf8") > MAX_POOL_BYTES) {
      issues.push(`${key} exceeds ${MAX_POOL_BYTES} bytes`);
    }
  }

  let pools = [];
  try {
    pools = buildWitPools(witEntries, config.poolBindings);
    for (const pool of pools) {
      const bytes = Buffer.byteLength(pool.value, "utf8");
      if (bytes > MAX_POOL_BYTES) {
        issues.push(`${pool.name} is ${bytes} bytes; maximum is ${MAX_POOL_BYTES}`);
      }
    }
    if (pools.length !== config.poolBindings.length) {
      issues.push(`${pools.length} populated pools for ${config.poolBindings.length} configured bindings`);
    }
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  return { issues, pools };
}

function validateTextEntries(entries) {
  const issues = [];
  for (const [key, value] of entries) {
    if (!value.trim()) issues.push(`${key} is empty`);
    if (isPlaceholder(value)) issues.push(`${key} contains a placeholder`);
    if (Buffer.byteLength(value, "utf8") > MAX_WORKER_SECRET_BYTES) {
      issues.push(`${key} exceeds ${MAX_WORKER_SECRET_BYTES} bytes`);
    }
  }
  return issues;
}

function validateSources({ checkModes = true } = {}) {
  const sources = readSources();
  const { config, dev, store } = sources;
  const issues = [];

  if (checkModes) {
    for (const path of [DEV_VARS_PATH, STORE_VARS_PATH]) {
      if ((statSync(path).mode & 0o077) !== 0) {
        issues.push(`${path} must not be accessible by group or other users`);
      }
    }
  }

  const devWitEntries = dev.entries.filter(([key]) => key.startsWith("WIT_KEY_"));
  if (devWitEntries.length > 0) {
    issues.push(`${DEV_VARS_PATH} contains ${devWitEntries.length} WIT keys; run migrate`);
  }

  const witValidation = validateWitEntries(store.entries, config, STORE_VARS_PATH);
  issues.push(...witValidation.issues);
  const textEntries = dev.entries.filter(([key]) => !config.varNames.has(key));
  issues.push(...validateTextEntries(textEntries));

  assertNoIssues(issues);
  return { ...sources, textEntries, pools: witValidation.pools };
}

function atomicWrite(path, content, mode = 0o600) {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporaryPath, "wx", mode);
    writeFileSync(descriptor, content, { encoding: "utf8", mode });
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporaryPath, path);
    chmodSync(path, mode);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function walkPersistDir(visitor) {
  if (!existsSync(PERSIST_DIR)) return;
  const visit = (path) => {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) return;
    if (stats.isDirectory()) {
      visitor(path, stats);
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        visit(join(path, entry.name));
      }
    } else {
      visitor(path, stats);
    }
  };
  visit(PERSIST_DIR);
}

function hardenPersistDir() {
  walkPersistDir((path, stats) => {
    chmodSync(path, stats.isDirectory() ? 0o700 : 0o600);
  });
}

function persistPermissionIssues() {
  const issues = [];
  walkPersistDir((path, stats) => {
    const forbiddenBits = stats.isDirectory() ? 0o077 : 0o077;
    if ((stats.mode & forbiddenBits) !== 0) issues.push(`${path} is accessible by group or other users`);
  });
  return issues;
}

function isWitAssignmentLine(line) {
  return /^(?:export\s+)?WIT_KEY_[A-Za-z0-9_]+\s*=/.test(line);
}

function migrate() {
  if (!existsSync(DEV_VARS_PATH)) {
    throw new Error(`Missing ${DEV_VARS_PATH}`);
  }

  const config = loadProjectConfig();
  const devText = readFileSync(DEV_VARS_PATH, "utf8");
  const dev = parseEnv(devText);
  const sources = [{ label: DEV_VARS_PATH, entries: dev.entries }];
  const issues = [];

  if (existsSync(STORE_VARS_PATH)) {
    sources.push({ label: STORE_VARS_PATH, entries: parseEnv(readFileSync(STORE_VARS_PATH, "utf8")).entries });
  }
  if (existsSync(LEGACY_WIT_VARS_PATH)) {
    sources.push({
      label: LEGACY_WIT_VARS_PATH,
      entries: parseEnv(readFileSync(LEGACY_WIT_VARS_PATH, "utf8")).entries,
    });
  }

  const values = new Map();
  for (const source of sources) {
    for (const [key, value] of source.entries) {
      if (!key.startsWith("WIT_KEY_")) {
        if (source.label !== DEV_VARS_PATH) issues.push(`${source.label} contains non-WIT key ${key}`);
        continue;
      }
      if (values.has(key) && values.get(key) !== value) {
        issues.push(`Conflicting values for ${key}`);
      } else {
        values.set(key, value);
      }
    }
  }

  const candidateEntries = [...values.entries()].sort(([left], [right]) => left.localeCompare(right));
  const witValidation = validateWitEntries(candidateEntries, config, "Migrated WIT source");
  const textEntries = dev.entries.filter(([key]) => !config.varNames.has(key));
  issues.push(...witValidation.issues, ...validateTextEntries(textEntries));
  assertNoIssues([...new Set(issues)]);

  const storeContent = serializeEnv(candidateEntries);
  if (!existsSync(STORE_VARS_PATH) || readFileSync(STORE_VARS_PATH, "utf8") !== storeContent) {
    atomicWrite(STORE_VARS_PATH, storeContent);
  }

  const filteredLines = devText.split(/\r?\n/).filter((line) => !isWitAssignmentLine(line));
  const filteredText = `${filteredLines.join("\n").replace(/\n+$/, "")}\n`;
  if (filteredText !== devText) atomicWrite(DEV_VARS_PATH, filteredText);
  chmodSync(DEV_VARS_PATH, 0o600);
  chmodSync(STORE_VARS_PATH, 0o600);

  const validated = validateSources();
  if (existsSync(LEGACY_WIT_VARS_PATH)) unlinkSync(LEGACY_WIT_VARS_PATH);
  console.log(`Migrated ${validated.pools.length} WIT pools and ${validated.textEntries.length} Worker secrets.`);
}

function check() {
  const validated = validateSources();
  console.log(
    `Checked ${validated.textEntries.length} Worker secrets and ${validated.store.entries.length} WIT keys across ${validated.pools.length} pools.`,
  );
}

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function runWrangler(args, input = "", { accountId, sensitive = false } = {}) {
  if (!existsSync(WRANGLER_BIN)) {
    throw new Error(`Wrangler is not installed at ${WRANGLER_BIN}`);
  }

  const env = {
    ...process.env,
    WRANGLER_LOG_SANITIZE: "true",
    WRANGLER_WRITE_LOGS: "false",
    ...(accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : {}),
  };

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(WRANGLER_BIN, args, {
      cwd: WORKER_DIR,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let settled = false;

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.stdin.on("error", () => {});
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        rejectPromise(error);
      }
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      const output = `${Buffer.concat(stdout).toString("utf8")}${Buffer.concat(stderr).toString("utf8")}`;
      if (code !== 0) {
        const detail = sensitive ? "" : `: ${stripAnsi(output).trim()}`;
        rejectPromise(new Error(`Wrangler failed (${code})${detail}`));
        return;
      }
      resolvePromise(stripAnsi(output));
    });

    child.stdin.end(input);
  });
}

export function parseLocalStoreList(output, storeId) {
  const records = new Map();
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    const separator = trimmed.includes("│") ? "│" : "|";
    if (!trimmed.startsWith(separator)) continue;

    const cells = trimmed
      .split(separator)
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length !== 7 && cells.length !== 8) continue;
    if (!/^[A-Z][A-Z0-9_]*$/.test(cells[0]) || !/^[a-f0-9]{32}$/i.test(cells[1])) {
      continue;
    }

    const hasStoreColumn = cells.length === 8 && /^[a-f0-9]{32}$/i.test(cells[2]);
    const offset = hasStoreColumn ? 1 : 0;
    const record = {
      name: cells[0],
      id: cells[1],
      storeId: hasStoreColumn ? cells[2] : storeId,
      comment: cells[2 + offset] ?? "",
      scopes: (cells[3 + offset] ?? "")
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean),
      status: (cells[4 + offset] ?? "").toLowerCase(),
    };
    if (!/^(?:pending|active|deleted)$/.test(record.status)) continue;
    if (record.storeId !== storeId || record.status === "deleted") continue;
    if (records.has(record.name)) {
      throw new Error(`Duplicate local Store secret: ${record.name}`);
    }
    records.set(record.name, record);
  }
  return records;
}

async function listLocalStore(config) {
  try {
    const output = await runWrangler([
      "secrets-store",
      "secret",
      "list",
      config.storeId,
      "--per-page",
      "100",
      "--persist-to",
      PERSIST_DIR,
    ]);
    return parseLocalStoreList(output, config.storeId);
  } catch (error) {
    if (error instanceof Error && /List request returned no secrets\./i.test(error.message)) {
      return new Map();
    }
    throw error;
  }
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function waitForStoreRecords(listRecords, config, pools, expectedStatus, verifyMetadata) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() <= deadline) {
    try {
      const records = await listRecords(config);
      validateStoreRecords(records, pools, expectedStatus, verifyMetadata);
      return records;
    } catch (error) {
      lastError = error;
    }
    await delay(1_000);
  }
  throw lastError instanceof Error ? lastError : new Error("Timed out waiting for Store synchronization");
}

function validateStoreRecords(records, pools, expectedStatus, verifyMetadata = true) {
  const issues = [];
  const expectedNames = new Set(pools.map((pool) => pool.name));
  const diff = compareNameSets(expectedNames, records.keys());
  if (diff.missing.length > 0) issues.push(`Missing Store secrets: ${diff.missing.join(", ")}`);
  if (diff.unexpected.length > 0) issues.push(`Unexpected Store secrets: ${diff.unexpected.join(", ")}`);

  for (const pool of pools) {
    const record = records.get(pool.name);
    if (!record) continue;
    if (verifyMetadata) {
      const expectedComment = `ekwe-managed:${pool.digest}`;
      if (record.comment !== expectedComment) {
        issues.push(`${pool.name} is not synchronized with the current source`);
      }
      if (!record.scopes.includes("workers")) {
        issues.push(`${pool.name} is missing the workers scope`);
      }
    }
    if (record.status !== expectedStatus) {
      issues.push(`${pool.name} has status ${record.status}; expected ${expectedStatus}`);
    }
  }
  assertNoIssues(issues);
}

async function syncLocalStore(validated) {
  const before = await listLocalStore(validated.config);
  for (const pool of validated.pools) {
    const existing = before.get(pool.name);
    const comment = `ekwe-managed:${pool.digest}`;
    const args = existing
      ? [
          "secrets-store",
          "secret",
          "update",
          validated.config.storeId,
          "--secret-id",
          existing.id,
          "--scopes",
          WORKER_SCOPES.join(","),
          "--comment",
          comment,
          "--persist-to",
          PERSIST_DIR,
        ]
      : [
          "secrets-store",
          "secret",
          "create",
          validated.config.storeId,
          "--name",
          pool.name,
          "--scopes",
          WORKER_SCOPES.join(","),
          "--comment",
          comment,
          "--persist-to",
          PERSIST_DIR,
        ];
    await runWrangler(args, `${pool.value}\n`, { sensitive: true });
  }
  hardenPersistDir();
  await waitForStoreRecords(listLocalStore, validated.config, validated.pools, "active", false);
}

async function verifyLocal() {
  const validated = validateSources();
  assertNoIssues(persistPermissionIssues());
  const records = await listLocalStore(validated.config);
  validateStoreRecords(records, validated.pools, "active", false);
  console.log(`Local Store contains ${validated.pools.length} synchronized WIT pools.`);
}

function apiToken() {
  const value = process.env.CLOUDFLARE_API_TOKEN;
  if (!value) {
    throw new Error("Missing CLOUDFLARE_API_TOKEN");
  }
  return value;
}

async function apiRequestEnvelope(config, path, init = {}) {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken()}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = Array.isArray(body?.errors)
      ? body.errors.map((error) => error.message).filter(Boolean).join("; ")
      : `HTTP ${response.status}`;
    throw new Error(`${init.method || "GET"} ${path} failed: ${message}`);
  }
  if (body === null) return { result: null, resultInfo: null };
  if (!body.success) {
    const message = Array.isArray(body.errors)
      ? body.errors.map((error) => error.message).filter(Boolean).join("; ")
      : "API request failed";
    throw new Error(`${init.method || "GET"} ${path} failed: ${message}`);
  }
  return { result: body.result, resultInfo: body.result_info };
}

async function apiRequest(config, path, init = {}) {
  return (await apiRequestEnvelope(config, path, init)).result;
}

async function apiListAll(config, path) {
  const results = [];
  let page = 1;
  while (true) {
    const separator = path.includes("?") ? "&" : "?";
    const { result, resultInfo } = await apiRequestEnvelope(
      config,
      `${path}${separator}page=${page}&per_page=100`,
    );
    if (!Array.isArray(result)) {
      throw new Error(`Expected an array from ${path}`);
    }
    results.push(...result);

    const totalPages = Number(resultInfo?.total_pages);
    if (Number.isInteger(totalPages) && totalPages > 0) {
      if (page >= totalPages) break;
    } else if (result.length < 100) {
      break;
    } else {
      throw new Error(`Pagination metadata missing from ${path}`);
    }
    page += 1;
  }
  return results;
}

async function listRemoteStore(config) {
  const records = await apiListAll(
    config,
    `/accounts/${config.accountId}/secrets_store/stores/${config.storeId}/secrets`,
  );
  return new Map(records.map((record) => [record.name, record]));
}

async function syncRemoteStore(validated, prune) {
  const before = await listRemoteStore(validated.config);
  for (const pool of validated.pools) {
    const existing = before.get(pool.name);
    const body = {
      value: pool.value,
      scopes: WORKER_SCOPES,
      comment: `ekwe-managed:${pool.digest}`,
    };
    if (existing) {
      await apiRequest(
        validated.config,
        `/accounts/${validated.config.accountId}/secrets_store/stores/${validated.config.storeId}/secrets/${existing.id}`,
        { method: "PATCH", body: JSON.stringify(body) },
      );
    } else {
      await apiRequest(
        validated.config,
        `/accounts/${validated.config.accountId}/secrets_store/stores/${validated.config.storeId}/secrets`,
        {
          method: "POST",
          body: JSON.stringify([{ name: pool.name, ...body }]),
        },
      );
    }
  }

  if (prune) {
    const expectedNames = new Set(validated.pools.map((pool) => pool.name));
    for (const record of before.values()) {
      if (expectedNames.has(record.name)) continue;
      await apiRequest(
        validated.config,
        `/accounts/${validated.config.accountId}/secrets_store/stores/${validated.config.storeId}/secrets/${record.id}`,
        { method: "DELETE" },
      );
    }
  }

  await waitForStoreRecords(listRemoteStore, validated.config, validated.pools, "active", true);
}

async function listRemoteWorkerSecrets(config) {
  const result = await apiRequest(
    config,
    `/accounts/${config.accountId}/workers/scripts/${config.workerName}/secrets`,
  );
  if (!Array.isArray(result)) {
    throw new Error("Expected an array from Worker secrets endpoint");
  }
  return result;
}

function writeBulkFile(directory, entries, index) {
  const dotenvSafe = canUseDirectDotenv(entries);
  const extension = dotenvSafe ? ".env" : ".json";
  const file = join(directory, `secrets-${index}${extension}`);
  const content = dotenvSafe ? serializeEnv(entries) : JSON.stringify(Object.fromEntries(entries));
  writeFileSync(file, content, { encoding: "utf8", mode: 0o600 });
  return file;
}

async function syncRemoteWorkerSecrets(validated, prune) {
  const current = await listRemoteWorkerSecrets(validated.config);
  const currentNames = new Set(current.map((secret) => secret.name));
  const expectedNames = new Set(validated.textEntries.map(([key]) => key));
  if (expectedNames.size === 0) throw new Error("No Worker secrets to synchronize");

  if (validated.textEntries.length <= 100) {
    const directFile =
      validated.textEntries.length === validated.dev.entries.length && canUseDirectDotenv(validated.textEntries)
        ? DEV_VARS_PATH
        : undefined;
    const temporaryDirectory = directFile ? undefined : mkdtempSync(join(tmpdir(), "ekwe-worker-secrets-"));
    const file = directFile ?? writeBulkFile(temporaryDirectory, validated.textEntries, 1);
    try {
      await runWrangler(["secret", "bulk", file, "--config", WRANGLER_CONFIG_PATH], "", {
        accountId: validated.config.accountId,
        sensitive: true,
      });
    } finally {
      if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  } else {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "ekwe-worker-secrets-"));
    try {
      for (let index = 0; index < validated.textEntries.length; index += 100) {
        const file = writeBulkFile(
          temporaryDirectory,
          validated.textEntries.slice(index, index + 100),
          index / 100 + 1,
        );
        await runWrangler(["secret", "bulk", file, "--config", WRANGLER_CONFIG_PATH], "", {
          accountId: validated.config.accountId,
          sensitive: true,
        });
      }
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }

  if (prune) {
    for (const name of currentNames) {
      if (!expectedNames.has(name)) {
        await runWrangler(["secret", "delete", name, "--config", WRANGLER_CONFIG_PATH], "", {
          accountId: validated.config.accountId,
        });
      }
    }
  }

  const after = await listRemoteWorkerSecrets(validated.config);
  const afterNames = new Set(after.map((secret) => secret.name));
  const diff = compareNameSets(expectedNames, afterNames);
  const issues = [];
  if (diff.missing.length > 0) issues.push(`Missing Worker secrets: ${diff.missing.join(", ")}`);
  if (!prune && diff.unexpected.length > 0) {
    issues.push(`Unexpected Worker secrets: ${diff.unexpected.join(", ")}`);
  }
  assertNoIssues(issues);
}

async function verifyRemote() {
  const validated = validateSources();
  const { config } = validated;
  const issues = [];
  const expectedTextNames = new Set(validated.textEntries.map(([key]) => key));
  const remoteText = await listRemoteWorkerSecrets(config);
  const remoteTextNames = new Set(remoteText.map((secret) => secret.name));
  const textDiff = compareNameSets(expectedTextNames, remoteTextNames);
  if (textDiff.missing.length > 0) issues.push(`Missing Worker secrets: ${textDiff.missing.join(", ")}`);
  if (textDiff.unexpected.length > 0) issues.push(`Unexpected Worker secrets: ${textDiff.unexpected.join(", ")}`);

  const settings = await apiRequest(config, `/accounts/${config.accountId}/workers/scripts/${config.workerName}/settings`);
  const deployedBindings = new Map(
    (settings.bindings || []).map((binding) => [binding.name, binding]),
  );
  for (const name of config.varNames) {
    if (!deployedBindings.has(name)) issues.push(`Missing Worker var: ${name}`);
  }
  for (const binding of config.poolBindings) {
    const deployed = deployedBindings.get(binding.binding);
    if (!deployed) {
      issues.push(`Missing Store binding: ${binding.binding}`);
      continue;
    }
    if (
      deployed.type !== "secrets_store_secret" ||
      deployed.store_id !== binding.storeId ||
      deployed.secret_name !== binding.secretName
    ) {
      issues.push(`Store binding ${binding.binding} points to the wrong secret`);
    }
  }

  const remoteStore = await listRemoteStore(config);
  try {
    validateStoreRecords(remoteStore, validated.pools, "active");
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  let quota = null;
  try {
    quota = await apiRequest(config, `/accounts/${config.accountId}/secrets_store/quota`);
  } catch {
    quota = null;
  }

  assertNoIssues(issues);
  console.log(
    `Verified ${expectedTextNames.size} Worker secrets, ${config.varNames.size} vars, and ${validated.pools.length} synchronized Store pools.`,
  );
  if (quota?.secrets) {
    console.log(`Secrets Store quota: ${quota.secrets.usage}/${quota.secrets.quota} used.`);
  }
}

async function syncRemote(prune) {
  const validated = validateSources();
  await syncRemoteWorkerSecrets(validated, prune);
  await syncRemoteStore(validated, prune);
  await verifyRemote();
  console.log(`Remote synchronization complete${prune ? " with pruning" : ""}.`);
}

function readHiddenValue(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Secret rotation requires an interactive terminal");
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const input = process.stdin;
    const output = process.stdout;
    let value = "";
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    output.write(prompt);

    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      output.write("\n");
    };

    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          cleanup();
          rejectPromise(new Error("Cancelled"));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolvePromise(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= " ") value += character;
      }
    };

    input.on("data", onData);
  });
}

async function rotateWit(language, extraArguments) {
  if (extraArguments) {
    throw new Error("Secret values cannot be passed as command arguments");
  }
  const validated = validateSources();
  const normalizedLanguage = String(language || "").trim().toUpperCase();
  const key = `WIT_KEY_${normalizedLanguage}`;
  if (!validated.store.values.has(key)) {
    throw new Error(`Unknown WIT key: ${key}`);
  }

  const newValue = await readHiddenValue(`New value for ${key}: `);
  if (!/^[\x21-\x7E]+$/.test(newValue) || newValue.length < 8) {
    throw new Error("New value must contain at least 8 printable ASCII characters without whitespace");
  }

  const updatedEntries = validated.store.entries.map(([name, value]) => [name, name === key ? newValue : value]);
  const updatedValidation = validateWitEntries(updatedEntries, validated.config, "Rotated WIT source");
  assertNoIssues(updatedValidation.issues);
  const updatedPools = updatedValidation.pools;
  atomicWrite(STORE_VARS_PATH, serializeEnv(updatedEntries));
  console.log(`Updated ${STORE_VARS_PATH}; synchronizing all affected pools.`);

  try {
    await syncRemoteStore({ ...validated, pools: updatedPools }, false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\nThe local source was updated; run secrets:sync-remote to retry.`);
  }
  await syncLocalStore({ ...validated, pools: updatedPools });
  console.log(`Rotated ${key} across ${updatedPools.length} validated pools.`);
}

function usage() {
  return [
    "Usage:",
    "  node scripts/deploy-keys.mjs migrate",
    "  node scripts/deploy-keys.mjs check",
    "  node scripts/deploy-keys.mjs verify-local",
    "  node scripts/deploy-keys.mjs sync-local",
    "  node scripts/deploy-keys.mjs verify",
    "  node scripts/deploy-keys.mjs sync-remote [--prune]",
    "  node scripts/deploy-keys.mjs rotate <LANG>",
  ].join("\n");
}

async function main() {
  const [command, ...argumentsList] = process.argv.slice(2);
  const prune = argumentsList.includes("--prune");
  const positional = argumentsList.filter((argument) => argument !== "--prune");

  if (command === "migrate") migrate();
  else if (command === "check") check();
  else if (command === "verify-local") await verifyLocal();
  else if (command === "sync-local") {
    const validated = validateSources();
    await syncLocalStore(validated);
    console.log(`Synchronized ${validated.pools.length} WIT pools to ${PERSIST_DIR}.`);
  } else if (command === "verify") await verifyRemote();
  else if (command === "sync-remote") await syncRemote(prune);
  else if (command === "rotate") await rotateWit(positional[0], positional.slice(1));
  else throw new Error(usage());
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export {
  buildWitPools,
  canUseDirectDotenv,
  compareNameSets,
  extractWitLanguages,
  parseEnv,
  parseJsonc,
  poolDigest,
  serializeEnv,
  validateSources,
};
