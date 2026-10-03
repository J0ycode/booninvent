import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, timestamp, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { tenants } from "./schema";
import type { MovementType } from "./types";

/*
 * Stock tables. ONLY src/server/stock may import this file (ESLint enforced).
 *  - stock_levels.quantity can never be negative (CHECK constraint, on top of the conditional update in code).
 *  - stock_movements is append-only: a database trigger rejects UPDATE and DELETE (see the ledger_guard migration).
 */

export const stockLevels = pgTable(
  "stock_levels",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull(),
    locationId: uuid("location_id").notNull(),
    quantity: integer("quantity").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("stock_levels_tenant_product_location_uq").on(t.tenantId, t.productId, t.locationId),
    index("stock_levels_tenant_location_qty_idx").on(t.tenantId, t.locationId, t.quantity),
    check("stock_levels_never_negative", sql`${t.quantity} >= 0`),
  ],
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    productId: uuid("product_id").notNull(),
    locationId: uuid("location_id").notNull(),
    type: text("type").$type<MovementType>().notNull(),
    quantityDelta: integer("quantity_delta").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    refType: text("ref_type").notNull(),
    refId: text("ref_id").notNull(),
    userId: uuid("user_id"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Insertion order, for a stable "newest first" within the same timestamp.
    seq: integer("seq").generatedAlwaysAsIdentity(),
  },
  (t) => [
    index("stock_movements_tenant_product_location_created_idx").on(t.tenantId, t.productId, t.locationId, t.createdAt),
    index("stock_movements_tenant_created_idx").on(t.tenantId, t.createdAt),
    check("stock_movements_delta_nonzero", sql`${t.quantityDelta} <> 0`),
  ],
);
