ALTER TABLE "sms_messages"
  ADD COLUMN IF NOT EXISTS "eskiz_status_data" JSONB;
