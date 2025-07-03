-- Migration: Add postal_code to customermaster
ALTER TABLE customermaster ADD COLUMN postal_code VARCHAR(20);