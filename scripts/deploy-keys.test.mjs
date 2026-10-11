import assert from "node:assert/strict";
import test from "node:test";

import {
  canUseDirectDotenv,
  compareNameSets,
  parseEnv,
  parseJsonc,
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

test("canUseDirectDotenv rejects values that dotenv would reinterpret", () => {
  assert.equal(canUseDirectDotenv([["A", "plain-value_123"]]), true);
  assert.equal(canUseDirectDotenv([["A", "value#comment"]]), false);
  assert.equal(canUseDirectDotenv([["A", "value\\path"]]), false);
  assert.equal(canUseDirectDotenv([["A", 'value"quote']]), false);
  assert.equal(canUseDirectDotenv([["A", "line\nbreak"]]), false);
});

test("compareNameSets returns exact differences", () => {
  assert.deepEqual(compareNameSets(["A", "B"], ["B", "C"]), {
    missing: ["A"],
    unexpected: ["C"],
  });
});