import * as schema from "./schema/index";
import * as localSchema from "./local-schema";

export { schema, localSchema };

export type History = typeof schema.history.$inferSelect;
export type NewHistory = typeof schema.history.$inferInsert;

export type LocalHistory = typeof localSchema.history.$inferSelect;
export type LocalNewHistory = typeof localSchema.history.$inferInsert;

export type LocalOutbox = typeof localSchema.outbox.$inferSelect;
export type LocalNewOutbox = typeof localSchema.outbox.$inferInsert;
