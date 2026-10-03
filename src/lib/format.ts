const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 });
const int = new Intl.NumberFormat("en-IN");
const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

/** Integer paise -> "₹1,234.50" */
export const money = (paise: number | null | undefined) => (paise == null ? "—" : inr.format(paise / 100));
/** Paise -> plain rupees string for inputs ("1234.50"). */
export const paiseToInput = (paise: number | null | undefined) => (paise == null ? "" : (paise / 100).toFixed(2));
export const qtyFmt = (n: number | null | undefined) => (n == null ? "—" : int.format(n));
export const date = (d: string | Date | null | undefined) => (d ? dateFmt.format(new Date(d)) : "—");
export const dateTime = (d: string | Date | null | undefined) => (d ? dateTimeFmt.format(new Date(d)) : "—");
/** yyyy-mm-dd in India time, for <input type="date"> values. */
export const isoDay = (d: Date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
