import { setupServer } from "msw/node";
import { defaultHandlers } from "@/__tests__/msw/handlers";

export const server = setupServer(...defaultHandlers);
