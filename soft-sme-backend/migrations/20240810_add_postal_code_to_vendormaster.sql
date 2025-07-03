-- Migration: Add postal_code to vendormaster
ALTER TABLE vendormaster ADD COLUMN postal_code VARCHAR(20); 