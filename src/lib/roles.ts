export const ROLES = ["PLATFORM_ADMIN", "OWNER", "STOREROOM_MANAGER", "STORE_STAFF"] as const;
export type Role = (typeof ROLES)[number];

export const TENANT_ROLES = ["OWNER", "STOREROOM_MANAGER", "STORE_STAFF"] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

/** Roles allowed to see cost prices and supplier bills. */
export const MANAGER_ROLES = ["OWNER", "STOREROOM_MANAGER"] as const;

export const ROLE_LABEL: Record<Role, string> = {
  PLATFORM_ADMIN: "Platform admin",
  OWNER: "Owner",
  STOREROOM_MANAGER: "Store Room manager",
  STORE_STAFF: "Store staff",
};

export const PORTAL_BY_ROLE: Record<Role, string> = {
  PLATFORM_ADMIN: "/admin",
  OWNER: "/owner",
  STOREROOM_MANAGER: "/storeroom",
  STORE_STAFF: "/store",
};

export function portalRoleForPath(pathname: string): Role | null {
  for (const [role, prefix] of Object.entries(PORTAL_BY_ROLE) as [Role, string][]) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return role;
  }
  return null;
}
