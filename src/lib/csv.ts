/** CSV with proper quoting; cells that start with = + - @ are prefixed with ' so spreadsheets do not run them as formulas. */
export function toCsv<T>(rows: T[], columns: { header: string; value: (r: T) => string | number | null | undefined }[]): string {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => cell(c.header)).join(","), ...rows.map((r) => columns.map((c) => cell(c.value(r))).join(","))];
  return "﻿" + lines.join("\r\n") + "\r\n"; // BOM so Excel opens UTF-8 correctly
}

export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

/** Paise as a plain rupee number for spreadsheets ("1234.50"). */
export const rupeesPlain = (paise: number | null | undefined) => (paise == null ? "" : (paise / 100).toFixed(2));
