import {
  pgTable,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  check,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const appConfig = pgTable(
  "app_config",
  {
    id: integer("id").primaryKey(),
    revenuecatEnabled: boolean("revenuecat_enabled").notNull().default(true),
    flutterwaveEnabled: boolean("flutterwave_enabled").notNull().default(false),
    defaultProvider: text("default_provider").notNull().default("revenuecat"),
    basePriceUsd: numeric("base_price_usd", { precision: 10, scale: 2 })
      .notNull()
      .default("2.00"),
    discountPercent: numeric("discount_percent", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    annualDiscountPercent: numeric("annual_discount_percent", {
      precision: 5,
      scale: 2,
    })
      .notNull()
      .default("20"),
    localPrices: jsonb("local_prices")
      .notNull()
      .default(sql`'{}'::jsonb`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("app_config_id_check", sql`${table.id} = 1`),
    check(
      "app_config_default_provider_check",
      sql`${table.defaultProvider} IN ('revenuecat', 'flutterwave')`,
    ),
  ],
);
