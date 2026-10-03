ALTER TABLE "tenants" ADD COLUMN "low_stock_email" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "low_stock_email_sent_on" text;