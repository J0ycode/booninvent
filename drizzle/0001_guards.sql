-- The stock ledger is append-only: no UPDATE, and DELETE only when a maintenance script opts in for one transaction
-- (SET LOCAL app.allow_ledger_delete = 'on'; used by the demo seed to wipe demo shops).
CREATE OR REPLACE FUNCTION stock_movements_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.allow_ledger_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'stock_movements is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER stock_movements_no_update_delete
  BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION stock_movements_append_only();
--> statement-breakpoint
-- Supabase exposes the public schema through its REST API. Row-level security with no policies blocks that API
-- completely; the app connects as the table owner, which is not subject to RLS.
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "auth_tokens" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bills" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "counters" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "dispatches" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "label_print_logs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "locations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "login_attempts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "product_costs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "receipts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "restock_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "return_damage_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sales" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "stock_levels" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;
