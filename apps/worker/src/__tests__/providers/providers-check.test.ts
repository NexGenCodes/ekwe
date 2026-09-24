import { describe, it, expect } from "vitest";
import {
  loadEnv,
  testTranslateProviders,
  testTranscribeProviders,
} from "@/__tests__/helpers/check-providers.mjs";

const RUN_INTEGRATION = process.env.RUN_INTEGRATION_TESTS === "true";

function summarize(results: any[]) {
  const passed = results.filter((r: any) => r.ok).length;
  const failed = results.filter((r: any) => !r.ok);
  const lines = failed.map(
    (r: any) => `  FAIL  ${r.label}: ${r.error || r.status}`,
  );
  return { passed, failedCount: failed.length, total: results.length, lines };
}

describe.runIf(RUN_INTEGRATION)("Provider key validation", () => {
  const env = loadEnv();

  it("validates translate provider keys", async () => {
    const includeGroq = process.env.CHECK_GROQ === "true";
    const results = await testTranslateProviders(env, { groq: includeGroq });
    const s = summarize(results);
    console.log(
      `\nTranslate: ${s.passed}/${s.total} passed, ${s.failedCount} failed`,
    );
    for (const l of s.lines) console.log(l);
    expect(results.length).toBeGreaterThan(0);
    expect(s.passed).toBeGreaterThan(0);
  }, 30_000);

  it("validates transcribe provider keys", async () => {
    const results = await testTranscribeProviders(env);
    const s = summarize(results);
    console.log(
      `\nTranscribe: ${s.passed}/${s.total} passed, ${s.failedCount} failed`,
    );
    for (const l of s.lines) console.log(l);
    expect(results.length).toBeGreaterThan(0);
    expect(s.passed).toBeGreaterThan(0);
  }, 60_000);
});
