import { describe, it, expect } from "vitest";

import {
  AVATAR_ICONS,
  getDeterministicAvatar,
  resolveUserAvatar,
} from "../avatar";

describe("avatar utilities", () => {
  it("returns default first icon when identifier is empty", () => {
    expect(getDeterministicAvatar(null)).toBe(AVATAR_ICONS[0]);
    expect(getDeterministicAvatar("")).toBe(AVATAR_ICONS[0]);
  });

  it("consistently returns the same icon for the same user ID", () => {
    const icon1 = getDeterministicAvatar("user_12345");
    const icon2 = getDeterministicAvatar("user_12345");
    expect(icon1).toBe(icon2);
    expect(AVATAR_ICONS).toContain(icon1);
  });

  it("maps different identifiers to different icons", () => {
    const iconA = getDeterministicAvatar("alice@example.com");
    const iconB = getDeterministicAvatar("bob@example.com");
    expect(AVATAR_ICONS).toContain(iconA);
    expect(AVATAR_ICONS).toContain(iconB);
  });

  it("resolves explicitly saved icon name case-insensitively", () => {
    const resolved = resolveUserAvatar("ghost", "any_id");
    expect(resolved.name).toBe("Ghost");
  });

  it("falls back to deterministic icon if avatarIconName is invalid or null", () => {
    const deterministic = getDeterministicAvatar("user_xyz");
    const resolved = resolveUserAvatar("nonexistent_icon", "user_xyz");
    expect(resolved).toEqual(deterministic);
  });
});
