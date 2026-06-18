import { useRouter } from "expo-router";
import { useCallback } from "react";

import { signOut } from "@/services/auth";
import { AppAlert } from "@/utils/alert";
import logger from "@/utils/logger";

interface UseLogoutReturn {
  /** Signs out immediately (no confirmation). */
  logout: () => Promise<void>;
  /** Shows a destructive confirmation dialog before signing out. */
  confirmLogout: () => void;
}

export const useLogout = (): UseLogoutReturn => {
  const router = useRouter();

  const logout = useCallback(async (): Promise<void> => {
    const result = await signOut();
    if (!result.ok) {
      logger.warn("[Auth] signOut error:", result.error);
    }
    router.replace("/(auth)/login");
  }, [router]);

  const confirmLogout = useCallback((): void => {
    AppAlert.confirm(
      "Log Out",
      "Are you sure you want to log out of Ekwe?",
      logout,
      {
        confirmText: "Log Out",
        isDestructive: true,
      },
    );
  }, [logout]);

  return { logout, confirmLogout };
};
