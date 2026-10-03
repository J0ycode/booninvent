import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Server-side pagination links that keep the other query params. */
export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  params,
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <p className="mt-3 text-sm text-muted-foreground num">{total} total</p>;
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    q.set("page", String(p));
    return `${basePath}?${q.toString()}`;
  };
  const btn = cn(buttonVariants({ variant: "outline", size: "icon" }));
  return (
    <nav className="mt-4 flex items-center justify-between gap-2" aria-label="Pagination">
      <p className="text-sm text-muted-foreground num">
        Page {page} of {pages} · {total} total
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link className={btn} href={href(page - 1)} aria-label="Previous page">
            <ChevronLeft />
          </Link>
        ) : (
          <span className={cn(btn, "pointer-events-none opacity-40")} aria-hidden>
            <ChevronLeft />
          </span>
        )}
        {page < pages ? (
          <Link className={btn} href={href(page + 1)} aria-label="Next page">
            <ChevronRight />
          </Link>
        ) : (
          <span className={cn(btn, "pointer-events-none opacity-40")} aria-hidden>
            <ChevronRight />
          </span>
        )}
      </div>
    </nav>
  );
}
