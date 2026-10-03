import "server-only";
import { and, count, desc, eq, gte, ilike, isNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { auditLogs, users } from "../db/schema";
import { escapeLike } from "../db/helpers";
import { guard, isId } from "./guard";
import { parseDayIST, endOfDayIST } from "@/lib/dates";
import type { Ctx } from "../context";

/** Areas of the app an audit entry can belong to (audit_logs.entity), with the label shown in the filter. */
export const AUDIT_AREAS = {
  product: "Products",
  supplier: "Suppliers",
  receipt: "Receiving stock",
  dispatch: "Dispatches",
  restockRequest: "Restock requests",
  returnDamageEntry: "Returns and damaged",
  sale: "Sales",
  bill: "Bills",
  labelPrintLog: "Label printing",
  user: "Users",
  location: "Locations",
  tenant: "Shop settings",
  apiKey: "Sales API key",
} as const;
export type AuditArea = keyof typeof AUDIT_AREAS;

export interface AuditRow {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  /** null = done by the sales API key (no person). */
  userId: string | null;
  userName: string | null;
  data: unknown;
  createdAt: string;
}

export interface AuditQuery {
  area?: string;
  /** A user id, or "api" for entries made by the sales API key. */
  userId?: string;
  from?: string; // yyyy-mm-dd, India time
  to?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

/** The shop's activity log, newest first. OWNER only: entries can include cost prices and bill amounts. */
export async function listAuditLogs(ctx: Ctx | null, query: AuditQuery = {}) {
  const c = await guard(ctx, ["OWNER"]);
  const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), 100);
  const page = Math.max(query.page ?? 1, 1);
  const from = query.from ? parseDayIST(query.from) : null;
  const to = query.to ? endOfDayIST(query.to) : null;
  const q = query.q?.trim();
  const pattern = q ? `%${escapeLike(q)}%` : null;
  const where = and(
    eq(auditLogs.tenantId, c.tenantId),
    query.area && query.area in AUDIT_AREAS ? eq(auditLogs.entity, query.area) : undefined,
    query.userId === "api" ? isNull(auditLogs.userId) : isId(query.userId) ? eq(auditLogs.userId, query.userId) : undefined,
    from ? gte(auditLogs.createdAt, from) : undefined,
    to ? lte(auditLogs.createdAt, to) : undefined,
    pattern ? or(ilike(auditLogs.action, pattern), sql`${auditLogs.data}::text ilike ${pattern}`) : undefined,
  );
  const db = await getDb();
  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entity: auditLogs.entity,
      entityId: auditLogs.entityId,
      userId: auditLogs.userId,
      userName: users.name,
      data: auditLogs.data,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    // Only names of this shop's own users are joined in.
    .leftJoin(users, and(eq(users.id, auditLogs.userId), eq(users.tenantId, c.tenantId)))
    .where(where)
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [{ total }] = await db.select({ total: count() }).from(auditLogs).where(where);
  return { rows: rows.map((r): AuditRow => ({ ...r, createdAt: r.createdAt.toISOString() })), total, page, pageSize };
}
