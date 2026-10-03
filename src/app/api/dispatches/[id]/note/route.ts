import { ctxFromRequest } from "@/server/context";
import { errorResponse } from "@/server/action";
import { dispatchNotePdf } from "@/server/pdf/dispatch-note";
import { AppError } from "@/server/errors";

/** GET /api/dispatches/:id/note -> PDF. Managers, and staff of the destination store (not drafts). */
export async function GET(req: Request, { params }: RouteContext<"/api/dispatches/[id]/note">) {
  try {
    const ctx = await ctxFromRequest(req);
    if (!ctx) throw new AppError("UNAUTHENTICATED", "Please sign in.");
    const { id } = await params;
    const { bytes, filename } = await dispatchNotePdf(ctx, id);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
