import { ctxFromRequest } from "@/server/context";
import { errorResponse } from "@/server/action";
import { labelsPdf } from "@/server/pdf/labels";
import { AppError } from "@/server/errors";

/** POST /api/labels { preset, startPosition, items: [{ productId, count }] } -> A4 label PDF. Logs each print. */
export async function POST(req: Request) {
  try {
    const ctx = await ctxFromRequest(req);
    if (!ctx) throw new AppError("UNAUTHENTICATED", "Please sign in.");
    const body = await req.json().catch(() => {
      throw new AppError("VALIDATION", "Body must be JSON.");
    });
    const bytes = await labelsPdf(ctx, body);
    return new Response(Buffer.from(bytes), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="labels.pdf"', "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
