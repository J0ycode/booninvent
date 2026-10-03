import "server-only";
import { Schema, model, models, type Model, type Types } from "mongoose";

/*
 * Stock models. ONLY src/server/stock may import this file (ESLint enforced).
 * stockMovements is append-only: nothing may update or delete a movement.
 */

const ObjectId = Schema.Types.ObjectId;

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

export interface StockLevelDoc {
  tenantId: Types.ObjectId;
  productId: Types.ObjectId;
  locationId: Types.ObjectId;
  quantity: number;
  updatedAt: Date;
}
const stockLevelSchema = new Schema<StockLevelDoc>(
  {
    tenantId: { type: ObjectId, required: true },
    productId: { type: ObjectId, required: true },
    locationId: { type: ObjectId, required: true },
    quantity: { type: Number, required: true, min: 0, default: 0 },
  },
  { timestamps: true },
);
stockLevelSchema.index({ tenantId: 1, productId: 1, locationId: 1 }, { unique: true });
stockLevelSchema.index({ tenantId: 1, locationId: 1, quantity: 1 });

export interface StockMovementDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  productId: Types.ObjectId;
  locationId: Types.ObjectId;
  type: MovementType;
  quantityDelta: number;
  balanceAfter: number;
  refType: string;
  refId: string;
  userId: Types.ObjectId | null;
  note?: string;
  createdAt: Date;
}
const stockMovementSchema = new Schema<StockMovementDoc>({
  tenantId: { type: ObjectId, required: true },
  productId: { type: ObjectId, required: true },
  locationId: { type: ObjectId, required: true },
  type: { type: String, enum: MOVEMENT_TYPES, required: true },
  quantityDelta: { type: Number, required: true },
  balanceAfter: { type: Number, required: true },
  refType: { type: String, required: true },
  refId: { type: String, required: true },
  userId: { type: ObjectId, default: null },
  note: String,
  createdAt: { type: Date, default: Date.now },
});
stockMovementSchema.index({ tenantId: 1, productId: 1, locationId: 1, createdAt: -1 });
stockMovementSchema.index({ tenantId: 1, createdAt: -1 });

// Block edits/deletes on the ledger at the model level.
for (const op of [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
  "replaceOne",
] as const) {
  stockMovementSchema.pre(op, function () {
    throw new Error("stockMovements is append-only");
  });
}

export const StockLevel =
  (models.StockLevel as Model<StockLevelDoc>) ?? model<StockLevelDoc>("StockLevel", stockLevelSchema);
export const StockMovement =
  (models.StockMovement as Model<StockMovementDoc>) ??
  model<StockMovementDoc>("StockMovement", stockMovementSchema);
