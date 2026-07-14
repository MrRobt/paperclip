import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const environments = pgTable(
  "environments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    driver: text("driver").notNull().default("local"),
    status: text("status").notNull().default("active"),
    /**
     * Environments sharing a pool key are interchangeable workers. An agent pointed at any
     * member runs on whichever member is least loaded, which is what lets a fleet of boxes
     * absorb work instead of every run piling onto one hard-bound machine.
     */
    poolKey: text("pool_key"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("environments_company_status_idx").on(table.companyId, table.status),
    companyPoolIdx: index("environments_company_pool_idx").on(table.companyId, table.poolKey),
    companyDriverIdx: uniqueIndex("environments_company_driver_idx")
      .on(table.companyId, table.driver)
      .where(sql`${table.driver} = 'local'`),
    companyNameIdx: index("environments_company_name_idx").on(table.companyId, table.name),
  }),
);
