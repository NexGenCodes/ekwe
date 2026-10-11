import { describe, expect, it } from "vitest";
import { error, HttpError } from "@/core/http";
import { jsonBody } from "@/__tests__/setup";

describe("error", () => {
  it("returns JSON body with error, message, correct status, and headers", async () => {
    const res = error("CODE", 400, "Message", {
      headers: { "X-Test": "123" },
      extra: { foo: "bar" },
    });

    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Test")).toBe("123");

    const body = await jsonBody(res);
    expect(body).toEqual({
      error: "CODE",
      message: "Message",
      foo: "bar",
    });
  });
});

describe("HttpError", () => {
  it("inherits from Error and exposes code, status, extra, and headers", () => {
    const err = new HttpError("CODE", 400, { foo: "bar" }, "Message", {
      headers: { "X-Test": "123" },
    });

    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("CODE");
    expect(err.status).toBe(400);
    expect(err.message).toBe("Message");
    expect(err.extra).toEqual({ foo: "bar" });
    expect(err.headers).toEqual({ "X-Test": "123" });
  });

  it("provides a default message", () => {
    const err = new HttpError("CODE", 500);
    expect(err.message).toBe("An unexpected error occurred.");
  });
});
