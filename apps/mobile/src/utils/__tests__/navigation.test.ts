import { pushOnce, resetNavigationGuard } from "../navigation";

describe("pushOnce", () => {
  const makeRouter = (): { push: jest.Mock } => ({ push: jest.fn() });

  beforeEach(() => {
    jest.useFakeTimers();
    resetNavigationGuard();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("pushes the href on first call", () => {
    const router = makeRouter();
    pushOnce(router as never, "/billing");
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/billing");
  });

  it("ignores a duplicate push within the cooldown window", () => {
    const router = makeRouter();
    pushOnce(router as never, "/billing");
    pushOnce(router as never, "/billing");
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it("allows a push again after the cooldown elapses", () => {
    const router = makeRouter();
    pushOnce(router as never, "/billing");
    jest.advanceTimersByTime(600);
    pushOnce(router as never, "/billing");
    expect(router.push).toHaveBeenCalledTimes(2);
  });

  it("treats different hrefs as independent", () => {
    const router = makeRouter();
    pushOnce(router as never, "/billing");
    pushOnce(router as never, "/legal/terms");
    expect(router.push).toHaveBeenCalledTimes(2);
  });

  it("dedupes object hrefs by their serialized shape", () => {
    const router = makeRouter();
    const href = {
      pathname: "/result",
      params: { entryId: "abc" },
    };
    pushOnce(router as never, href);
    pushOnce(router as never, href);
    expect(router.push).toHaveBeenCalledTimes(1);
  });
});