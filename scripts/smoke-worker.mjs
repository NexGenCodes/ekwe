#!/usr/bin/env node
/**
 * Smoke-tests every Worker endpoint against a deployed URL.
 *
 * Without credentials this asserts routing, the auth boundary, and validation.
 * Set WORKER_SMOKE_JWT for the authenticated routes and
 * WORKER_SMOKE_ADMIN_SECRET for the admin routes.
 *
 *   node scripts/smoke-worker.mjs
 *   WORKER_URL=http://localhost:8787 node scripts/smoke-worker.mjs
 */

const BASE = (process.env.WORKER_URL || "https://ekwe-proxy.ekwe.workers.dev").replace(
  /\/$/,
  "",
);
const JWT = process.env.WORKER_SMOKE_JWT || "";
const ADMIN_SECRET = process.env.WORKER_SMOKE_ADMIN_SECRET || "";

const results = [];
let failures = 0;

/** `expected` accepts a single status or a list of acceptable statuses. */
async function probe(name, path, { method = "GET", body, headers = {}, expected }) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  const label = `${method.padEnd(4)} ${path}`;
  let status = 0;
  let detail = "";
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(JWT ? { Authorization: `Bearer ${JWT}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    status = res.status;
    const text = await res.text();
    detail = text.length > 120 ? `${text.slice(0, 120)}...` : text;
  } catch (err) {
    detail = `network error: ${err instanceof Error ? err.message : String(err)}`;
  }

  const ok = allowed.includes(status);
  if (!ok) failures += 1;
  results.push({ ok, label, got: status, want: allowed.join("/"), detail });
}

function skip(name, reason) {
  results.push({ ok: true, label: name, got: "-", want: "-", detail: reason, skipped: true });
}

async function main() {
  await probe("health", "/health", { expected: 200 });
  await probe("pricing", "/pricing", { expected: 200 });
  await probe("billing flags", "/billing/flags", { expected: 200 });
  await probe("update manifest", "/update/manifest", { expected: [200, 404] });
  await probe("unknown route 404s", "/definitely-not-a-route", { expected: 404 });

  await probe("webhook rejects unsigned", "/webhook", {
    method: "POST",
    body: { event: "charge.completed", data: { id: "smoke", amount: "1" } },
    expected: [400, 401, 403],
  });

  await probe("otp rejects a bogus email", "/auth/otp", {
    method: "POST",
    body: { email: "not-an-email" },
    expected: [400, 422],
  });

  if (!JWT) {
    for (const p of [
      "/usage",
      "/billing/checkout",
      "/billing/verify-transaction",
    ]) {
      await probe(`anonymous ${p}`, p, {
        method: p === "/usage" ? "GET" : "POST",
        body: p === "/usage" ? undefined : {},
        expected: 401,
      });
    }
    for (const [p, b] of [
      ["/synthesize", { text: "hello", voice_id: "en-US-Aria" }],
      ["/transcribe", { language: "en" }],
      ["/translate", { text: "hello", target_lang: "es" }],
    ]) {
      await probe(`anonymous ${p}`, p, { method: "POST", body: b, expected: 401 });
    }
    await probe("anonymous /speech/:key", "/speech/not-a-real-key", {
      expected: [400, 401, 404],
    });
    await probe("anonymous /transcribe/stream", "/transcribe/stream", {
      expected: 401,
    });
    await probe("anonymous /devices/token", "/devices/token", {
      method: "POST",
      body: {
        push_token: `ExponentPushToken[smoke${"0".repeat(20)}]`,
        platform: "android",
      },
      expected: [200, 201],
    });
  } else {
    await probe("authed /usage", "/usage", { expected: 200 });
    await probe("authed /usage rejects junk body", "/synthesize", {
      method: "POST",
      body: { not_a_field: true },
      expected: [400, 422],
    });
    await probe("authed /billing/checkout validates body", "/billing/checkout", {
      method: "POST",
      body: {},
      expected: [400, 422],
    });
  }

  await probe("anonymous /admin/update/notify", "/admin/update/notify", {
    method: "POST",
    body: { version: "1.2.12", downloadUrl: "https://example.com/app.apk" },
    expected: 401,
  });
  await probe("anonymous /admin/update/manifest", "/admin/update/manifest", {
    method: "POST",
    body: {
      latest_version: "1.2.12",
      latest_version_code: 10212,
      min_supported_version_code: 1,
      download_url: "https://example.com/app.apk",
    },
    expected: 401,
  });

  if (!ADMIN_SECRET) {
    skip("admin notify (live)", "set WORKER_SMOKE_ADMIN_SECRET");
    skip("admin manifest (live)", "set WORKER_SMOKE_ADMIN_SECRET");
  } else {
    const adminHeaders = { Authorization: `Bearer ${ADMIN_SECRET}` };
    await probe("admin notify", "/admin/update/notify", {
      method: "POST",
      headers: adminHeaders,
      body: {
        version: "1.2.12",
        downloadUrl: "https://example.com/app.apk",
        versionCode: 10212,
      },
      expected: [200, 202],
    });
    await probe("admin manifest", "/admin/update/manifest", {
      method: "POST",
      headers: adminHeaders,
      body: {
        latest_version: "1.2.12",
        latest_version_code: 10212,
        min_supported_version_code: 1,
        download_url: "https://example.com/app.apk",
      },
      expected: [200, 202],
    });
  }
  const width = Math.max(...results.map((r) => r.label.length));
  for (const r of results) {
    const mark = r.skipped ? "SKIP" : r.ok ? "PASS" : "FAIL";
    const line = `${mark}  ${r.label.padEnd(width)}  ${r.ok ? r.got : `${r.got} (want ${r.want})`}`;
    console.log(line);
    if (!r.skipped) console.log(`      ${r.detail}`);
  }
  const passed = results.filter((r) => r.ok && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  console.log(
    `\n${passed} passed, ${failures} failed, ${skipped} skipped against ${BASE}`,
  );
  if (!JWT || !ADMIN_SECRET) {
    console.log(
      "Unset WORKER_SMOKE_JWT / WORKER_SMOKE_ADMIN_SECRET mean the authenticated\n" +
        "and admin bodies above were NOT exercised, only their auth boundary.",
    );
  }
  process.exit(failures > 0 ? 1 : 0);
}

main();