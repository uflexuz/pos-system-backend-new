-- SMS module: templates and messages tables

CREATE TABLE IF NOT EXISTS "sms_templates" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "variables" JSONB NOT NULL DEFAULT '[]',
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sms_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sms_templates_name_key"
  ON "sms_templates" ("name");

CREATE INDEX IF NOT EXISTS "sms_templates_is_active_idx"
  ON "sms_templates" ("is_active");


CREATE TABLE IF NOT EXISTS "sms_messages" (
  "id" TEXT NOT NULL,
  "template_id" TEXT,
  "recipient_customer_id" TEXT,
  "recipient_phone" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "variables" JSONB NOT NULL DEFAULT '{}',
  "eskiz_message_id" TEXT,
  "eskiz_status_raw" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "category" TEXT NOT NULL DEFAULT 'manual',
  "parts_count" INTEGER,
  "cost" DECIMAL,
  "error_message" TEXT,
  "sender_admin_id" TEXT,
  "sent_at" TIMESTAMPTZ,
  "status_checked_at" TIMESTAMPTZ,
  "delivered_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sms_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sms_messages_template_id_fkey"
    FOREIGN KEY ("template_id") REFERENCES "sms_templates" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "sms_messages_recipient_customer_id_fkey"
    FOREIGN KEY ("recipient_customer_id") REFERENCES "customers" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "sms_messages_eskiz_message_id_key"
  ON "sms_messages" ("eskiz_message_id");

CREATE INDEX IF NOT EXISTS "sms_messages_status_idx"
  ON "sms_messages" ("status");

CREATE INDEX IF NOT EXISTS "sms_messages_category_idx"
  ON "sms_messages" ("category");

CREATE INDEX IF NOT EXISTS "sms_messages_recipient_phone_idx"
  ON "sms_messages" ("recipient_phone");

CREATE INDEX IF NOT EXISTS "sms_messages_recipient_customer_id_idx"
  ON "sms_messages" ("recipient_customer_id");

CREATE INDEX IF NOT EXISTS "sms_messages_sender_admin_id_idx"
  ON "sms_messages" ("sender_admin_id");

CREATE INDEX IF NOT EXISTS "sms_messages_template_id_idx"
  ON "sms_messages" ("template_id");

CREATE INDEX IF NOT EXISTS "sms_messages_created_at_idx"
  ON "sms_messages" ("created_at");
