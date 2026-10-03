import "server-only";

/*
 * The ONE place that decides which tenant a request belongs to.
 * Today: the tenant always comes from the signed-in user's record.
 * Later: per-shop subdomains (shop.example.com) can be checked here by passing the
 * request host and rejecting a mismatch, without touching the data layer.
 */
export function resolveTenantId(user: { tenantId: string | null }, _host?: string | null): string | null {
  return user.tenantId ?? null;
}
