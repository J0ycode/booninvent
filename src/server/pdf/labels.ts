import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFImage } from "pdf-lib";
import { brand } from "@/config/brand";
import { code128Png } from "../barcode";
import { prepareLabelJob } from "../data/labels";
import { A4, LABEL_PRESETS, slotPosition } from "@/lib/label-presets";
import { fit } from "./dispatch-note";
import type { Ctx } from "../context";

const MM = 72 / 25.4; // points per mm
const rupees = (paise: number) => `Rs. ${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** A4 label sheets: name, price, SKU and a Code 128 barcode on each label. */
export async function labelsPdf(ctx: Ctx | null, input: unknown): Promise<Uint8Array> {
  const { job, products } = await prepareLabelJob(ctx, input);
  const preset = LABEL_PRESETS[job.preset];
  const pdf = await PDFDocument.create();
  pdf.setTitle("Barcode labels");
  pdf.setProducer(brand.name);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const barcodes = new Map<string, PDFImage>();
  for (const id of new Set(job.items.map((i) => i.productId))) {
    barcodes.set(id, await pdf.embedPng(await code128Png(products.get(id)!.barcode, { height: 9, scale: 3 })));
  }

  // Sizes scale with the label height.
  const h = preset.height * MM;
  const w = preset.width * MM;
  const pad = Math.min(2.2, preset.height * 0.08) * MM;
  const nameSize = preset.perSheet === 65 ? 5.6 : preset.perSheet === 40 ? 7 : 8;
  const smallSize = nameSize - 1;

  const queue = job.items.flatMap((i) => Array.from({ length: i.count }, () => i.productId));
  let slot = job.startPosition - 1;
  let page = pdf.addPage([A4.width * MM, A4.height * MM]);
  for (const pid of queue) {
    if (slot >= preset.perSheet) {
      page = pdf.addPage([A4.width * MM, A4.height * MM]);
      slot = 0;
    }
    const p = products.get(pid)!;
    const pos = slotPosition(preset, slot);
    const x = pos.x * MM;
    const top = A4.height * MM - pos.y * MM; // pdf y grows upwards
    const innerW = w - 2 * pad;

    page.drawText(fit(p.name, bold, nameSize, innerW), { x: x + pad, y: top - pad - nameSize, size: nameSize, font: bold, color: rgb(0, 0, 0) });
    const price = rupees(p.sellingPrice);
    const lineY = top - pad - nameSize - smallSize - 1.5;
    page.drawText(price, { x: x + pad, y: lineY, size: smallSize + 0.5, font: bold });
    const sku = fit(p.sku, font, smallSize, innerW / 2);
    page.drawText(sku, { x: x + w - pad - font.widthOfTextAtSize(sku, smallSize), y: lineY, size: smallSize, font });

    const codeTextSize = smallSize - 0.5;
    const barTop = lineY - 2;
    const barBottom = top - h + pad + codeTextSize + 1;
    const barH = Math.max(6, barTop - barBottom);
    page.drawImage(barcodes.get(pid)!, { x: x + pad, y: barBottom, width: innerW, height: barH });
    const code = fit(p.barcode, font, codeTextSize, innerW);
    page.drawText(code, { x: x + (w - font.widthOfTextAtSize(code, codeTextSize)) / 2, y: top - h + pad, size: codeTextSize, font });
    slot++;
  }
  return pdf.save();
}
