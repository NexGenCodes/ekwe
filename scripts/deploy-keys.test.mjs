import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWitPools,
  canUseDirectDotenv,
  compareNameSets,
  extractWitLanguages,
  parseEnv,
  parseJsonc,
  parseLocalStoreList,
  poolDigest,
  serializeEnv,
} from "./deploy-keys.mjs";

test("parseJsonc preserves URLs and removes comments", () => {
  const value = parseJsonc(`{
    "url": "https://example.com/path",
    // ignored
    "count": 2
  }`);

  assert.deepEqual(value, { url: "https://example.com/path", count: 2 });
});

test("parseEnv reads quoted values and rejects duplicates", () => {
  const parsed = parseEnv('A="one two"\nB=\'three\'\nC=value # comment\n');

  assert.deepEqual(parsed.entries, [
    ["A", "one two"],
    ["B", "three"],
    ["C", "value"],
  ]);
  assert.throws(() => parseEnv("A=1\nA=2\n"), /Duplicate dotenv key: A/);
});

test("serializeEnv emits quoted dotenv values", () => {
  assert.equal(serializeEnv([["A", "one two"], ["B", "x=y"]]), 'A="one two"\nB="x=y"\n');
});

test("buildWitPools follows binding order and pool size", () => {
  const entries = Array.from({ length: 18 }, (_, index) => [
    `WIT_KEY_${String.fromCharCode(65 + index)}`,
    `value-${index}`,
  ]);
  const bindings = [
    { binding: "WIT_POOL_01", secretName: "WIT_POOL_01" },
    { binding: "WIT_POOL_02", secretName: "WIT_POOL_02" },
  ];

  const pools = buildWitPools(entries, bindings);

  assert.equal(pools.length, 2);
  assert.equal(pools[0].languageCount, 17);
  assert.equal(pools[1].languageCount, 1);
  assert.equal(pools[0].name, "WIT_POOL_01");
  assert.equal(Object.keys(JSON.parse(pools[1].value)).length, 1);
});

test("canUseDirectDotenv rejects values that dotenv would reinterpret", () => {
  assert.equal(canUseDirectDotenv([["A", "plain-value_123"]]), true);
  assert.equal(canUseDirectDotenv([["A", "value#comment"]]), false);
  assert.equal(canUseDirectDotenv([["A", "value\\path"]]), false);
  assert.equal(canUseDirectDotenv([["A", 'value"quote']]), false);
  assert.equal(canUseDirectDotenv([["A", "line\nbreak"]]), false);
});

test("poolDigest is deterministic and value-sensitive", () => {
  const first = poolDigest("WIT_POOL_01", [["EN", "one"], ["FR", "two"]]);
  const second = poolDigest("WIT_POOL_01", [["FR", "two"], ["EN", "one"]]);
  const changed = poolDigest("WIT_POOL_01", [["EN", "one"], ["FR", "three"]]);

  assert.equal(first, second);
  assert.notEqual(first, changed);
});

test("compareNameSets returns exact differences", () => {
  assert.deepEqual(compareNameSets(["A", "B"], ["B", "C"]), {
    missing: ["A"],
    unexpected: ["C"],
  });
});

test("parseLocalStoreList handles the current Wrangler table", () => {
  const output = `┌───────────┬──────────────────────────────────┬─────────┬────────┬─────────┬──────────────────────┬──────────────────────┐
│ Name      │ ID                               │ Comment │ Scopes │ Status  │ Created              │ Modified             │
├───────────┼──────────────────────────────────┼─────────┼────────┼─────────┼──────────────────────┼──────────────────────┤
│ WIT_POOL_01 │ af8af8d6317c43cd98c5d8d44111e9ce │         │        │ active  │ 25/09/2026, 14:09:18 │ 25/09/2026, 14:09:18 │
└───────────┴──────────────────────────────────┴─────────┴────────┴─────────┴──────────────────────┴──────────────────────┘`;

  const records = parseLocalStoreList(output, "05717d9fd0de4d18848cdf7ed521026e");

  assert.deepEqual(records.get("WIT_POOL_01"), {
    name: "WIT_POOL_01",
    id: "af8af8d6317c43cd98c5d8d44111e9ce",
    storeId: "05717d9fd0de4d18848cdf7ed521026e",
    comment: "",
    scopes: [],
    status: "active",
  });
});

test("extractWitLanguages reads the provider inventory", () => {
  const languages = extractWitLanguages();

  assert.equal(languages.length, 132);
  assert.ok(languages.includes("CI"));
  assert.ok(languages.includes("CK"));
  assert.ok(languages.includes("EN"));
});
