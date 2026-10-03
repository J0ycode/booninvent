import "server-only";
import { Schema, model, models, type Model, type Types } from "mongoose";

const ObjectId = Schema.Types.ObjectId;

function getModel<T>(name: string, schema: Schema<T>): Model<T> {
  return (models[name] as Model<T>) ?? model<T>(name, schema);
}

/* ---------- suppliers ---------- */
export interface SupplierDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  name: string;
  phone?: string;
  email?: string;
  gstin?: string;
  address?: string;
  active: boolean;
}
const supplierSchema = new Schema<SupplierDoc>(
  {
    tenantId: { type: ObjectId, required: true, index: true },
    name: { type: String, required: true, trim: true },
    phone: String,
    email: String,
    gstin: String,
    address: String,
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
supplierSchema.index({ tenantId: 1, name: 1 }, { unique: true });
export const Supplier = getModel("Supplier", supplierSchema);

/* ---------- products ---------- */
export type Category = "CLOTHING" | "ACCESSORY";
export interface ProductDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  name: string;
  nameLower: string;
  category: Category;
  sku: string;
  barcode: string;
  sellingPrice: number; // paise
  supplierId: Types.ObjectId | null;
  reorderLevel: number;
  active: boolean;
  createdAt: Date;
}
const productSchema = new Schema<ProductDoc>(
  {
    tenantId: { type: ObjectId, required: true, index: true },
    name: { type: String, required: true, trim: true },
    nameLower: { type: String, required: true },
    category: { type: String, enum: ["CLOTHING", "ACCESSORY"], required: true },
    sku: { type: String, required: true, trim: true },
    barcode: { type: String, required: true, trim: true },
    sellingPrice: { type: Number, required: true, min: 0 },
    supplierId: { type: ObjectId, default: null },
    reorderLevel: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
productSchema.index({ tenantId: 1, barcode: 1 }, { unique: true });
productSchema.index({ tenantId: 1, sku: 1 }, { unique: true });
productSchema.index({ tenantId: 1, nameLower: 1 });
productSchema.index({ name: "text", sku: "text" });
productSchema.pre("validate", function () {
  if (this.name) this.nameLower = this.name.toLowerCase();
});
export const Product = getModel("Product", productSchema);

/* ---------- product costs (OWNER / STOREROOM_MANAGER only) ---------- */
export interface ProductCostDoc {
  tenantId: Types.ObjectId;
  productId: Types.ObjectId;
  costPrice: number; // paise
}
const productCostSchema = new Schema<ProductCostDoc>(
  {
    tenantId: { type: ObjectId, required: true, index: true },
    productId: { type: ObjectId, required: true },
    costPrice: { type: Number, required: true, min: 0 },
  },
  { timestamps: true },
);
productCostSchema.index({ tenantId: 1, productId: 1 }, { unique: true });
export const ProductCost = getModel("ProductCost", productCostSchema);

/* ---------- receipts ---------- */
export interface ReceiptLine {
  productId: Types.ObjectId;
  quantity: number;
  cost?: number | null;
}
export interface ReceiptDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  number: string;
  supplierId: Types.ObjectId;
  invoiceNumber: string;
  locationId: Types.ObjectId;
  lines: ReceiptLine[];
  note?: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
}
const receiptSchema = new Schema<ReceiptDoc>(
  {
    tenantId: { type: ObjectId, required: true, index: true },
    number: { type: String, required: true },
    supplierId: { type: ObjectId, required: true },
    invoiceNumber: { type: String, required: true, trim: true },
    locationId: { type: ObjectId, required: true },
    lines: [
      {
        _id: false,
        productId: { type: ObjectId, required: true },
        quantity: { type: Number, required: true, min: 1 },
        cost: { type: Number, default: null },
      },
    ],
    note: String,
    createdBy: { type: ObjectId, required: true },
  },
  { timestamps: true },
);
receiptSchema.index({ tenantId: 1, createdAt: -1 });
export const Receipt = getModel("Receipt", receiptSchema);

/* ---------- dispatches ---------- */
export type DispatchStatus = "DRAFT" | "DISPATCHED" | "RECEIVED" | "RECEIVED_WITH_ISSUES" | "RESOLVED";
export interface DispatchLine {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  quantity: number;
  receivedQty: number | null;
  missingQty: number;
  damagedQty: number;
  note?: string;
  resolution?: { action: "RETURN" | "WRITE_OFF"; by: Types.ObjectId; at: Date; note?: string } | null;
}
export interface DispatchDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  number: string;
  fromLocationId: Types.ObjectId;
  toLocationId: Types.ObjectId;
  status: DispatchStatus;
  lines: DispatchLine[];
  note?: string;
  restockRequestId: Types.ObjectId | null;
  createdBy: Types.ObjectId;
  dispatchedAt?: Date;
  dispatchedBy?: Types.ObjectId;
  receivedAt?: Date;
  receivedBy?: Types.ObjectId;
  createdAt: Date;
}
const dispatchSchema = new Schema<DispatchDoc>(
  {
    tenantId: { type: ObjectId, required: true, index: true },
    number: { type: String, required: true },
    fromLocationId: { type: ObjectId, required: true },
    toLocationId: { type: ObjectId, required: true },
    status: {
      type: String,
      enum: ["DRAFT", "DISPATCHED", "RECEIVED", "RECEIVED_WITH_ISSUES", "RESOLVED"],
      default: "DRAFT",
    },
    lines: [
      {
        productId: { type: ObjectId, required: true },
        quantity: { type: Number, required: true, min: 1 },
        receivedQty: { type: Number, default: null },
        missingQty: { type: Number, default: 0 },
        damagedQty: { type: Number, default: 0 },
        note: String,
        resolution: {
          type: new Schema(
            { action: { type: String, enum: ["RETURN", "WRITE_OFF"] }, by: ObjectId, at: Date, note: String },
            { _id: false },
          ),
          default: null,
        },
      },
    ],
    note: String,
    restockRequestId: { type: ObjectId, default: null },
    createdBy: { type: ObjectId, required: true },
    dispatchedAt: Date,
    dispatchedBy: ObjectId,
    receivedAt: Date,
    receivedBy: ObjectId,
  },
  { timestamps: true },
);
dispatchSchema.index({ tenantId: 1, toLocationId: 1, status: 1 });
dispatchSchema.index({ tenantId: 1, createdAt: -1 });
export const Dispatch = getModel("Dispatch", dispatchSchema);

/* ---------- restock requests ---------- */
export type RestockStatus = "DRAFT" | "WAITING_STAFF_APPROVAL" | "SENT" | "APPROVED" | "REJECTED" | "DISPATCHED";
export interface RestockLine {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  quantity: number;
  suggestedQty: number | null;
  lineStatus: "PENDING" | "APPROVED" | "SKIPPED";
}
export interface RestockDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  number: string;
  locationId: Types.ObjectId;
  source: "MANUAL" | "SUGGESTED";
  status: RestockStatus;
  lines: RestockLine[];
  note?: string;
  createdBy: Types.ObjectId;
  sentAt?: Date;
  decidedBy?: Types.ObjectId;
  decidedAt?: Date;
  rejectReason?: string;
  dispatchId: Types.ObjectId | null;
  createdAt: Date;
}
const restockSchema = new Schema<RestockDoc>(
  {
    tenantId: { type: ObjectId, required: true, index: true },
    number: { type: String, required: true },
    locationId: { type: ObjectId, required: true },
    source: { type: String, enum: ["MANUAL", "SUGGESTED"], required: true },
    status: {
      type: String,
      enum: ["DRAFT", "WAITING_STAFF_APPROVAL", "SENT", "APPROVED", "REJECTED", "DISPATCHED"],
      default: "DRAFT",
    },
    lines: [
      {
        productId: { type: ObjectId, required: true },
        quantity: { type: Number, required: true, min: 0 },
        suggestedQty: { type: Number, default: null },
        lineStatus: { type: String, enum: ["PENDING", "APPROVED", "SKIPPED"], default: "APPROVED" },
      },
    ],
    note: String,
    createdBy: { type: ObjectId, required: true },
    sentAt: Date,
    decidedBy: ObjectId,
    decidedAt: Date,
    rejectReason: String,
    dispatchId: { type: ObjectId, default: null },
  },
  { timestamps: true },
);
restockSchema.index({ tenantId: 1, locationId: 1, status: 1 });
export const RestockRequest = getModel("RestockRequest", restockSchema);

