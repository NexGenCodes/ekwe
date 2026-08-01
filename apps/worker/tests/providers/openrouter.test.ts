import { describe, test, expect } from "vitest";
import * as openrouter from "../../src/providers/openrouter";
import { mockEnv, jsonResponse, mockSignal } from "../setup";
import { http } from "msw";
import { server } from "../msw/server";
import { PROVIDER_URLS } from "../msw/handlers";

describe("OpenRouter provider", () => {
  test("returns translation on success", async () => {
    server.use(
      http.post(PROVIDER_URLS.openrouterChat, () =>
        jsonResponse({ choices: [{ message: { content: "Hola mundo" } }] }),
      ),
    );

    const result = await openrouter.translate(
      "Hello world",
      "Spanish",
      "English",
      mockEnv(),
      mockSignal(),
    );
    expect(result).not.toBeNull();
    expect(result!.translation).toBe("Hola mundo");
    expect(result!.provider).toBe("openrouter");
  });

  test("returns null when key is missing", async () => {
    const env = mockEnv({ OPENROUTER_KEY: "" });
    const result = await openrouter.translate(
      "Hello",
      "Spanish",
      "English",
      env,
      mockSignal(),
    );
    expect(result).toBeNull();
  });

  test("returns null on HTTP error", async () => {
    server.use(
      http.post(PROVIDER_URLS.openrouterChat, () =>
        jsonResponse({ error: "unauthorized" }, 401),
      ),
    );
    const result = await openrouter.translate(
      "Hello",
      "Spanish",
      "English",
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });

  test("returns null on empty choices", async () => {
    server.use(
      http.post(PROVIDER_URLS.openrouterChat, () =>
        jsonResponse({ choices: [] }),
      ),
    );
    const result = await openrouter.translate(
      "Hello",
      "Spanish",
      "English",
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });
});
