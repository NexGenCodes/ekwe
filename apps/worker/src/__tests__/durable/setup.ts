import { beforeEach, beforeAll, afterEach, afterAll } from "vitest";
import { http } from "msw";
import { network } from "@/__tests__/msw/network";

beforeAll(() => {
  network.enable();
});

beforeEach(() => {
  network.use(
    http.post("https://supabase.test/rest/v1/rpc/check_preflight", () =>
      Response.json({
        allowed: true,
        tier_active: "PREMIUM",
        quota_total: 60,
        quota_remaining: 60,
      }),
    ),
  );
});

afterEach(() => {
  network.resetHandlers();
});

afterAll(() => {
  network.disable();
});
