-- Migration: Add 'terms' column to quotes table for terms and conditions
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS terms TEXT; 