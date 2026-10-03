export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "INSUFFICIENT_STOCK"
  | "TENANT_SUSPENDED"
  | "RATE_LIMITED"
  | "INVALID_STATE"
  | "UNKNOWN_BARCODE"
  | "INVALID_LOCATION";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
  INSUFFICIENT_STOCK: 409,
  TENANT_SUSPENDED: 423,
  RATE_LIMITED: 429,
  INVALID_STATE: 409,
  UNKNOWN_BARCODE: 422,
  INVALID_LOCATION: 422,
};

/** An error whose message is safe and friendly enough to show to the user. */
export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
  get status() {
    return STATUS[this.code];
  }
}

/** Postgres error details, unwrapping the driver/ORM wrapper if there is one. */
function pgError(e: unknown): { code?: string; constraint?: string } | null {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    const o = cur as { code?: unknown; constraint?: unknown; constraint_name?: unknown; cause?: unknown };
    if (typeof o.code === "string" && /^[0-9A-Z]{5}$/.test(o.code)) {
      return { code: o.code, constraint: (o.constraint_name ?? o.constraint) as string | undefined };
    }
    cur = o.cause;
  }
  return null;
}

/** Unique-constraint violation (Postgres 23505). */
export const isDuplicateKey = (e: unknown): boolean => pgError(e)?.code === "23505";

/** Name of the violated unique constraint/index, e.g. "products_tenant_barcode_uq". */
export const duplicateConstraint = (e: unknown): string => (isDuplicateKey(e) ? (pgError(e)?.constraint ?? "") : "");
