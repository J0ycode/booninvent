import { timingSafeEqual } from "node:crypto";
import { errorResponse } from "@/server/action";
import { AppError } from "@/server/errors";
import { env } from "@/server/env";
import { sendLowStockDigests } from "@/server/data/alerts";

/**
 * GET /api/cron/low-stock -> sends the daily low-stock summary emails. Called by a scheduler (see vercel.json),
 * never by a signed-in user: it needs "Authorization: Bearer <CRON_SECRET>". Without CRON_SECRET set it always refuses.
 */
export async function GET(req: Request) {
  try {
    const secret = env.cronSecret;
    const given = Buffer.from(req.headers.get("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${secret}`);
    if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new AppError("UNAUTHENTICATED", "Not allowed.");
    }
    return Response.json(await sendLowStockDigests());
  } catch (e) {
    return errorResponse(e);
  }
}