/* ---------- returns and damaged ---------- */
export type ReturnType = "RETURN_TO_STOREROOM" | "DAMAGED" | "SUPPLIER_RETURN";
export interface ReturnDamageDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  type: ReturnType;
  productId: Types.ObjectId;
  quantity: number;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdBy: Types.ObjectId;
  decidedBy?: Types.ObjectId;
  decidedAt?: Date;
  decisionNote?: string;
  createdAt: Date;
}
const returnDamageSchema = new Schema<ReturnDamageDoc>(
  {
    tenantId: { type: ObjectId, required: true, index: true },
    locationId: { type: ObjectId, required: true },
    type: { type: String, enum: ["RETURN_TO_STOREROOM", "DAMAGED", "SUPPLIER_RETURN"], required: true },
    productId: { type: ObjectId, required: true },
    quantity: { type: Number, required: true, min: 1 },
    reason: { type: String, required: true, trim: true },
    status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED"], default: "PENDING" },
    createdBy: { type: ObjectId, required: true },
    decidedBy: ObjectId,
    decidedAt: Date,
    decisionNote: String,
  },
  { timestamps: true },
);
returnDamageSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
export const ReturnDamageEntry = getModel("ReturnDamageEntry", returnDamageSchema);

/* ---------- sales (idempotency on externalRef) ---------- */
export interface SaleDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  externalRef: string;
  source: "API" | "INTERNAL";
  items: { productId: Types.ObjectId; barcode: string; quantity: number }[];
  createdAt: Date;
}
const saleSchema = new Schema<SaleDoc>(
  {
    tenantId: { type: ObjectId, required: true, index: true },
    locationId: { type: ObjectId, required: true },
    externalRef: { type: String, required: true },
    source: { type: String, enum: ["API", "INTERNAL"], required: true },
    items: [{ _id: false, productId: ObjectId, barcode: String, quantity: Number }],
  },
  { timestamps: true },
);
saleSchema.index({ tenantId: 1, externalRef: 1 }, { unique: true });
export const Sale = getModel("Sale", saleSchema);

