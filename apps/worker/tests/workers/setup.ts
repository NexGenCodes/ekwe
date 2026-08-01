import { beforeAll, afterEach, afterAll } from "vitest";
import { network } from "../msw/network";

beforeAll(() => {
  network.enable();
});

afterEach(() => {
  network.resetHandlers();
});

afterAll(() => {
  network.disable();
});
