import { describe, test, expect } from "vitest";
import * as mistral from "@/providers/mistral";
import { mockEnv, jsonResponse, mockSignal } from "@/__tests__/setup";
import { http } from "msw";
import { server } from "@/__tests__/msw/server";
import { PROVIDER_URLS } from "@/__tests__/msw/handlers";

describe("Mistral provider", () => {
  test("returns translation on success", async () => {
    server.use(
      http.post(PROVIDER_URLS.mistralChat, () =>
        jsonResponse({ choices: [{ message: { content: "Ciao mondo" } }] }),
      ),
    );

    const result = await mistral.translate(
      "Hello world",
      "Italian",
      "English",
      mockEnv(),
      mockSignal(),
    );
    expect(result).not.toBeNull();
    expect(result!.translation).toBe("Ciao mondo");
    expect(result!.provider).toBe("mistral");
  });

  test("returns null on HTTP error", async () => {
    server.use(
      http.post(PROVIDER_URLS.mistralChat, () =>
        jsonResponse({ error: "rate limited" }, 429),
      ),
    );
    const result = await mistral.translate(
      "Hello",
      "Italian",
      "English",
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });

  test("returns null on empty choices", async () => {
    server.use(
      http.post(PROVIDER_URLS.mistralChat, () => jsonResponse({ choices: [] })),
    );
    const result = await mistral.translate(
      "Hello",
      "Italian",
      "English",
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });
});
