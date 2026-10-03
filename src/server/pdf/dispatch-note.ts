import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { brand } from "@/config/brand";
import { getDispatch } from "../stock/dispatches";
import { getProductsByIds } from "../data/products";
import { listLocations } from "../data/locations";
import { getMyTenant } from "../data/tenant";
import { code128Png } from "../barcode";
import type { Ctx } from "../context";

const A4: [number, number] = [595.28, 841.89];
const M = 40;

/** WinAnsi fonts cannot draw every character; replace anything outside Latin-1. */
const safe = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

function text(page: PDFPage, s: string, x: number, y: number, font: PDFFont, size = 10, color = rgb(0.1, 0.1, 0.1)) {
  page.drawText(safe(s), { x, y, size, font, color });
}

/** Truncates with "..." to fit a column width. */
export function fit(s: string, font: PDFFont, size: number, width: number) {
  const full = safe(s);
  if (font.widthOfTextAtSize(full, size) <= width) return full;
  let out = full;
  while (out.length > 1 && font.widthOfTextAtSize(out + "...", size) > width) out = out.slice(0, -1);
  return out + "...";
}

/** Printable dispatch note (A4) with company details, lines and signature boxes. */
export async function dispatchNotePdf(ctx: Ctx | null, id: string): Promise<{ bytes: Uint8Array; filename: string }> {
  const d = await getDispatch(ctx, id);
  const [products, locations, tenant] = await Promise.all([getProductsByIds(ctx, d.lines.map((l) => l.productId)), listLocations(ctx), getMyTenant(ctx)]);
  const locName = (lid: string) => locations.find((l) => l.id === lid)?.name ?? "";

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${d.number} dispatch note`);
  pdf.setProducer(brand.name);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const barcode = await pdf.embedPng(await code128Png(d.number, { height: 8, scale: 2 }));

  let page = pdf.addPage(A4);
  let y = A4[1] - M;

  const header = () => {
    text(page, tenant.name, M, y, bold, 16);
    const company = [tenant.company.address, tenant.company.phone, tenant.company.gstin ? `GSTIN ${tenant.company.gstin}` : ""].filter(Boolean).join("  ·  ");
    if (company) text(page, fit(company, font, 9, 330), M, y - 16, font, 9, rgb(0.35, 0.35, 0.35));
    page.drawImage(barcode, { x: A4[0] - M - 150, y: y - 30, width: 150, height: 34 });
    y -= 56;
    text(page, "DISPATCH NOTE", M, y, bold, 13);
    text(page, d.number, A4[0] - M - 150, y, bold, 12);
    y -= 22;
    const meta: [string, string][] = [
      ["From", locName(d.fromLocationId)],
      ["To", locName(d.toLocationId)],
      ["Status", d.status.replace(/_/g, " ").toLowerCase()],
      ["Date", new Date(d.dispatchedAt ?? d.createdAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })],
    ];
    meta.forEach(([k, v], i) => {
      const x = M + (i % 2) * 260;
      const yy = y - Math.floor(i / 2) * 15;
      text(page, `${k}:`, x, yy, bold, 10);
      text(page, v, x + 45, yy, font, 10);
    });
    y -= 40;
    page.drawRectangle({ x: M, y: y - 5, width: A4[0] - 2 * M, height: 20, color: rgb(0.92, 0.96, 0.95) });
    text(page, "#", M + 6, y, bold, 9);
    text(page, "Product", M + 28, y, bold, 9);
    text(page, "SKU", M + 300, y, bold, 9);
    text(page, "Qty sent", M + 400, y, bold, 9);
    text(page, "Received", M + 460, y, bold, 9);
    y -= 22;
  };
  header();

  d.lines.forEach((l, i) => {
    if (y < M + 120) {
      page = pdf.addPage(A4);
      y = A4[1] - M;
      header();
    }
    const p = products.get(l.productId);
    text(page, String(i + 1), M + 6, y, font, 9);
    text(page, fit(p?.name ?? "Product", font, 9, 265), M + 28, y, font, 9);
    text(page, fit(p?.sku ?? "", font, 9, 95), M + 300, y, font, 9);
    text(page, String(l.quantity), M + 400, y, font, 9);
    text(page, l.receivedQty === null ? "______" : String(l.receivedQty), M + 460, y, font, 9);
    page.drawLine({ start: { x: M, y: y - 6 }, end: { x: A4[0] - M, y: y - 6 }, thickness: 0.4, color: rgb(0.85, 0.85, 0.85) });
    y -= 18;
  });

  y -= 6;
  text(page, `Total pieces: ${d.totalPieces}`, M + 300, y, bold, 10);
  if (d.note) text(page, fit(`Note: ${d.note}`, font, 9, A4[0] - 2 * M), M, y - 18, font, 9);

  const sigY = M + 40;
  ["Packed by (Store Room)", "Received by (Store)"].forEach((label, i) => {
    const x = M + i * 270;
    page.drawLine({ start: { x, y: sigY }, end: { x: x + 220, y: sigY }, thickness: 0.6 });
    text(page, label, x, sigY - 14, font, 9, rgb(0.35, 0.35, 0.35));
  });
  text(page, brand.name, M, M - 14, font, 7, rgb(0.55, 0.55, 0.55));

  return { bytes: await pdf.save(), filename: `${d.number}.pdf` };
}
