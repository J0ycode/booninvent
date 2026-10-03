import type { ReactNode } from "react";
import { requirePageCtx } from "@/server/context";
import { getMyTenant } from "@/server/data/tenant";
import { AppShell } from "./app-shell";
import { NotificationBell } from "./notification-bell";
import type { Role } from "@/lib/roles";

/** Shared server layout for every portal: auth guard, shell, suspended-shop banner, bell. */
export async function PortalLayout({ role, children }: { role: Role; children: ReactNode }) {
  const ctx = await requirePageCtx(role);
  const tenant = ctx.tenantId ? await getMyTenant(ctx) : null;
  const banner =
    tenant?.status === "SUSPENDED" ? (
      <div role="alert" className="bg-danger-tint px-4 py-2 text-center text-sm font-medium text-danger-tint-foreground">
        This shop is suspended. You can view information, but changes are turned off. Please contact support.
      </div>
    ) : null;
  return (
    <AppShell role={role} userName={ctx.name} shopName={tenant?.name} banner={banner} bell={<NotificationBell ctx={ctx} />}>
      {children}
    </AppShell>
  );
}
