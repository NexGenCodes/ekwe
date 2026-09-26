import { beforeEach, describe, expect, it, vi } from "vitest";

import { EKWE_SHARE_SIGNATURE } from "@/constants/share";
import { CopyService } from "@/services/copyOutService";

const setStringMock = vi.hoisted(() => vi.fn());
vi.mock("expo-clipboard", () => ({ setStringAsync: setStringMock }));

describe("CopyService.copyText", () => {
  beforeEach(() => {
    setStringMock.mockReset().mockResolvedValue(true);
  });

  it("signs the text, so pasted text matches what sharing sends", async () => {
    expect(await CopyService.copyText("hola")).toBe(true);
    expect(setStringMock).toHaveBeenCalledWith(`hola${EKWE_SHARE_SIGNATURE}`);
  });

  it("trims before signing", async () => {
    // The signature reads as a signature only if it is the last line, and a
    // trailing newline would push it onto its own dangling line.
    await CopyService.copyText("  hola  ");
    expect(setStringMock).toHaveBeenCalledWith(`hola${EKWE_SHARE_SIGNATURE}`);
  });

  it("copies verbatim when signing is turned off", async () => {
    // For text the user copies to *use* rather than to attribute.
    await CopyService.copyText("https://example.com", { sign: false });
    expect(setStringMock).toHaveBeenCalledWith("https://example.com");
  });

  it("does nothing for empty or whitespace-only text", async () => {
    // Writing an empty string to the clipboard would silently erase whatever
    // the user had copied before.
    expect(await CopyService.copyText("")).toBe(false);
    expect(await CopyService.copyText("   \n  ")).toBe(false);
    expect(setStringMock).not.toHaveBeenCalled();
  });

  it("reports failure instead of claiming a copy happened", async () => {
    // Callers show a "Copied" label off this return value.
    setStringMock.mockRejectedValue(new Error("denied"));
    expect(await CopyService.copyText("hola")).toBe(false);
  });
});
