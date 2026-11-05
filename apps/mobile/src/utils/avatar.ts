import type React from "react";
import Smile from "lucide-react-native/icons/face-slightly-smiling";
import Ghost from "lucide-react-native/icons/ghost";
import Sparkles from "lucide-react-native/icons/sparkles";
import Heart from "lucide-react-native/icons/heart";
import Star from "lucide-react-native/icons/star";
import Zap from "lucide-react-native/icons/zap";
import Coffee from "lucide-react-native/icons/coffee";
import Music from "lucide-react-native/icons/music";
import Rocket from "lucide-react-native/icons/rocket";

export const AVATAR_COLORS = {
  smile: "#F5A524",
  ghost: "#006FEE",
  sparkles: "#17C964",
  heart: "#F31260",
  star: "#FBBF24",
  zap: "#3B82F6",
  coffee: "#A1A1AA",
  music: "#F87171",
  rocket: "#4ADE80",
} as const;

export interface AvatarIconItem {
  name: string;
  icon: React.ComponentType<{ color: string; size: number }>;
  color: string;
}

export const AVATAR_ICONS: readonly AvatarIconItem[] = [
  { name: "Smile", icon: Smile, color: AVATAR_COLORS.smile },
  { name: "Ghost", icon: Ghost, color: AVATAR_COLORS.ghost },
  { name: "Sparkles", icon: Sparkles, color: AVATAR_COLORS.sparkles },
  { name: "Heart", icon: Heart, color: AVATAR_COLORS.heart },
  { name: "Star", icon: Star, color: AVATAR_COLORS.star },
  { name: "Zap", icon: Zap, color: AVATAR_COLORS.zap },
  { name: "Coffee", icon: Coffee, color: AVATAR_COLORS.coffee },
  { name: "Music", icon: Music, color: AVATAR_COLORS.music },
  { name: "Rocket", icon: Rocket, color: AVATAR_COLORS.rocket },
];

/**
 * Deterministically maps any identifier (user ID, email, etc.) to one of the 9 curated avatars.
 * Guarantees every user always has a consistent, delightful mascot from the icons list.
 */
export function getDeterministicAvatar(
  identifier?: string | null,
): AvatarIconItem {
  if (!identifier || identifier.trim() === "") {
    return AVATAR_ICONS[0]!;
  }

  let hash = 0;
  for (let i = 0; i < identifier.length; i++) {
    hash = (hash << 5) - hash + identifier.charCodeAt(i);
    hash |= 0;
  }

  const index = Math.abs(hash) % AVATAR_ICONS.length;
  return AVATAR_ICONS[index] ?? AVATAR_ICONS[0]!;
}

/**
 * Resolves a user's avatar icon. If the user already has a saved avatarIcon name,
 * matches it against the list (case-insensitively). Otherwise, assigns a deterministic default.
 */
export function resolveUserAvatar(
  avatarIconName?: string | null,
  identifier?: string | null,
): AvatarIconItem {
  if (avatarIconName && avatarIconName.trim() !== "") {
    const trimmed = avatarIconName.trim().toLowerCase();
    const found = AVATAR_ICONS.find(
      (item) => item.name.toLowerCase() === trimmed,
    );
    if (found) {
      return found;
    }
  }

  return getDeterministicAvatar(identifier);
}
