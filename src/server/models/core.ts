import "server-only";
import { Schema, model, models, type Model, type Types } from "mongoose";
import { ROLES, type Role } from "@/lib/roles";

const ObjectId = Schema.Types.ObjectId;

function getModel<T>(name: string, schema: Schema<T>): Model<T> {
  return (models[name] as Model<T>) ?? model<T>(name, schema);
}

/* ---------- tenants ---------- */
export interface TenantDoc {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  status: "ACTIVE" | "SUSPENDED";
  company: { address?: string; phone?: string; email?: string; gstin?: string };
  createdAt: Date;
}
const tenantSchema = new Schema<TenantDoc>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },
    status: { type: String, enum: ["ACTIVE", "SUSPENDED"], default: "ACTIVE" },
    company: {
      address: String,
      phone: String,
      email: String,
      gstin: String,
    },
  },
  { timestamps: true },
);
export const Tenant = getModel("Tenant", tenantSchema);

/* ---------- locations ---------- */
export type LocationType = "STORE_ROOM" | "STORE";
export interface LocationDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  name: string;
  type: LocationType;
  active: boolean;
}
const locationSchema = new Schema<LocationDoc>(
  {
    tenantId: { type: ObjectId, required: true, index: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ["STORE_ROOM", "STORE"], required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
locationSchema.index({ tenantId: 1, name: 1 }, { unique: true });
export const Location = getModel("Location", locationSchema);

/* ---------- users ---------- */
export interface UserDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId | null;
  email: string;
  name: string;
  passwordHash: string | null;
  role: Role;
  locationIds: Types.ObjectId[];
  active: boolean;
  sessionVersion: number;
  lastLoginAt?: Date;
  createdAt: Date;
}
const userSchema = new Schema<UserDoc>(
  {
    tenantId: { type: ObjectId, default: null, index: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, default: null },
    role: { type: String, enum: ROLES, required: true },
    locationIds: [{ type: ObjectId }],
    active: { type: Boolean, default: true },
    sessionVersion: { type: Number, default: 1 },
    lastLoginAt: Date,
  },
  { timestamps: true },
);
export const User = getModel("User", userSchema);

/* ---------- auth tokens (invite + password reset) ---------- */
export interface AuthTokenDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: "INVITE" | "RESET";
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}
const authTokenSchema = new Schema<AuthTokenDoc>({
  userId: { type: ObjectId, required: true, index: true },
  type: { type: String, enum: ["INVITE", "RESET"], required: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true, expires: 0 },
  usedAt: { type: Date, default: null },
});
export const AuthToken = getModel("AuthToken", authTokenSchema);

/* ---------- login rate limiting ---------- */
export interface LoginAttemptDoc {
  key: string;
  count: number;
  expiresAt: Date;
}
const loginAttemptSchema = new Schema<LoginAttemptDoc>({
  key: { type: String, required: true, unique: true },
  count: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true, expires: 0 },
});
export const LoginAttempt = getModel("LoginAttempt", loginAttemptSchema);

/* ---------- counters (barcodes, document numbers) ---------- */
export interface CounterDoc {
  tenantId: Types.ObjectId;
  name: string;
  seq: number;
}
const counterSchema = new Schema<CounterDoc>({
  tenantId: { type: ObjectId, required: true },
  name: { type: String, required: true },
  seq: { type: Number, default: 0 },
});
counterSchema.index({ tenantId: 1, name: 1 }, { unique: true });
export const Counter = getModel("Counter", counterSchema);

/* ---------- idempotency keys ---------- */
export interface IdempotencyDoc {
  scope: string;
  key: string;
  result: unknown;
  createdAt: Date;
}
const idempotencySchema = new Schema<IdempotencyDoc>({
  scope: { type: String, required: true },
  key: { type: String, required: true },
  result: { type: Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 },
});
idempotencySchema.index({ scope: 1, key: 1 }, { unique: true });
export const IdempotencyKey = getModel("IdempotencyKey", idempotencySchema);

/* ---------- audit log ---------- */
export interface AuditDoc {
  tenantId: Types.ObjectId | null;
  userId: Types.ObjectId | null;
  action: string;
  entity: string;
  entityId?: string;
  data?: unknown;
  createdAt: Date;
}
const auditSchema = new Schema<AuditDoc>({
  tenantId: { type: ObjectId, default: null },
  userId: { type: ObjectId, default: null },
  action: { type: String, required: true },
  entity: { type: String, required: true },
  entityId: String,
  data: Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now },
});
auditSchema.index({ tenantId: 1, createdAt: -1 });
export const AuditLog = getModel("AuditLog", auditSchema);

/* ---------- api keys ---------- */
export interface ApiKeyDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  prefix: string;
  keyHash: string;
  createdBy: Types.ObjectId;
  revokedAt: Date | null;
  lastUsedAt?: Date;
  createdAt: Date;
}
const apiKeySchema = new Schema<ApiKeyDoc>(
  {
    tenantId: { type: ObjectId, required: true, index: true },
    prefix: { type: String, required: true },
    keyHash: { type: String, required: true, unique: true },
    createdBy: { type: ObjectId, required: true },
    revokedAt: { type: Date, default: null },
    lastUsedAt: Date,
  },
  { timestamps: true },
);
export const ApiKey = getModel("ApiKey", apiKeySchema);
