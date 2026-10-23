import { sanitizeErrorMessage } from "@/utils/errorSafe";

describe("sanitizeErrorMessage", () => {
  it("returns trimmed string for short safe message", () => {
    expect(sanitizeErrorMessage("  Hello world  ")).toBe("Hello world");
  });

  it("returns null for strings with URLs", () => {
    expect(sanitizeErrorMessage("Error: check https://example.com")).toBeNull();
    expect(sanitizeErrorMessage("http://localhost:3000 failed")).toBeNull();
  });

  it("returns null for strings with infrastructure hostnames", () => {
    expect(sanitizeErrorMessage("ekwe-api.workers.dev failed")).toBeNull();
    expect(sanitizeErrorMessage("preview.pages.dev is down")).toBeNull();
  });

  it("returns null for strings over 140 chars", () => {
    const longString = "a".repeat(141);
    expect(sanitizeErrorMessage(longString)).toBeNull();
  });

  it("extracts .message from Error objects", () => {
    const err = new Error("Something broke");
    expect(sanitizeErrorMessage(err)).toBe("Something broke");
  });

  it("sanitizes the message of an Error that names an internal host", () => {
    expect(
      sanitizeErrorMessage(new Error("ekwe-api.workers.dev failed")),
    ).toBeNull();
  });

  it("recursively extracts .message from plain objects", () => {
    const obj = { message: "Internal error" };
    expect(sanitizeErrorMessage(obj)).toBe("Internal error");

    const nested = { message: { message: "Deep error" } };
    expect(sanitizeErrorMessage(nested)).toBe("Deep error");
  });

  it("returns null for non-string/non-error input", () => {
    expect(sanitizeErrorMessage(null)).toBeNull();
    expect(sanitizeErrorMessage(undefined)).toBeNull();
    expect(sanitizeErrorMessage(123)).toBeNull();
    expect(sanitizeErrorMessage({})).toBeNull();
  });
});
