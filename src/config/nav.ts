import type { Role } from "@/lib/roles";

export type IconKey =
  | "home"
  | "box"
  | "truck"
  | "inbox"
  | "clipboard"
  | "undo"
  | "tag"
  | "receipt"
  | "chart"
  | "users"
  | "settings"
  | "history"
  | "store"
  | "download"
  | "wallet";

export interface NavItem {
  href: string;
  label: string;
  icon: IconKey;
}
export interface PortalNav {
  /** Sidebar / rail items (desktop + tablet). */
  items: NavItem[];
  /** Phone bottom bar: Home, Stock, [Scan], Requests, More. null = hide Scan (admin). */
  bottom: { home: string; stock: string | null; requests: string | null; scan: boolean };
}

export const NAV: Record<Role, PortalNav> = {
  PLATFORM_ADMIN: {
    items: [{ href: "/admin", label: "Shops", icon: "store" }],
    bottom: { home: "/admin", stock: null, requests: null, scan: false },
  },
  OWNER: {
    items: [
      { href: "/owner", label: "Dashboard", icon: "home" },
      { href: "/owner/reports", label: "Reports", icon: "chart" },
      { href: "/owner/approvals", label: "Approvals", icon: "clipboard" },
      { href: "/owner/bills", label: "Bills", icon: "receipt" },
      { href: "/owner/billing", label: "Billing", icon: "wallet" },
      { href: "/owner/users", label: "Users and Locations", icon: "users" },
      { href: "/owner/settings", label: "Settings", icon: "settings" },
    ],
    bottom: { home: "/owner", stock: "/owner/reports", requests: "/owner/approvals", scan: true },
  },
  STOREROOM_MANAGER: {
    items: [
      { href: "/storeroom", label: "Dashboard", icon: "home" },
      { href: "/storeroom/products", label: "Products", icon: "box" },
      { href: "/storeroom/receive", label: "Receive Stock", icon: "download" },
      { href: "/storeroom/dispatch", label: "Dispatch", icon: "truck" },
      { href: "/storeroom/requests", label: "Restock Requests", icon: "clipboard" },
      { href: "/storeroom/returns", label: "Returns and Damaged", icon: "undo" },
      { href: "/storeroom/labels", label: "Barcode Labels", icon: "tag" },
      { href: "/storeroom/bills", label: "Bills", icon: "receipt" },
      { href: "/storeroom/reports", label: "Reports", icon: "chart" },
    ],
    bottom: { home: "/storeroom", stock: "/storeroom/products", requests: "/storeroom/requests", scan: true },
  },
  STORE_STAFF: {
    items: [
      { href: "/store", label: "Dashboard", icon: "home" },
      { href: "/store/stock", label: "My Stock", icon: "box" },
      { href: "/store/incoming", label: "Incoming Dispatches", icon: "inbox" },
      { href: "/store/restock", label: "Request Restock", icon: "clipboard" },
      { href: "/store/returns", label: "Return or Report Damaged", icon: "undo" },
      { href: "/store/history", label: "Stock History", icon: "history" },
    ],
    bottom: { home: "/store", stock: "/store/stock", requests: "/store/restock", scan: true },
  },
};
