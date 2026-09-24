import { createDeferredCacheCleaner } from "@/hooks/echo/deferredCacheCleaner";

describe("createDeferredCacheCleaner (deferred file teardown)", () => {
  it("does not delete anything until cleanup() is called", () => {
    const deleted: string[] = [];
    const cleaner = createDeferredCacheCleaner((uri) => deleted.push(uri));
    cleaner.remember("old-active.ogg", "old-converted.ogg");
    expect(deleted).toEqual([]);
  });

  it("deletes both remembered files on cleanup(), then forgets them", () => {
    const deleted: string[] = [];
    const cleaner = createDeferredCacheCleaner((uri) => deleted.push(uri));
    cleaner.remember("old-active.ogg", "old-converted.ogg");
    cleaner.cleanup();
    expect(deleted).toEqual(["old-active.ogg", "old-converted.ogg"]);
  });

  it("is idempotent — a second cleanup deletes nothing", () => {
    const deleted: string[] = [];
    const cleaner = createDeferredCacheCleaner((uri) => deleted.push(uri));
    cleaner.remember("a", "b");
    cleaner.cleanup();
    cleaner.cleanup();
    expect(deleted).toEqual(["a", "b"]);
  });

  it("skips empty/inactive options", () => {
    const deleted: string[] = [];
    const cleaner = createDeferredCacheCleaner((uri) => deleted.push(uri));
    cleaner.remember(undefined, undefined);
    cleaner.cleanup();
    expect(deleted).toEqual([]);
  });

  it("only keeps the most recent previous files when remembered twice", () => {
    const deleted: string[] = [];
    const cleaner = createDeferredCacheCleaner((uri) => deleted.push(uri));
    cleaner.remember("old-active.ogg", "old-converted.ogg");

    cleaner.remember("newer-active.ogg", "newer-converted.ogg");
    cleaner.cleanup();
    expect(deleted).toEqual(["newer-active.ogg", "newer-converted.ogg"]);
  });

  it("tolerates a resolve that never cleaned up (stale/aborted)", () => {
    const deleted: string[] = [];
    const cleaner = createDeferredCacheCleaner((uri) => deleted.push(uri));
    cleaner.remember("a", "b");

    cleaner.remember("c", "d");
    cleaner.cleanup();
    expect(deleted).toEqual(["c", "d"]);
  });
});
