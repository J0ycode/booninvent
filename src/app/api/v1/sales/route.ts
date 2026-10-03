import { ctxFromApiKey } from "@/server/data/apikeys";
import { applySale } from "@/server/stock/sales";
import { errorResponse } from "@/server/action";
import { AppError } from "@/server/errors";

/**
 * POST /api/v1/sales
 * Auth: "Authorization: Bearer <api key>" (or "X-API-Key: <api key>").
 * Body: { locationId, externalRef, items: [{ barcode, quantity }] }
 * 201 = recorded, 200 = duplicate externalRef (nothing changed, original result returned).
 * See README "Sales API" for error codes.
 */
export async function POST(req: Request) {
  try {
    const auth = req.headers.get("authorization");
    const key = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : req.headers.get("x-api-key");
    const ctx = await ctxFromApiKey(key);
    if (!ctx) throw new AppError("UNAUTHENTICATED", "Missing or invalid API key.");
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new AppError("VALIDATION", "Body must be JSON.");
    }
    const res = await applySale(ctx, body, "API");
    return Response.json(res, { status: res.duplicate ? 200 : 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
