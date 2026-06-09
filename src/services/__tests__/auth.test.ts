import { GoogleSignin } from "@react-native-google-signin/google-signin";
import * as AppleAuthentication from "expo-apple-authentication";

import { queryClient } from "@/hooks/queries/queryClient";
import * as authModule from "@/services/auth";
import { supabase } from "@/services/supabase";
import logger from "@/utils/logger";

jest.mock("@/services/supabase", () => ({
  supabase: {
    auth: {
      onAuthStateChange: jest.fn(() => ({
        data: { subscription: { unsubscribe: jest.fn() } },
      })),
      getSession: jest.fn(),
      signUp: jest.fn(),
      signInWithOtp: jest.fn(),
      verifyOtp: jest.fn(),
      updateUser: jest.fn(),
      signInWithIdToken: jest.fn(),
      setSession: jest.fn(),
      signOut: jest.fn(),
      startAutoRefresh: jest.fn(),
      stopAutoRefresh: jest.fn(),
    },
    rpc: jest.fn(),
    from: jest.fn(() => ({
      insert: jest.fn().mockResolvedValue({ error: null }),
    })),
  },
}));

jest.mock("@/hooks/queries/queryClient", () => ({
  queryClient: {
    invalidateQueries: jest.fn(),
    clear: jest.fn(),
  },
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("@/utils/platform", () => ({
  isIOS: true,
  isAndroid: false,
}));

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  authModule.cleanupAuth();
});

describe("initAuth", () => {
  it("registers onAuthStateChange listener once", () => {
    authModule.initAuth();
    authModule.initAuth();

    expect(supabase.auth.onAuthStateChange).toHaveBeenCalledTimes(1);
  });

  it("configures GoogleSignIn", () => {
    authModule.initAuth();

    expect(GoogleSignin.configure).toHaveBeenCalledWith({
      webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
      iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    });
  });

  it("invalidates queries on SIGNED_OUT", () => {
    (supabase.auth.onAuthStateChange as jest.Mock).mockImplementationOnce(
      (cb: (event: string) => void) => {
        cb("SIGNED_OUT");
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      },
    );

    authModule.initAuth();

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["translate"],
    });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["transcribe"],
    });
  });

  it("handles GoogleSignIn configure error gracefully", () => {
    const consoleSpy = jest.spyOn(logger, "error").mockImplementation();
    (GoogleSignin.configure as jest.Mock).mockImplementationOnce(() => {
      throw new Error("config fail");
    });

    authModule.initAuth();

    expect(consoleSpy).toHaveBeenCalled();
  });
});

describe("cleanupAuth", () => {
  it("unsubscribes the auth listener", () => {
    const unsubscribe = jest.fn();
    (supabase.auth.onAuthStateChange as jest.Mock).mockReturnValue({
      data: { subscription: { unsubscribe } },
    });

    authModule.initAuth();
    authModule.cleanupAuth();

    expect(unsubscribe).toHaveBeenCalled();
  });

  it("allows re-initialization after cleanup", () => {
    authModule.initAuth();
    authModule.cleanupAuth();
    authModule.initAuth();

    expect(supabase.auth.onAuthStateChange).toHaveBeenCalledTimes(2);
  });
});


describe("sendOtp", () => {
  it("returns ok on success", async () => {
    (supabase.auth.signInWithOtp as jest.Mock).mockResolvedValueOnce({
      error: null,
    });

    const result = await authModule.sendOtp("test@ekwe.app");

    expect(result).toEqual({ ok: true });
  });

  it("trims email before sending", async () => {
    (supabase.auth.signInWithOtp as jest.Mock).mockResolvedValueOnce({
      error: null,
    });

    await authModule.sendOtp("  test@ekwe.app  ");

    expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "test@ekwe.app",
    });
  });
});

