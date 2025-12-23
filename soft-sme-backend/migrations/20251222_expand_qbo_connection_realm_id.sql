-- Expand QBO realm_id to store encrypted payloads
ALTER TABLE qbo_connection
  ALTER COLUMN realm_id TYPE TEXT;
