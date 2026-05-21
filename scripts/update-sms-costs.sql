-- SQL script to update cost for existing SMS messages
-- Run this in your PostgreSQL database:

-- Update messages with null or 0 cost
-- Calculate parts_count from body length (70 chars per part for Cyrillic)
-- Then set cost = parts_count * 115

UPDATE sms_messages
SET 
    parts_count = GREATEST(1, CEIL(LENGTH(body) / 70.0)),
    cost = GREATEST(1, CEIL(LENGTH(body) / 70.0)) * 115
WHERE cost IS NULL OR cost = 0;

-- Also update messages that have parts_count but no cost
UPDATE sms_messages
SET 
    cost = parts_count * 115
WHERE (cost IS NULL OR cost = 0) AND parts_count IS NOT NULL;
