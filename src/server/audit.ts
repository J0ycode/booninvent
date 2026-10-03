import "server-only";
import type { ClientSession } from "mongoose";
import { AuditLog } from "./models/core";
import type { Ctx } from "./context";

export async function writeAudit(
  ctx: Pick<Ctx, "tenantId" | "userId"> | { tenantId: string | null; userId: string | null },
  action: string,
  entity: string,
  entityId?: string,
  data?: unknown,
  session?: ClientSession,
) {
  await AuditLog.create(
    [{ tenantId: ctx.tenantId, userId: ctx.userId, action, entity, entityId, data }],
    { session },
  );
}
