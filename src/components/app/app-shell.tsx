"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ScanLine, LogOut, MoreHorizontal } from "lucide-react";
import { NAV, type NavItem } from "@/config/nav";
import { brand } from "@/config/brand";
import { ROLE_LABEL, type Role } from "@/lib/roles";
import { ICONS } from "./icons";
import { ThemeToggle } from "./theme-toggle";
import { OfflineBanner } from "./offline-banner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

function isActive(pathname: string, href: string, home: string) {
  return href === home ? pathname === home : pathname === href || pathname.startsWith(href + "/");
}

function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2 font-bold">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-sm text-primary-foreground" aria-hidden>
        {brand.logoText}
      </span>
      {!compact && <span className="truncate">{brand.name}</span>}
    </span>
  );
}

function SignOut({ compact }: { compact?: boolean }) {
  return (
    <form action="/logout" method="post">
      <button
        type="submit"
        className={cn(
          "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
          compact && "justify-center px-0",
        )}
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut className="size-5 shrink-0" aria-hidden />
        {!compact && "Sign out"}
      </button>
    </form>
  );
}

function NavList({
  items,
  pathname,
  home,
  compact,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  home: string;
  compact?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((it) => {
        const Icon = ICONS[it.icon];
        const active = isActive(pathname, it.href, home);
        return (
          <li key={it.href}>
            <Link
              href={it.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              title={compact ? it.label : undefined}
              aria-label={compact ? it.label : undefined}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors",
                compact && "min-h-12 justify-center px-0",
                active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-5 shrink-0" aria-hidden />
              {!compact && <span className="truncate">{it.label}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function AppShell({
  role,
  userName,
  shopName,
  banner,
  bell,
  children,
}: {
  role: Role;
  userName: string;
  shopName?: string;
  banner?: ReactNode;
  bell?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const nav = NAV[role];
  const home = nav.bottom.home;
  const [moreOpen, setMoreOpen] = useState(false);
  const roleLine = `${ROLE_LABEL[role]}${shopName ? ` · ${shopName}` : ""}`;

  const bottomItems = [
    { key: "home", href: home, label: "Home", icon: ICONS.home },
    nav.bottom.stock ? { key: "stock", href: nav.bottom.stock, label: "Stock", icon: ICONS.box } : null,
    nav.bottom.scan ? { key: "scan", href: `${home}/lookup?scan=1`, label: "Scan", icon: ScanLine } : null,
    nav.bottom.requests ? { key: "req", href: nav.bottom.requests, label: "Requests", icon: ICONS.clipboard } : null,
  ].filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-lg focus:bg-card focus:p-3">
        Skip to content
      </a>

      {/* desktop sidebar (lg+) */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r bg-sidebar p-3 lg:flex">
        <Link href={home} className="mb-4 px-2 py-2">
          <Logo />
        </Link>
        <nav aria-label="Main" className="flex-1 overflow-y-auto">
          <NavList items={nav.items} pathname={pathname} home={home} />
        </nav>
        <div className="border-t pt-3">
          <p className="truncate px-3 text-sm font-medium">{userName}</p>
          <p className="truncate px-3 pb-2 text-xs text-muted-foreground">{roleLine}</p>
          <SignOut />
        </div>
      </aside>

      {/* tablet icon rail (md to lg) */}
      <aside className="sticky top-0 hidden h-dvh w-20 shrink-0 flex-col border-r bg-sidebar p-2 md:flex lg:hidden">
        <Link href={home} className="mb-3 flex justify-center py-2" aria-label={brand.name}>
          <Logo compact />
        </Link>
        <nav aria-label="Main" className="flex-1 overflow-y-auto">
          <NavList items={nav.items} pathname={pathname} home={home} compact />
        </nav>
        <SignOut compact />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineBanner />
        {banner}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur md:px-6">
          <Link href={home} className="min-w-0 md:hidden" aria-label={brand.name}>
            <Logo compact />
          </Link>
          <p className="hidden min-w-0 truncate text-sm text-muted-foreground md:block">{shopName ?? brand.name}</p>
          <div className="ml-auto flex items-center gap-1">
            {bell}
            <ThemeToggle />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-28 md:px-6 md:pb-10">
          {children}
        </main>
      </div>

      {/* phone bottom navigation */}
      <nav aria-label="Quick" className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur md:hidden">
        <ul className="mx-auto flex h-16 max-w-md items-stretch justify-around px-1">
          {bottomItems.map((it) => {
            const Icon = it.icon;
            if (it.key === "scan") {
              return (
                <li key={it.key} className="flex flex-1 justify-center">
                  <Link
                    href={it.href}
                    aria-label="Scan a barcode"
                    className="-mt-5 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md"
                  >
                    <Icon className="size-6" aria-hidden />
                  </Link>
                </li>
              );
            }
            const active = isActive(pathname, it.href, home);
            return (
              <li key={it.key} className="flex flex-1">
                <Link
                  href={it.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <Icon className="size-5" aria-hidden />
                  {it.label}
                </Link>
              </li>
            );
          })}
          <li className="flex flex-1">
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className="flex flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium text-muted-foreground"
              aria-haspopup="dialog"
            >
              <MoreHorizontal className="size-5" aria-hidden />
              More
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] rounded-t-2xl pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <SheetHeader>
            <SheetTitle>{userName}</SheetTitle>
            <p className="text-sm text-muted-foreground">{roleLine}</p>
          </SheetHeader>
          <nav aria-label="All pages" className="overflow-y-auto px-4">
            <NavList items={nav.items} pathname={pathname} home={home} onNavigate={() => setMoreOpen(false)} />
          </nav>
          <div className="px-4">
            <SignOut />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
