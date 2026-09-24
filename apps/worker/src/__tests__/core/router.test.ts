import { describe, expect, test } from "vitest";
import { matchPath, matchRoute, RouteLike } from "@/core/router";

describe("matchPath", () => {
  test("matches an exact path with no params", () => {
    expect(matchPath("/health", "/health")).toEqual({});
    expect(matchPath("/transcribe/stream", "/transcribe/stream")).toEqual({});
  });

  test("returns null on segment count mismatch", () => {
    expect(matchPath("/health", "/health/extra")).toBeNull();
    expect(matchPath("/health/extra", "/health")).toBeNull();
  });

  test("returns null on literal segment mismatch", () => {
    expect(matchPath("/health", "/admin")).toBeNull();
    expect(matchPath("/users/x", "/users/y")).toBeNull();
  });

  test("captures :param segments", () => {
    expect(matchPath("/users/:id", "/users/42")).toEqual({ id: "42" });
    expect(matchPath("/users/:id/history", "/users/42/history")).toEqual({
      id: "42",
    });
    expect(matchPath("/:a/:b", "/x/y")).toEqual({ a: "x", b: "y" });
  });

  test("URL-decodes param values", () => {
    expect(matchPath("/users/:id", "/users/a%20b")).toEqual({ id: "a b" });
  });

  test("returns null for malformed percent-encoding in a param", () => {
    expect(matchPath("/users/:id", "/users/%zz")).toBeNull();
  });

  test("requires a valid param identifier", () => {
    expect(matchPath("/:1x", "/value")).toBeNull();
  });

  test("matches the root path", () => {
    expect(matchPath("/", "/")).toEqual({});
    expect(matchPath("/", "")).toBeNull();
    expect(matchPath("/", "/x")).toBeNull();
  });

  test("is path-segment aware (no partial matching)", () => {
    expect(matchPath("/health", "/healthz")).toBeNull();
    expect(matchPath("/transcribe", "/transcribe/stream")).toBeNull();
  });

  test("collapses empty pattern segments (// is treated as a separator)", () => {
    expect(matchPath("/a//b", "/a/b")).toEqual({});
  });
});

describe("matchRoute", () => {
  interface TestRoute extends RouteLike {
    tag: string;
  }

  const routes: TestRoute[] = [
    { method: "GET", path: "/health", tag: "health" },
    { method: "POST", path: "/transcribe", tag: "transcribe" },
    { method: "GET", path: "/users/:id", tag: "user" },
  ];

  test("matches by method and path", () => {
    const hit = matchRoute(routes, "GET", "/health");
    expect(hit?.route.tag).toBe("health");
    expect(hit?.params).toEqual({});
  });

  test("is method-sensitive", () => {
    expect(matchRoute(routes, "POST", "/health")).toBeNull();
    expect(matchRoute(routes, "GET", "/transcribe")).toBeNull();
  });

  test("normalizes the incoming method case", () => {
    expect(matchRoute(routes, "get", "/health")?.route.tag).toBe("health");
  });

  test("returns null when no route matches", () => {
    expect(matchRoute(routes, "GET", "/nope")).toBeNull();
  });

  test("returns captured params", () => {
    const hit = matchRoute(routes, "GET", "/users/7");
    expect(hit?.route.tag).toBe("user");
    expect(hit?.params).toEqual({ id: "7" });
  });

  test("is first-match-wins in declaration order", () => {
    const overlapping: TestRoute[] = [
      { method: "GET", path: "/users/me", tag: "me" },
      { method: "GET", path: "/users/:id", tag: "any" },
    ];
    expect(matchRoute(overlapping, "GET", "/users/me")?.route.tag).toBe("me");
    expect(matchRoute(overlapping, "GET", "/users/42")?.route.tag).toBe("any");
  });

  test("does not crash on an empty route table", () => {
    expect(matchRoute([], "GET", "/anything")).toBeNull();
  });
});
