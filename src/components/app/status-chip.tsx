import { cn } from "@/lib/utils";

export type ChipTone = "mint" | "powder" | "peach" | "lavender" | "danger" | "neutral";

const TONES: Record<ChipTone, string> = {
  mint: "bg-mint text-mint-foreground",
  powder: "bg-powder text-powder-foreground",
  peach: "bg-peach text-peach-foreground",
  lavender: "bg-lavender text-lavender-foreground",
  danger: "bg-danger-tint text-danger-tint-foreground",
  neutral: "bg-muted text-muted-foreground",
};

export function StatusChip({ tone = "neutral", children, className }: { tone?: ChipTone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", TONES[tone], className)}>
      {children}
    </span>
  );
}

/** One place mapping every status in the app to a label + tone. */
export const STATUS: Record<string, { label: string; tone: ChipTone }> = {
  ACTIVE: { label: "Active", tone: "mint" },
  SUSPENDED: { label: "Suspended", tone: "danger" },
  INACTIVE: { label: "Inactive", tone: "neutral" },
  INVITED: { label: "Invited", tone: "powder" },
  DRAFT: { label: "Draft", tone: "neutral" },
  DISPATCHED: { label: "Dispatched", tone: "powder" },
  RECEIVED: { label: "Received", tone: "mint" },
  RECEIVED_WITH_ISSUES: { label: "Received with issues", tone: "peach" },
  RESOLVED: { label: "Resolved", tone: "mint" },
  WAITING_STAFF_APPROVAL: { label: "Waiting for Staff Approval", tone: "lavender" },
  SENT: { label: "Sent", tone: "powder" },
  APPROVED: { label: "Approved", tone: "mint" },
  REJECTED: { label: "Rejected", tone: "danger" },
  PENDING: { label: "Pending", tone: "peach" },
  SKIPPED: { label: "Skipped", tone: "neutral" },
  UNPAID: { label: "Unpaid", tone: "peach" },
  PAID: { label: "Paid", tone: "mint" },
  OVERDUE: { label: "Overdue", tone: "danger" },
  LOW: { label: "Low stock", tone: "peach" },
  OUT: { label: "Out of stock", tone: "danger" },
};

export function Status({ value }: { value: string }) {
  const s = STATUS[value] ?? { label: value, tone: "neutral" as const };
  return <StatusChip tone={s.tone}>{s.label}</StatusChip>;
}