describe("verifyOtp", () => {
  it("returns ok on valid session", async () => {
    (supabase.auth.verifyOtp as jest.Mock).mockResolvedValueOnce({
      data: { session: { user: { id: "u1" } } },
      error: null,
    });

    const result = await authModule.verifyOtp("test@ekwe.app", "123456");

    expect(result).toEqual({ ok: true });
  });

  it("returns error when session is missing", async () => {
    (supabase.auth.verifyOtp as jest.Mock).mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });

    const result = await authModule.verifyOtp("test@ekwe.app", "123456");

    expect(result.ok).toBe(false);
  });
});


describe("signInWithApple", () => {
  it("returns ok on success", async () => {
    (AppleAuthentication.signInAsync as jest.Mock).mockResolvedValueOnce({
      identityToken: "apple-token",
      fullName: { givenName: "Jane", familyName: "Doe" },
    });
    (supabase.auth.signInWithIdToken as jest.Mock).mockResolvedValueOnce({
      error: null,
    });

    const result = await authModule.signInWithApple();

    expect(result).toEqual({ ok: true });
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({
      data: { full_name: "Jane Doe" },
    });
  });

  it("returns error when identity token missing", async () => {
    (AppleAuthentication.signInAsync as jest.Mock).mockResolvedValueOnce({
      identityToken: null,
      fullName: null,
    });

    const result = await authModule.signInWithApple();

    expect(result.ok).toBe(false);
  });

  it("handles cancellation gracefully", async () => {
    (AppleAuthentication.signInAsync as jest.Mock).mockRejectedValueOnce({
      code: "ERR_REQUEST_CANCELED",
    });

    const result = await authModule.signInWithApple();

    expect(result).toEqual({ ok: false });
  });
});

describe("signInWithGoogle", () => {
  it("returns ok on success", async () => {
    (GoogleSignin.signIn as jest.Mock).mockResolvedValueOnce({
      data: { idToken: "google-token" },
    });
    (supabase.auth.signInWithIdToken as jest.Mock).mockResolvedValueOnce({
      error: null,
    });

    const result = await authModule.signInWithGoogle();

    expect(result).toEqual({ ok: true });
  });

  it("handles cancellation", async () => {
    (GoogleSignin.signIn as jest.Mock).mockRejectedValueOnce({
      code: "12501",
    });

    const result = await authModule.signInWithGoogle();

    expect(result).toEqual({ ok: false });
  });
});

describe("setSessionFromDeepLink", () => {
  it("returns true when session set successfully", async () => {
    (supabase.auth.setSession as jest.Mock).mockResolvedValueOnce({
      error: null,
    });

    const result = await authModule.setSessionFromDeepLink(
      "ekwe://callback#access_token=at&refresh_token=rt",
    );

    expect(result).toBe(true);
  });

  it("returns false if tokens are missing", async () => {
    const result = await authModule.setSessionFromDeepLink(
      "ekwe://callback#no_tokens",
    );

    expect(result).toBe(false);
  });
});

describe("signOut", () => {
  it("signs out of supabase and google", async () => {
    (supabase.auth.signOut as jest.Mock).mockResolvedValueOnce({
      error: null,
    });

    const result = await authModule.signOut();

    expect(result).toEqual({ ok: true });
    expect(GoogleSignin.signOut).toHaveBeenCalled();
  });
});

describe("deleteAccount", () => {
  it("calls delete_user RPC and signs out", async () => {
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({ error: null });
    (supabase.auth.signOut as jest.Mock).mockResolvedValueOnce({
      error: null,
    });

    const result = await authModule.deleteAccount();

    expect(result).toEqual({ ok: true });
    expect(supabase.rpc).toHaveBeenCalledWith("delete_user");
    expect(queryClient.clear).toHaveBeenCalled();
  });

  it("returns support message if RPC fails", async () => {
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({
      error: { message: "permission denied" },
    });

    const result = await authModule.deleteAccount();

    expect(result.ok).toBe(false);
    expect(result.error).toContain("contact support");
  });
});
