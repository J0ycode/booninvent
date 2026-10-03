import "server-only";
import { and, eq, isNull, ne, or } from "drizzle-orm";
import { getDb } from "../db";
import { tenants, users } from "../db/schema";
import { listLocations } from "./locations";
import { stockAtLocation } from "../stock/read";
import { sendEmail } from "../email";
import { env } from "../env";
import { isoDay } from "@/lib/format";
import type { TenantCtx } from "../context";

/*
 * Daily low-stock summary email (optional, switched on by the OWNER in Settings).
 * Run by a scheduled job (GET /api/cron/low-stock), not by a signed-in user, so like the pre-auth functions in
 * auth.ts it takes no Ctx. It builds a read-only machine context per shop and goes through the normal data functions,
 * so every query is still scoped to that one tenant.
 */

const MAX_ITEMS_PER_LOCATION = 30;

export interface DigestResult {
  shops: number; // shops with the email switched on that were due today
  emails: number; // emails sent
  failed: number;
}

/** A machine context for one shop (no user), used only to read stock for the summary. */
const systemCtx = (t: { id: string; name: string }): TenantCtx => ({
  userId: "",
  role: "OWNER",
  tenantId: t.id,
  locationIds: [],
  tenantStatus: "ACTIVE",
  name: "Low-stock email",
  email: "",
});

/** The email body for one shop, or null when nothing is low. */
export async function lowStockSummary(c: TenantCtx): Promise<{ items: number; text: string } | null> {
  const locations = await listLocations(c);
  const blocks: string[] = [];
  let items = 0;
  for (const l of locations) {
    // Same rule as the dashboards: the Store Room also counts products it never received.
    const low = await stockAtLocation(c, l.id, { low: true, includeUnstocked: l.type === "STORE_ROOM", pageSize: MAX_ITEMS_PER_LOCATION });
    if (!low.total) continue;
    items += low.total;
    const lines = low.rows.map((r) => `  - ${r.name} (${r.sku}): ${r.quantity} left, reorder level ${r.reorderLevel}`);
    if (low.total > low.rows.length) lines.push(`  ...and ${low.total - low.rows.length} more`);
    blocks.push(`${l.name}: ${low.total} ${low.total === 1 ? "item" : "items"}\n${lines.join("\n")}`);
  }
  if (!items) return null;
  return { items, text: blocks.join("\n\n") };
}

/**
 * Sends today's summary to the owners of every active shop that switched it on. Safe to call more than once a day:
 * each shop is claimed for the day first, so a second run sends nothing.
 */
export async function sendLowStockDigests(now = new Date()): Promise<DigestResult> {
  const db = await getDb();
  const today = isoDay(now);
  const due = await db
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .where(and(eq(tenants.lowStockEmail, true), eq(tenants.status, "ACTIVE"), or(isNull(tenants.lowStockEmailSentOn), ne(tenants.lowStockEmailSentOn, today))));
  const result: DigestResult = { shops: 0, emails: 0, failed: 0 };
  for (const t of due) {
    const [claimed] = await db
      .update(tenants)
      .set({ lowStockEmailSentOn: today })
      .where(and(eq(tenants.id, t.id), or(isNull(tenants.lowStockEmailSentOn), ne(tenants.lowStockEmailSentOn, today))))
      .returning({ id: tenants.id });
    if (!claimed) continue; // another run got there first
    result.shops++;
    try {
      const summary = await lowStockSummary(systemCtx(t));
      if (!summary) continue;
      const owners = await db
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(and(eq(users.tenantId, t.id), eq(users.role, "OWNER"), eq(users.active, true)));
      for (const o of owners) {
        await sendEmail(
          o.email,
          `${summary.items} low-stock ${summary.items === 1 ? "item" : "items"} at ${t.name}`,
          `Hello ${o.name},\n\nThese items are at or below their reorder level today:\n\n${summary.text}\n\nOpen the low-stock report: ${env.appUrl}/owner/reports?type=low\n\nYou get this email once a day while anything is low. Turn it off in Settings.`,
        );
        result.emails++;
      }
    } catch (e) {
      result.failed++;
      console.error("[low-stock email]", t.id, e);
    }
  }
  return result;
}
