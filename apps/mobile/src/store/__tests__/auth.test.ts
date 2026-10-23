import { auth$, authActions, getToken } from "@/store/auth";
import type { AuthSession } from "@/store/auth";

function makeSession(
  userId: string,
  tier: "FREE" | "PREMIUM" = "FREE",
): AuthSession {
  return {
    user: {
      id: userId,
      email: "person@ekwe.app",
      tier,
      displayName: null,
      avatarUrl: null,
      avatarIcon: null,
      proExpiresAt: null,
    },
    accessToken: "access-token",
    expiresAt: Date.now() + 60_000,
    refreshToken: "refresh-token",
    refreshExpiresAt: Date.now() + 86_400_000,
  };
}

describe("auth store", () => {
  beforeEach(() => {
    authActions.setSession(null);
  });

  it("derives isPro from the session tier", () => {
    authActions.setSession(makeSession("u1", "PREMIUM"));
    expect(auth$.isPro.peek()).toBe(true);
    expect(auth$.user.peek()?.tier).toBe("PREMIUM");
  });

  it("keeps isPro false for a free session", () => {
    authActions.setSession(makeSession("u1", "FREE"));
    expect(auth$.isPro.peek()).toBe(false);
  });

  it("updates the user and tier in place", () => {
    authActions.setSession(makeSession("u1", "FREE"));

    authActions.setUser({
      ...makeSession("u1").user,
      tier: "PREMIUM",
    });

    expect(auth$.isPro.peek()).toBe(true);
    expect(auth$.session.peek()?.user.tier).toBe("PREMIUM");
    expect(auth$.session.peek()?.accessToken).toBe("access-token");
  });

  it("ignores a user update for a different account", () => {
    authActions.setSession(makeSession("u1", "FREE"));

    authActions.setUser({ ...makeSession("u2", "PREMIUM").user });

    expect(auth$.session.peek()?.user.id).toBe("u1");
    expect(auth$.session.peek()?.user.tier).toBe("FREE");
    expect(auth$.isPro.peek()).toBe(false);
  });

  it("clears the session and paid status on sign-out", () => {
    authActions.setSession(makeSession("u1", "PREMIUM"));

    authActions.setSession(null);

    expect(auth$.session.peek()).toBeNull();
    expect(auth$.user.peek()).toBeNull();
    expect(auth$.isPro.peek()).toBe(false);
    expect(getToken()).toBeNull();
  });

  it("exposes the access token while signed in", () => {
    authActions.setSession(makeSession("u1"));
    expect(getToken()).toBe("access-token");
  });
});
