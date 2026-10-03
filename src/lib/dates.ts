/** Date helpers in India time (the app's business timezone). */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Midnight today in India, as a UTC Date. */
export function startOfTodayIST(now = new Date()): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - IST_OFFSET_MS);
}

/** "2026-10-03" (a date picked in India) -> midnight IST as a UTC Date. */
export function parseDayIST(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) - IST_OFFSET_MS);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** End of that IST day (inclusive range end). */
export function endOfDayIST(day: string): Date | null {
  const d = parseDayIST(day);
  return d ? new Date(d.getTime() + 24 * 60 * 60 * 1000 - 1) : null;
}

/** Overdue = UNPAID and the due date is before today (India time). Never stored. */
export function isOverdue(b: { status: string; dueDate: string | Date }, now = new Date()) {
  return b.status === "UNPAID" && new Date(b.dueDate).getTime() < startOfTodayIST(now).getTime();
}
