/* Shared domain types (no runtime code, safe to import as types from UI files). */

export type TenantStatus = "ACTIVE" | "SUSPENDED";
export type LocationType = "STORE_ROOM" | "STORE";
export type Category = "CLOTHING" | "ACCESSORY";

export interface ReceiptLine {
  productId: string;
  quantity: number;
  cost: number | null; // paise
}

export type DispatchStatus = "DRAFT" | "DISPATCHED" | "RECEIVED" | "RECEIVED_WITH_ISSUES" | "RESOLVED";
export interface DispatchLine {
  id: string;
  productId: string;
  quantity: number;
  receivedQty: number | null;
  missingQty: number;
  damagedQty: number;
  note?: string;
  resolution?: { action: "RETURN" | "WRITE_OFF"; by: string; at: string; note?: string } | null;
}

export type RestockStatus = "DRAFT" | "WAITING_STAFF_APPROVAL" | "SENT" | "APPROVED" | "REJECTED" | "DISPATCHED";
export interface RestockLine {
  id: string;
  productId: string;
  quantity: number;
  suggestedQty: number | null;
  lineStatus: "PENDING" | "APPROVED" | "SKIPPED";
}

export type ReturnType = "RETURN_TO_STOREROOM" | "DAMAGED" | "SUPPLIER_RETURN";
export type EntryStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface SaleItem {
  productId: string;
  barcode: string;
  quantity: number;
}
export interface LabelItem {
  productId: string;
  count: number;
}

export const MOVEMENT_TYPES = [
  "RECEIPT",
  "DISPATCH_OUT",
  "DISPATCH_IN",
  "SALE",
  "RETURN_OUT",
  "RETURN_IN",
  "DAMAGE",
  "SUPPLIER_RETURN",
  "ADJUSTMENT",
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];
