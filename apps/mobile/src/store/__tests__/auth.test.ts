import { auth$, authActions } from "@/store/auth";

function makeSession(userId: string, isPro?: boolean): Record<string, unknown> {
  return {
    access_token: "token",
    user: {
      id: userId,
      app_metadata: { is_pro: isPro },
    },
  };
}

describe("auth store", () => {
  beforeEach(() => {
    authActions.setSession(null);
    authActions.setIsPro(false);
    authActions.setEntitlementSynced(false);
  });

  describe("setSession", () => {
    it("sets isPro from metadata before the entitlement syncs", () => {
      authActions.setSession(makeSession("u1", true) as never);
      expect(auth$.isPro.peek()).toBe(true);
      expect(auth$.isProEntitlementSynced.peek()).toBe(false);
    });

    it("keeps isPro owned by the entitlement once it has synced", () => {
      authActions.setSession(makeSession("u1", false) as never);
      authActions.setIsPro(true);
      authActions.setEntitlementSynced(true);

      authActions.setSession(makeSession("u1", false) as never);
      expect(auth$.isPro.peek()).toBe(true);
    });

    it("does not re-upgrade a cancelled/expired user from stale metadata", () => {
      authActions.setSession(makeSession("u1", true) as never);
      authActions.setIsPro(true);
      authActions.setEntitlementSynced(true);

      authActions.setIsPro(false);

      authActions.setSession(makeSession("u1", true) as never);
      expect(auth$.isPro.peek()).toBe(false);
    });

    it("resets entitlement sync when the user changes", () => {
      authActions.setSession(makeSession("u1", true) as never);
      authActions.setEntitlementSynced(true);

      authActions.setSession(makeSession("u2", true) as never);
      expect(auth$.isProEntitlementSynced.peek()).toBe(false);
      expect(auth$.isPro.peek()).toBe(true);
    });

    it("clears pro on sign-out", () => {
      authActions.setSession(makeSession("u1", true) as never);
      authActions.setIsPro(true);

      authActions.setSession(null);
      expect(auth$.isPro.peek()).toBe(false);
      expect(auth$.isProEntitlementSynced.peek()).toBe(false);
    });
  });
});