/* ---------- bills ---------- */
export interface BillDoc {
  _id: Types.ObjectId;
  kind: "SUPPLIER" | "PLATFORM";
  tenantId: Types.ObjectId;
  supplierId: Types.ObjectId | null;
  receiptId: Types.ObjectId | null;
  billNumber: string;
  description?: string;
  billDate: Date; // bill date (supplier) or issue date (platform)
  dueDate: Date;
  amount: number; // paise
  note?: string;
  status: "UNPAID" | "PAID";
  paidDate: Date | null;
  paidBy: Types.ObjectId | null;
  paidNote?: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
}
const billSchema = new Schema<BillDoc>(
  {
    kind: { type: String, enum: ["SUPPLIER", "PLATFORM"], required: true },
    tenantId: { type: ObjectId, required: true, index: true },
    supplierId: { type: ObjectId, default: null },
    receiptId: { type: ObjectId, default: null },
    billNumber: { type: String, required: true, trim: true },
    description: String,
    billDate: { type: Date, required: true },
    dueDate: { type: Date, required: true },
    amount: { type: Number, required: true, min: 0 },
    note: String,
    status: { type: String, enum: ["UNPAID", "PAID"], default: "UNPAID" },
    paidDate: { type: Date, default: null },
    paidBy: { type: ObjectId, default: null },
    paidNote: String,
    createdBy: { type: ObjectId, required: true },
  },
  { timestamps: true },
);
billSchema.index({ tenantId: 1, kind: 1, status: 1, dueDate: 1 });
export const Bill = getModel("Bill", billSchema);

/* ---------- label print log ---------- */
export interface LabelPrintDoc {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  preset: number;
  startPosition: number;
  items: { productId: Types.ObjectId; count: number }[];
  totalLabels: number;
  createdAt: Date;
}
const labelPrintSchema = new Schema<LabelPrintDoc>(
  {
    tenantId: { type: ObjectId, required: true, index: true },
    userId: { type: ObjectId, required: true },
    preset: Number,
    startPosition: Number,
    items: [{ _id: false, productId: ObjectId, count: Number }],
    totalLabels: Number,
  },
  { timestamps: true },
);
export const LabelPrintLog = getModel("LabelPrintLog", labelPrintSchema);
