import "server-only";
import { getDb, type Tx } from "./db";
import { auditLogs } from "./db/schema";
import type { Ctx } from "./context";

/** Writes one audit row. Pass `tx` to make it part of the caller's transaction. */
export async function writeAudit(
  ctx: Pick<Ctx, "tenantId" | "userId"> | { tenantId: string | null; userId: string | null },
  action: string,
  entity: string,
  entityId?: string,
  data?: unknown,
  tx?: Tx,
) {
  const db = tx ?? (await getDb());
  await db.insert(auditLogs).values({
    tenantId: ctx.tenantId,
    userId: ctx.userId || null, // empty for API-key (machine) calls
    action,
    entity,
    entityId,
    data: data === undefined ? null : JSON.parse(JSON.stringify(data)),
  });
}
