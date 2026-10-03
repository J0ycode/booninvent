import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, bigint, boolean, timestamp, jsonb, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import type { Role } from "@/lib/roles";
import type {
  Category,
  LocationType,
  TenantStatus,
  DispatchStatus,
  DispatchLine,
  RestockStatus,
  RestockLine,
  ReceiptLine,
  ReturnType,
  EntryStatus,
  SaleItem,
  LabelItem,
} from "./types";

/*
 * Postgres (Supabase) schema. Business tables always carry tenant_id.
 * stock_levels and stock_movements live in ./stock-schema.ts (importable only from src/server/stock).
 * Document lines (receipt, dispatch, restock, sale, label job) are JSON columns: they are always read and
 * written together with their parent row, inside one transaction.
 */

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const ts = (name: string) => timestamp(name, { withTimezone: true });

/* ---------- tenants, locations, users ---------- */

export const tenants = pgTable("tenants", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  status: text("status").$type<TenantStatus>().notNull().default("ACTIVE"),
  company: jsonb("company").$type<{ address?: string; phone?: string; email?: string; gstin?: string }>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const locations = pgTable(
  "locations",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").$type<LocationType>().notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("locations_tenant_name_uq").on(t.tenantId, t.name)],
);

export const users = pgTable(
  "users",
  {
    id: id(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }), // null for PLATFORM_ADMIN
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    passwordHash: text("password_hash"),
    role: text("role").$type<Role>().notNull(),
    locationIds: uuid("location_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    active: boolean("active").notNull().default(true),
    sessionVersion: integer("session_version").notNull().default(1),
    lastLoginAt: ts("last_login_at"),
    createdAt: createdAt(),
  },
  (t) => [index("users_tenant_idx").on(t.tenantId)],
);

export const authTokens = pgTable(
  "auth_tokens",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<"INVITE" | "RESET">().notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
  },
  (t) => [index("auth_tokens_user_idx").on(t.userId)],
);

export const loginAttempts = pgTable("login_attempts", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  expiresAt: ts("expires_at").notNull(),
});

export const counters = pgTable(
  "counters",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    seq: integer("seq").notNull().default(0),
  },
  (t) => [uniqueIndex("counters_tenant_name_uq").on(t.tenantId, t.name)],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    result: jsonb("result"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("idempotency_scope_key_uq").on(t.scope, t.key)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    tenantId: uuid("tenant_id"),
    userId: uuid("user_id"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    data: jsonb("data"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    createdBy: uuid("created_by").notNull(),
    revokedAt: ts("revoked_at"),
    lastUsedAt: ts("last_used_at"),
    createdAt: createdAt(),
  },
  (t) => [index("api_keys_tenant_idx").on(t.tenantId)],
);

/* ---------- catalogue ---------- */

export const suppliers = pgTable(
  "suppliers",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    gstin: text("gstin"),
    address: text("address"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("suppliers_tenant_name_uq").on(t.tenantId, t.name)],
);

export const products = pgTable(
  "products",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameLower: text("name_lower").notNull(),
    category: text("category").$type<Category>().notNull(),
    sku: text("sku").notNull(),
    barcode: text("barcode").notNull(),
    sellingPrice: integer("selling_price").notNull(), // paise
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    reorderLevel: integer("reorder_level").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("products_tenant_barcode_uq").on(t.tenantId, t.barcode),
    uniqueIndex("products_tenant_sku_uq").on(t.tenantId, t.sku),
    index("products_tenant_name_idx").on(t.tenantId, t.nameLower),
    check("products_price_nonneg", sql`${t.sellingPrice} >= 0 and ${t.reorderLevel} >= 0`),
  ],
);

/** Cost prices: only ever read for OWNER / STOREROOM_MANAGER. */
export const productCosts = pgTable(
  "product_costs",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    costPrice: integer("cost_price").notNull(), // paise
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("product_costs_tenant_product_uq").on(t.tenantId, t.productId)],
);

/* ---------- documents ---------- */

