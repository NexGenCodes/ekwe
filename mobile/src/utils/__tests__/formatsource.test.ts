import { formatSourceApp } from "../formatsource";

describe("formatSourceApp", () => {
  it('returns "Audio" for null', () => {
    expect(formatSourceApp(null)).toBe("Audio");
  });

  it('returns "Audio" for undefined', () => {
    expect(formatSourceApp(undefined)).toBe("Audio");
  });

  it('returns "Audio" for empty string', () => {
    expect(formatSourceApp("")).toBe("Audio");
  });

  it("maps known WhatsApp bundle ID", () => {
    expect(formatSourceApp("com.whatsapp")).toBe("WhatsApp");
  });

  it("maps known Telegram bundle ID", () => {
    expect(formatSourceApp("org.telegram.messenger")).toBe("Telegram");
  });

  it("maps known Instagram bundle ID", () => {
    expect(formatSourceApp("com.instagram.android")).toBe("Instagram");
  });

  it("maps Voice Memos bundle ID", () => {
    expect(formatSourceApp("com.apple.VoiceMemos")).toBe("Voice Memos");
  });

  it("formats unknown bundle IDs by stripping TLD", () => {
    expect(formatSourceApp("com.example.myapp")).toBe("Myapp");
  });

  it("handles single-part bundle IDs", () => {
    expect(formatSourceApp("MyApp")).toBe("Myapp");
  });

  it("capitalizes first letter of extracted name", () => {
    expect(formatSourceApp("com.example.my_great_app")).toBe("My_great_app");
  });
});
