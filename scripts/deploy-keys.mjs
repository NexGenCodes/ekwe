#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdtempSync,
  openSync,
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
const WRANGLER_CONFIG_PATH = join(WORKER_DIR, "wrangler.jsonc");
const WRANGLER_BIN = join(WORKER_DIR, "node_modules/.bin/wrangler");
const DEFAULT_ACCOUNT_ID = "b461d91454b7d2aa5e5a90d8226d9819";
const API_ORIGIN = "https://api.cloudflare.com/client/v4";
const MAX_WORKER_SECRET_BYTES = 5 * 1024;

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
  return {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID || config.account_id || DEFAULT_ACCOUNT_ID,
    workerName: config.name,
    varNames: new Set(Object.keys(config.vars || {})),
  };
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

function validateSecretEntries(entries) {
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
  if (!existsSync(DEV_VARS_PATH)) {
    throw new Error(`Missing ${DEV_VARS_PATH}`);
  }

  const config = loadProjectConfig();
  const dev = parseEnv(readFileSync(DEV_VARS_PATH, "utf8"));
  const issues = [];

  if (checkModes && (statSync(DEV_VARS_PATH).mode & 0o077) !== 0) {
    issues.push(`${DEV_VARS_PATH} must not be accessible by group or other users`);
  }

  const textEntries = dev.entries.filter(([key]) => !config.varNames.has(key));
  issues.push(...validateSecretEntries(textEntries));

  assertNoIssues(issues);
  return { config, dev, textEntries };
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

function check() {
  const validated = validateSources();
  console.log(
    `Checked ${validated.textEntries.length} Worker secrets (${[...validated.config.varNames].sort().join(", ") || "no vars"}).`,
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

  assertNoIssues(issues);
  console.log(
    `Verified ${expectedTextNames.size} Worker secrets and ${config.varNames.size} vars.`,
  );
}

async function syncRemote(prune) {
  const validated = validateSources();
  await syncRemoteWorkerSecrets(validated, prune);
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

async function rotateSecret(keyArgument, extraArguments) {
  if (extraArguments) {
    throw new Error("Secret values cannot be passed as command arguments");
  }
  const validated = validateSources();
  let key = String(keyArgument || "").trim().toUpperCase();
  if (!validated.dev.values.has(key) && !key.startsWith("WIT_KEY_")) {
    const witKey = `WIT_KEY_${key}`;
    if (validated.dev.values.has(witKey)) key = witKey;
  }
  if (!validated.dev.values.has(key)) {
    throw new Error(`Unknown secret: ${key}`);
  }

  const newValue = await readHiddenValue(`New value for ${key}: `);
  if (!/^[\x21-\x7E]+$/.test(newValue) || newValue.length < 8) {
    throw new Error("New value must contain at least 8 printable ASCII characters without whitespace");
  }

  const updatedEntries = validated.dev.entries.map(([name, value]) => [name, name === key ? newValue : value]);
  assertNoIssues(validateSecretEntries(updatedEntries.filter(([name]) => name === key)));
  atomicWrite(DEV_VARS_PATH, serializeEnv(updatedEntries));
  console.log(`Updated ${DEV_VARS_PATH}; synchronizing remote.`);

  try {
    await syncRemote(false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\nThe local source was updated; run secrets:sync-remote to retry.`);
  }
  console.log(`Rotated ${key}.`);
}

function usage() {
  return [
    "Usage:",
    "  node scripts/deploy-keys.mjs check",
    "  node scripts/deploy-keys.mjs verify",
    "  node scripts/deploy-keys.mjs sync-remote [--prune]",
    "  node scripts/deploy-keys.mjs rotate <KEY|LANG>",
  ].join("\n");
}

async function main() {
  const [command, ...argumentsList] = process.argv.slice(2);
  const prune = argumentsList.includes("--prune");
  const positional = argumentsList.filter((argument) => argument !== "--prune");

  if (command === "check") check();
  else if (command === "verify") await verifyRemote();
  else if (command === "sync-remote") await syncRemote(prune);
  else if (command === "rotate") await rotateSecret(positional[0], positional.slice(1));
  else throw new Error(usage());
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export {
  canUseDirectDotenv,
  compareNameSets,
  parseEnv,
  parseJsonc,
  serializeEnv,
  validateSources,
};