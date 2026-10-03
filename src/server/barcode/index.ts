import "server-only";
import bwipjs from "bwip-js/node";

/** Code 128 as an SVG string (for on-screen display). */
export function code128Svg(text: string, opts: { height?: number; includetext?: boolean } = {}): string {
  return bwipjs.toSVG({ bcid: "code128", text, height: opts.height ?? 10, includetext: opts.includetext ?? true, textxalign: "center" });
}

/** Code 128 as PNG bytes (for PDFs). scale 3 gives crisp print at label sizes. */
export async function code128Png(text: string, opts: { height?: number; scale?: number } = {}): Promise<Buffer> {
  return bwipjs.toBuffer({ bcid: "code128", text, height: opts.height ?? 10, scale: opts.scale ?? 3, includetext: false });
}
