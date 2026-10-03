/** A4 sticker sheet layouts (all sizes in mm). Shared by the preview (client) and the PDF (server). */
export interface LabelPreset {
  perSheet: 24 | 40 | 65;
  name: string;
  cols: number;
  rows: number;
  width: number;
  height: number;
  marginTop: number;
  marginLeft: number;
  gapX: number;
  gapY: number;
}

export const A4 = { width: 210, height: 297 };

export const LABEL_PRESETS: Record<24 | 40 | 65, LabelPreset> = {
  24: { perSheet: 24, name: "24 per sheet (70 × 37 mm)", cols: 3, rows: 8, width: 70, height: 37, marginTop: 0.5, marginLeft: 0, gapX: 0, gapY: 0 },
  40: { perSheet: 40, name: "40 per sheet (52.5 × 29.7 mm)", cols: 4, rows: 10, width: 52.5, height: 29.7, marginTop: 0, marginLeft: 0, gapX: 0, gapY: 0 },
  65: { perSheet: 65, name: "65 per sheet (38.1 × 21.2 mm)", cols: 5, rows: 13, width: 38.1, height: 21.2, marginTop: 10.7, marginLeft: 4.65, gapX: 2.5, gapY: 0 },
};

/** Top-left corner (mm from the page's top-left) of a 0-based slot. */
export function slotPosition(p: LabelPreset, slot: number) {
  const col = slot % p.cols;
  const row = Math.floor(slot / p.cols);
  return { x: p.marginLeft + col * (p.width + p.gapX), y: p.marginTop + row * (p.height + p.gapY) };
}

export const MAX_LABELS = 2000;
