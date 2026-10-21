import { describe, expect, test } from "vitest";
import { generateSecMsGecV2 } from "@/providers/edgeDrm";

/**
 * Expected values were produced by the reference Python implementation
 * (`rany2/edge-tts` 7.3.1 `drm.py`) for the same Unix timestamps. The v2
 * digest is not standard SHA-256, so these vectors are the only way to catch
 * a silent drift in the port.
 */
const REFERENCE_VECTORS: ReadonlyArray<readonly [number, string]> = [
  [
    1600000000,
    "1F5E89103EC98A08-E69D008C1241797258F0EE06F56044C11FAEC4B60F95C6AB0DB3C5E79BE2F010",
  ],
  [
    1761080000,
    "59E503C3EE58BF03-67717A546827C3E9F596CB453942BA1E13B2F37E3B48581618315092DE57AF4D",
  ],
  [
    1792500000,
    "44C4B4E300C7E884-B5E5A04D3C0DBA732341B6E8A4FC00212E9AEF6EE0C1E01513CDF014043A51BC",
  ],
  [
    1792586400,
    "2385791D109CAD36-1CDB0D1B92EF0DEA517C65024DA2F718001735B801E1B912B1746B4387BE0C9D",
  ],
  [
    1800000000,
    "99E54519B490BE5C-E162DB0977FBDCB9B86DD8148BF1BCDC3C0303176CE39852A42B415935C20654",
  ],
];

describe("Edge Sec-MS-GEC v2 token", () => {
  test.each(REFERENCE_VECTORS)(
    "matches the reference token for %i",
    (timestamp, expected) => {
      expect(generateSecMsGecV2(timestamp)).toBe(expected);
    },
  );

  test("is <16 hex>-<64 hex>", () => {
    expect(generateSecMsGecV2(1792500000)).toMatch(
      /^[0-9A-F]{16}-[0-9A-F]{64}$/,
    );
  });

  test("buckets tokens into five-minute windows", () => {
    // 1792500000 is a window boundary; the whole window shares one token.
    expect(generateSecMsGecV2(1792500000)).toBe(generateSecMsGecV2(1792500299));
    expect(generateSecMsGecV2(1792500300)).not.toBe(
      generateSecMsGecV2(1792500000),
    );
  });

  test("produces a well-formed token when called without a timestamp", () => {
    expect(generateSecMsGecV2()).toMatch(/^[0-9A-F]{16}-[0-9A-F]{64}$/);
  });
});
