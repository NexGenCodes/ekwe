import { formatSourceApp } from "@/utils/formatSource";

describe("formatSourceApp", () => {
  it("returns 'Audio' for null/undefined/empty/unknown sentinels", () => {
    expect(formatSourceApp(null)).toBe("Audio");
    expect(formatSourceApp(undefined)).toBe("Audio");
    expect(formatSourceApp("")).toBe("Audio");
    expect(formatSourceApp("unknown")).toBe("Audio");
    expect(formatSourceApp("ios")).toBe("Audio");
    expect(formatSourceApp("none")).toBe("Audio");
    expect(formatSourceApp("audio")).toBe("Audio");
  });

  it("returns exact string for known bundle IDs", () => {
    expect(formatSourceApp("com.whatsapp")).toBe("WhatsApp");
    expect(formatSourceApp("com.whatsapp.w4b")).toBe("WhatsApp Business");
    expect(formatSourceApp("org.telegram.messenger")).toBe("Telegram");
  });

  it("title-cases last meaningful segment of unknown dotted IDs", () => {
    expect(formatSourceApp("com.example.myapp")).toBe("Myapp");
    expect(formatSourceApp("org.company.CustomApp")).toBe("Customapp");
  });

  it("ignores generic namespace segments", () => {
    expect(formatSourceApp("com.android.myapp")).toBe("Myapp");
    expect(formatSourceApp("org.google.test")).toBe("Test");
  });

  it("passes through native-resolved display labels", () => {
    expect(formatSourceApp("WhatsApp Business")).toBe("WhatsApp Business");
    expect(formatSourceApp("My Custom App")).toBe("My Custom App");
    expect(formatSourceApp("TikTok")).toBe("TikTok");
  });

  it("handles single segment strings", () => {
    expect(formatSourceApp("customapp")).toBe("Customapp");
  });
});
