#!/usr/bin/env node

/**
 * End-to-end endpoint check for an ekwe worker.
 *
 *   node scripts/smoke-api.mjs                          # public endpoints only
 *   node scripts/smoke-api.mjs --email you@example.com   # + the signed-in suite
 *   node scripts/smoke-api.mjs --email you@example.com --code 123456
 *   node scripts/smoke-api.mjs --url http://127.0.0.1:8787
 *
 * With `--email` the script sends a real one-time code and, unless `--code`
 * is given, prompts for it. It signs in, exercises sync (create / stale
 * write / delete / tombstone / restore), device tokens, usage, billing and
 * the speech pipeline, then restores the profile and removes its test rows.
 *
 * Flags: --no-providers (skip translate/synthesize/transcribe, saves credits)
 *        --no-billing   (skip checkout, creates a live Flutterwave session)
 *        --keep         (leave the test history row and device token behind)
 *        --verbose      (print response bodies when a check fails)
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const DEFAULT_URL = "https://ekwe-proxy.workers.dev";
const COOLDOWN_MS = 3_200;

const parseArgs = (argv) => {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (key === "keep" || key === "verbose") {
      out[key] = true;
    } else if (key === "no-providers" || key === "no-billing") {
      out[key] = true;
    } else {
      out[key] = argv[++i];
    }
  }
  return out;
};

const args = parseArgs(process.argv.slice(2));
const baseUrl = (args.url ?? process.env.WORKER_URL ?? DEFAULT_URL).replace(
  /\/$/,
  "",
);

const useColor = stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
const green = (t) => paint(32, t);
const red = (t) => paint(31, t);
const yellow = (t) => paint(33, t);
const dim = (t) => paint(2, t);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = { passed: 0, failed: 0, skipped: 0 };

const check = async (name, fn) => {
  try {
    const detail = await fn();
    results.passed++;
    console.log(
      `  ${green("PASS")}  ${name}${detail ? `  ${dim(detail)}` : ""}`,
    );
    return true;
  } catch (err) {
    results.failed++;
    console.log(`  ${red("FAIL")}  ${name}  ${red(err.message)}`);
    return false;
  }
};

const skip = (name, reason) => {
  results.skipped++;
  console.log(`  ${yellow("SKIP")}  ${name}  ${dim(reason)}`);
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const request = async (path, options = {}) => {
  const headers = { ...(options.headers ?? {}) };
  let body = options.body;

  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  }
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body,
    signal: AbortSignal.timeout(options.timeoutMs ?? 45_000),
  });

  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }

  if (response.status === 429 && !options.retried) {
    const wait = Number(response.headers.get("Retry-After") ?? 2) * 1000 + 200;
    await sleep(Math.min(wait, 5_000));
    return request(path, { ...options, retried: true });
  }

  return {
    status: response.status,
    headers: response.headers,
    text,
    json,
    bytes,
  };
};

const expectStatus = (response, expected, label) => {
  if (response.status !== expected) {
    const body = args.verbose ? response.text.slice(0, 300) : "";
    throw new Error(
      `${label}: expected ${expected}, got ${response.status} ${body}`,
    );
  }
};

const section = (title) => console.log(`\n${title}`);

const newRow = (id) => ({
  id,
  type: "translation",
  captureId: `cap-${id}`,
  origin: "echo",
  input: "audio",
  sourceLang: "en",
  targetLang: "fr",
  transcript: "smoke test",
  translationText: "test de fumee",
  duration: 1.5,
  sourceApp: "com.ekwe.smoke",
  sttProvider: "deepgram",
  mtProvider: "gemini",
  createdAt: Date.now(),
  revision: 0,
  restore: false,
});

const promptForCode = async () => {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(
      "  Enter the 6-digit code from the email: ",
    );
    return answer.trim();
  } finally {
    rl.close();
  }
};

const askCode = async () => {
  if (args.code) return args.code;
  console.log(dim(`\n  A one-time code was sent to ${args.email}.`));
  return promptForCode();
};

const main = async () => {
  console.log(`\nEkwe API smoke test ${dim("→")} ${baseUrl}\n`);

  let token;
  let refreshToken;
  let rowId;
  let rowRevision;
  let profileBackup;
  let audio;

  /* ── public ─────────────────────────────────────────────────────── */

  section("Public");

  await check("GET /config", async () => {
    const res = await request("/config");
    expectStatus(res, 200, "config");
    assert(res.json?.syncPullRows > 0, "syncPullRows is missing");
    assert(res.json?.syncPushRows > 0, "syncPushRows is missing");
    assert(
      res.json?.maxHistoryBatchBytes > 0,
      "maxHistoryBatchBytes is missing",
    );
    return `pull=${res.json.syncPullRows} push=${res.json.syncPushRows} max=${res.json.maxHistoryBatchBytes}`;
  });

  await check("GET /.well-known/jwks.json", async () => {
    const res = await request("/.well-known/jwks.json");
    expectStatus(res, 200, "jwks");
    const key = res.json?.keys?.[0];
    assert(key?.kty === "OKP" && key?.crv === "Ed25519", "not an Ed25519 key");
    return `kid=${key.kid}`;
  });

  await check("GET /pricing", async () => {
    const res = await request("/pricing");
    expectStatus(res, 200, "pricing");
    assert(typeof res.json?.price === "number", "price is missing");
    assert(typeof res.json?.annualPrice === "number", "annualPrice is missing");
    return `${res.json.currency} ${res.json.price} / ${res.json.annualPrice}`;
  });

  await check("GET /billing/flags", async () => {
    const res = await request("/billing/flags");
    expectStatus(res, 200, "flags");
    assert(
      res.json?.flutterwave_enabled === true,
      "flutterwave is not enabled",
    );
    return `provider=${res.json.default_provider}`;
  });

  await check("auth guard rejects a missing token", async () => {
    const res = await request("/sync/pull", { method: "POST", json: {} });
    expectStatus(res, 401, "guard");
    return "401";
  });

  /* ── auth ───────────────────────────────────────────────────────── */

  if (!args.email) {
    section("Authenticated");
    skip("auth + sync + billing + speech", "pass --email to run these");
  } else {
    section("Authenticated");

    let sent = bool(args.code);
    if (!sent) {
      const ok = await check("POST /auth/otp", async () => {
        const res = await request("/auth/otp", {
          method: "POST",
          json: { email: args.email },
        });
        expectStatus(res, 200, "otp");
        assert(res.json?.ok === true, "ok is not true");
        return args.email;
      });
      if (!ok) return finish();
    }

    const code = await askCode();

    await check("POST /auth/verify rejects a wrong code", async () => {
      const wrong = code === "000000" ? "111111" : "000000";
      const res = await request("/auth/verify", {
        method: "POST",
        json: { email: args.email, code: wrong },
      });
      expectStatus(res, 400, "verify");
      return "400";
    });

    const verified = await check(
      "POST /auth/verify mints a session",
      async () => {
        const res = await request("/auth/verify", {
          method: "POST",
          json: { email: args.email, code },
        });
        expectStatus(res, 200, "verify");
        assert(res.json?.accessToken, "accessToken is missing");
        assert(res.json?.refreshToken, "refreshToken is missing");
        assert(res.json?.user?.id, "user.id is missing");
        token = res.json.accessToken;
        refreshToken = res.json.refreshToken;
        return `${res.json.user.email} ${res.json.user.tier}`;
      },
    );

    if (!verified) return finish();

    await check("GET /auth/session", async () => {
      const res = await request("/auth/session", { token });
      expectStatus(res, 200, "session");
      assert(res.json?.user?.email === args.email, "wrong user");
      return `tier=${res.json.user.tier}`;
    });

    await check("PATCH /auth/profile round-trips", async () => {
      const before = await request("/auth/session", { token });
      profileBackup = {
        displayName: before.json.user.displayName ?? null,
        avatarIcon: before.json.user.avatarIcon ?? null,
      };
      const res = await request("/auth/profile", {
        method: "PATCH",
        token,
        json: { displayName: "Smoke Tester", avatarIcon: "rocket" },
      });
      expectStatus(res, 200, "profile");
      assert(
        res.json?.user?.displayName === "Smoke Tester",
        "displayName not saved",
      );
      const after = await request("/auth/session", { token });
      assert(after.json?.user?.avatarIcon === "rocket", "avatarIcon not saved");
      return "displayName + avatarIcon";
    });

    /* ── sync ─────────────────────────────────────────────────────── */

    section("Sync");

    rowId = `smoke-${Date.now()}`;

    const created = await check("POST /sync/push creates a row", async () => {
      const res = await request("/sync/push", {
        method: "POST",
        token,
        json: { rows: [newRow(rowId)] },
      });
      expectStatus(res, 200, "push");
      const result = res.json?.results?.[0];
      assert(result?.status === "ok", `status=${result?.status}`);
      rowRevision = result.revision;
      return `revision=${rowRevision}`;
    });

    if (created) {
      await check("POST /sync/pull returns the row", async () => {
        const res = await request("/sync/pull", {
          method: "POST",
          token,
          json: {},
        });
        expectStatus(res, 200, "pull");
        const row = res.json?.rows?.find((r) => r.id === rowId);
        assert(row, "row missing from pull");
        assert(row.revision >= 1, "revision missing");
        assert(typeof row.updatedAt === "number", "updatedAt missing");
        return `${res.json.rows.length} row(s)`;
      });

      await check("POST /sync/push rejects a stale revision", async () => {
        const stale = { ...newRow(rowId), revision: 0, transcript: "stale" };
        const res = await request("/sync/push", {
          method: "POST",
          token,
          json: { rows: [stale] },
        });
        expectStatus(res, 200, "push");
        const result = res.json?.results?.[0];
        assert(result?.status === "conflict", `status=${result?.status}`);
        return "conflict";
      });

      await check("POST /sync/push deletes the row", async () => {
        const res = await request("/sync/push", {
          method: "POST",
          token,
          json: {
            rows: [
              {
                ...newRow(rowId),
                revision: rowRevision,
                deletedAt: Date.now(),
              },
            ],
          },
        });
        expectStatus(res, 200, "push");
        const result = res.json?.results?.[0];
        assert(result?.status === "ok", `status=${result?.status}`);
        rowRevision = result.revision;
        return `revision=${rowRevision}`;
      });

      await check("POST /sync/pull includes the tombstone", async () => {
        const res = await request("/sync/pull", {
          method: "POST",
          token,
          json: {},
        });
        expectStatus(res, 200, "pull");
        const row = res.json?.rows?.find((r) => r.id === rowId);
        assert(row?.deletedAt, "tombstone missing");
        return `deletedAt=${row.deletedAt}`;
      });

      await check("POST /sync/push restores the row", async () => {
        const res = await request("/sync/push", {
          method: "POST",
          token,
          json: {
            rows: [
              {
                ...newRow(rowId),
                revision: rowRevision,
                deletedAt: null,
                restore: true,
              },
            ],
          },
        });
        expectStatus(res, 200, "push");
        const result = res.json?.results?.[0];
        assert(result?.status === "ok", `status=${result?.status}`);
        rowRevision = result.revision;
        const pull = await request("/sync/pull", {
          method: "POST",
          token,
          json: {},
        });
        const row = pull.json?.rows?.find((r) => r.id === rowId);
        assert(row && row.deletedAt === null, "row is still deleted");
        return `revision=${rowRevision}`;
      });
    } else {
      skip("sync pull / stale / delete / restore", "create failed");
    }

    /* ── devices + usage ──────────────────────────────────────────── */

    section("Devices & usage");

    await check("POST /devices/token", async () => {
      const res = await request("/devices/token", {
        method: "POST",
        token,
        json: {
          push_token: `ExponentPushToken[smoke${Date.now()}abcdefgh]`,
          platform: "ios",
          app_version: "0.0.0-smoke",
        },
      });
      expectStatus(res, 200, "device token");
      return "registered";
    });

    await check("GET /usage", async () => {
      const res = await request("/usage", { token });
      expectStatus(res, 200, "usage");
      assert(Array.isArray(res.json?.meters), "meters missing");
      return `${res.json.meters.length} meters`;
    });

    /* ── billing ──────────────────────────────────────────────────── */

    section("Billing");

    if (args["no-billing"]) {
      skip("POST /billing/checkout", "--no-billing");
    } else {
      await check("POST /billing/checkout", async () => {
        const res = await request("/billing/checkout", {
          method: "POST",
          token,
          json: { plan: "ekwe_pro_monthly", currency: "USD" },
        });
        expectStatus(res, 200, "checkout");
        assert(res.json?.public_key, "public_key missing");
        assert(res.json?.tx_ref, "tx_ref missing");
        return `tx_ref=${res.json.tx_ref}`;
      });
    }

    /* ── speech ───────────────────────────────────────────────────── */

    section("Speech");

    if (args["no-providers"]) {
      skip("translate / synthesize / transcribe", "--no-providers");
    } else {
      const before = await request("/usage", { token });
      const usedBefore =
        before.json?.meters?.find((m) => m.id === "translate")?.used ?? 0;

      await check("POST /translate", async () => {
        const res = await request("/translate", {
          method: "POST",
          token,
          json: {
            // Unique per run: a cached translation is not billed, which would
            // make the meter assertion below meaningless.
            text: `Good morning, run ${Date.now()}`,
            sourceLang: "en",
            targetLang: "fr",
          },
        });
        expectStatus(res, 200, "translate");
        assert(res.json?.translation, "translation missing");
        return `${JSON.stringify(res.json.translation)} via ${res.json.provider}`;
      });

      await check("GET /usage counts the translation", async () => {
        const res = await request("/usage", { token });
        const used =
          res.json?.meters?.find((m) => m.id === "translate")?.used ?? 0;
        assert(used === usedBefore + 1, `used ${usedBefore} -> ${used}`);
        return `${usedBefore} -> ${used}`;
      });

      await sleep(COOLDOWN_MS);

      const synthOk = await check("POST /synthesize", async () => {
        const res = await request("/synthesize", {
          method: "POST",
          token,
          json: { text: "Hello there", targetLang: "en" },
        });
        expectStatus(res, 200, "synthesize");
        assert(res.json?.audioUrl, "audioUrl missing");
        audio = res.json;
        return `${res.json.mime} voice=${res.json.voiceId}`;
      });

      if (synthOk) {
        await check("GET the synthesized audio", async () => {
          const url = audio.audioUrl.startsWith("http")
            ? audio.audioUrl
            : `${baseUrl}${audio.audioUrl}`;
          const res = await request(url.replace(baseUrl, ""));
          assert(res.status === 200, `status ${res.status}`);
          assert(res.bytes.byteLength > 0, "empty body");
          return `${res.bytes.byteLength} bytes ${res.headers.get("content-type")}`;
        });

        await sleep(COOLDOWN_MS);

        await check("POST /transcribe (multipart)", async () => {
          const url = audio.audioUrl.startsWith("http")
            ? audio.audioUrl
            : `${baseUrl}${audio.audioUrl}`;
          const audioRes = await fetch(url, {
            signal: AbortSignal.timeout(30_000),
          });
          const bytes = await audioRes.arrayBuffer();
          const form = new FormData();
          form.append(
            "file",
            new Blob([bytes], { type: audio.mime }),
            "smoke.mp3",
          );
          form.append("lang", "en");
          form.append("duration", String(audio.durationMs ?? 1_500));
          const res = await request("/transcribe", {
            method: "POST",
            token,
            body: form,
            timeoutMs: 90_000,
          });
          expectStatus(res, 200, "transcribe");
          assert(res.json?.text, "transcript missing");
          return `${JSON.stringify(res.json.text)} via ${res.json.provider}`;
        });
      } else {
        skip("POST /transcribe", "synthesize failed");
      }
    }

    /* ── cleanup ──────────────────────────────────────────────────── */

    section("Cleanup");

    if (profileBackup) {
      await check("restore the profile", async () => {
        const res = await request("/auth/profile", {
          method: "PATCH",
          token,
          json: profileBackup,
        });
        expectStatus(res, 200, "profile restore");
        return "restored";
      });
    }

    if (!args.keep && rowId) {
      await check("remove the test history row", async () => {
        let revision = rowRevision;
        for (let attempt = 0; attempt < 3; attempt++) {
          const res = await request("/sync/push", {
            method: "POST",
            token,
            json: {
              rows: [
                {
                  ...newRow(rowId),
                  revision,
                  deletedAt: Date.now(),
                },
              ],
            },
          });
          expectStatus(res, 200, "delete");
          const result = res.json?.results?.[0];
          if (result?.status === "ok" || result?.status === "deleted") {
            return "tombstoned";
          }
          if (typeof result?.revision !== "number") {
            throw new Error(`status=${result?.status}`);
          }
          revision = result.revision;
        }
        throw new Error("could not tombstone the row");
      });
    }

    /* ── session lifecycle ────────────────────────────────────────── */

    section("Session lifecycle");

    let rotated;
    await check("POST /auth/refresh rotates the session", async () => {
      const res = await request("/auth/refresh", {
        method: "POST",
        json: { refreshToken },
      });
      expectStatus(res, 200, "refresh");
      assert(res.json?.refreshToken, "new refreshToken missing");
      rotated = res.json;
      return "rotated";
    });

    await check("POST /auth/logout", async () => {
      const res = await request("/auth/logout", {
        method: "POST",
        token: rotated?.accessToken ?? token,
      });
      expectStatus(res, 200, "logout");
      return "session revoked";
    });

    await check("POST /auth/refresh is refused after logout", async () => {
      const res = await request("/auth/refresh", {
        method: "POST",
        json: { refreshToken: rotated?.refreshToken ?? refreshToken },
      });
      expectStatus(res, 401, "refresh after logout");
      return "401";
    });
  }

  finish();
};

function bool(value) {
  return value !== undefined && value !== null && value !== "";
}

function finish() {
  const total = results.passed + results.failed + results.skipped;
  const line = [
    green(`${results.passed} passed`),
    results.failed ? red(`${results.failed} failed`) : "0 failed",
    results.skipped ? yellow(`${results.skipped} skipped`) : null,
  ]
    .filter(Boolean)
    .join(", ");
  console.log(`\n${line}  ${dim(`(${total} checks)`)}\n`);
  process.exit(results.failed ? 1 : 0);
}

main().catch((err) => {
  console.error(
    `\n${red("smoke test crashed")}: ${err.stack ?? err.message}\n`,
  );
  process.exit(1);
});