export const receipts = pgTable(
  "receipts",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    invoiceNumber: text("invoice_number").notNull(),
    locationId: uuid("location_id").notNull(),
    lines: jsonb("lines").$type<ReceiptLine[]>().notNull(),
    note: text("note"),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("receipts_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

export const dispatches = pgTable(
  "dispatches",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    fromLocationId: uuid("from_location_id").notNull(),
    toLocationId: uuid("to_location_id").notNull(),
    status: text("status").$type<DispatchStatus>().notNull().default("DRAFT"),
    lines: jsonb("lines").$type<DispatchLine[]>().notNull(),
    note: text("note"),
    restockRequestId: uuid("restock_request_id"),
    createdBy: uuid("created_by").notNull(),
    dispatchedAt: ts("dispatched_at"),
    dispatchedBy: uuid("dispatched_by"),
    receivedAt: ts("received_at"),
    receivedBy: uuid("received_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("dispatches_tenant_to_status_idx").on(t.tenantId, t.toLocationId, t.status),
    index("dispatches_tenant_created_idx").on(t.tenantId, t.createdAt),
  ],
);

export const restockRequests = pgTable(
  "restock_requests",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    locationId: uuid("location_id").notNull(),
    source: text("source").$type<"MANUAL" | "SUGGESTED">().notNull(),
    status: text("status").$type<RestockStatus>().notNull().default("DRAFT"),
    lines: jsonb("lines").$type<RestockLine[]>().notNull(),
    note: text("note"),
    createdBy: uuid("created_by").notNull(),
    sentAt: ts("sent_at"),
    decidedBy: uuid("decided_by"),
    decidedAt: ts("decided_at"),
    rejectReason: text("reject_reason"),
    dispatchId: uuid("dispatch_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("restock_tenant_loc_status_idx").on(t.tenantId, t.locationId, t.status)],
);

export const returnDamageEntries = pgTable(
  "return_damage_entries",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").notNull(),
    type: text("type").$type<ReturnType>().notNull(),
    productId: uuid("product_id").notNull(),
    quantity: integer("quantity").notNull(),
    reason: text("reason").notNull(),
    status: text("status").$type<EntryStatus>().notNull().default("PENDING"),
    createdBy: uuid("created_by").notNull(),
    decidedBy: uuid("decided_by"),
    decidedAt: ts("decided_at"),
    decisionNote: text("decision_note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("returns_tenant_status_created_idx").on(t.tenantId, t.status, t.createdAt),
    check("returns_qty_positive", sql`${t.quantity} > 0`),
  ],
);

export const sales = pgTable(
  "sales",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").notNull(),
    externalRef: text("external_ref").notNull(),
    source: text("source").$type<"API" | "INTERNAL">().notNull(),
    items: jsonb("items").$type<SaleItem[]>().notNull(),
    createdAt: createdAt(),
  },
  // Sales idempotency: one sale per (tenant, externalRef).
  (t) => [uniqueIndex("sales_tenant_external_ref_uq").on(t.tenantId, t.externalRef)],
);

export const bills = pgTable(
  "bills",
  {
    id: id(),
    kind: text("kind").$type<"SUPPLIER" | "PLATFORM">().notNull(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id"),
    receiptId: uuid("receipt_id"),
    billNumber: text("bill_number").notNull(),
    description: text("description"),
    billDate: ts("bill_date").notNull(), // bill date (supplier) or issue date (platform)
    dueDate: ts("due_date").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(), // paise
    note: text("note"),
    status: text("status").$type<"UNPAID" | "PAID">().notNull().default("UNPAID"),
    paidDate: ts("paid_date"),
    paidBy: uuid("paid_by"),
    paidNote: text("paid_note"),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("bills_tenant_kind_status_due_idx").on(t.tenantId, t.kind, t.status, t.dueDate),
    check("bills_amount_nonneg", sql`${t.amount} >= 0`),
  ],
);

export const labelPrintLogs = pgTable(
  "label_print_logs",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    preset: integer("preset").notNull(),
    startPosition: integer("start_position").notNull(),
    items: jsonb("items").$type<LabelItem[]>().notNull(),
    totalLabels: integer("total_labels").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("label_logs_tenant_idx").on(t.tenantId)],
);
