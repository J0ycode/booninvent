import "server-only";
import { z } from "zod";
import { LabelPrintLog } from "../models/business";
import { guard, tf } from "./guard";
import { runMutation } from "../mutation";
import { AppError } from "../errors";
import { getProductsByIds, type ProductView } from "./products";
import { objectId } from "@/lib/validation";
import { MAX_LABELS } from "@/lib/label-presets";
import type { Ctx } from "../context";

export const labelJobSchema = z.object({
  preset: z.union([z.literal(24), z.literal(40), z.literal(65)]),
  startPosition: z.number().int().min(1), // 1-based slot on the first sheet
  items: z
    .array(z.object({ productId: objectId, count: z.number().int().min(1).max(MAX_LABELS) }))
    .min(1, "Pick at least one product")
    .max(500),
});
export type LabelJob = z.output<typeof labelJobSchema>;

/** Validates a print job, logs it (labelPrintLog + audit), and returns the products to draw. */
export async function prepareLabelJob(ctx: Ctx | null, input: unknown): Promise<{ job: LabelJob; products: Map<string, ProductView> }> {
  const c = await guard(ctx, ["OWNER", "STOREROOM_MANAGER"]);
  const job = labelJobSchema.parse(input);
  if (job.startPosition > job.preset) throw new AppError("VALIDATION", `Start position must be between 1 and ${job.preset}.`);
  const total = job.items.reduce((s, i) => s + i.count, 0);
  if (total > MAX_LABELS) throw new AppError("VALIDATION", `Print up to ${MAX_LABELS} labels at a time.`);
  const products = await getProductsByIds(
    c,
    job.items.map((i) => i.productId),
  );
  if (products.size !== new Set(job.items.map((i) => i.productId)).size) throw new AppError("VALIDATION", "One of the products was not found.");
  await runMutation(c, { action: "labels.print", entity: "labelPrintLog" }, async (session) => {
    const [log] = await LabelPrintLog.create([{ ...tf(c), userId: c.userId, preset: job.preset, startPosition: job.startPosition, items: job.items, totalLabels: total }], { session });
    return { result: null, entityId: String(log._id), audit: { preset: job.preset, totalLabels: total } };
  });
  return { job, products };
}
