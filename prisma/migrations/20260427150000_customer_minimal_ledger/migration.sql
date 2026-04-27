ALTER TABLE IF EXISTS "customers"
  ADD COLUMN IF NOT EXISTS "balance" DECIMAL NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS "customers"
  DROP COLUMN IF EXISTS "father_birth_date",
  DROP COLUMN IF EXISTS "mother_birth_date",
  DROP COLUMN IF EXISTS "son_birth_date",
  DROP COLUMN IF EXISTS "daughter_birth_date",
  DROP COLUMN IF EXISTS "spouse_birth_date",
  DROP COLUMN IF EXISTS "older_brother_birth_date",
  DROP COLUMN IF EXISTS "younger_brother_birth_date",
  DROP COLUMN IF EXISTS "older_sister_birth_date",
  DROP COLUMN IF EXISTS "younger_sister_birth_date",
  DROP COLUMN IF EXISTS "favorite_hadya_item",
  DROP COLUMN IF EXISTS "follows_hadya_social",
  DROP COLUMN IF EXISTS "shortcomings",
  DROP COLUMN IF EXISTS "is_active",
  DROP COLUMN IF EXISTS "custom_attributes";

DO $$
BEGIN
  IF to_regclass('public.customers') IS NOT NULL
    AND to_regclass('public.customer_ledger_transactions') IS NULL
  THEN
    CREATE TABLE "customer_ledger_transactions" (
      "id" TEXT NOT NULL,
      "customer_id" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "amount" DECIMAL NOT NULL,
      "notes" TEXT,
      "balance_before" DECIMAL NOT NULL DEFAULT 0,
      "balance_after" DECIMAL NOT NULL DEFAULT 0,
      "transaction_date" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CONSTRAINT "customer_ledger_transactions_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "customer_ledger_transactions_customer_id_fkey"
        FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.customer_ledger_transactions') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "customer_ledger_transactions_customer_id_idx"
      ON "customer_ledger_transactions"("customer_id");

    CREATE INDEX IF NOT EXISTS "customer_ledger_transactions_transaction_date_idx"
      ON "customer_ledger_transactions"("transaction_date");
  END IF;
END $$;
