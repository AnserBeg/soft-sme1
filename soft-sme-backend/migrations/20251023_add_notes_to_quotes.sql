-- Migration: Add 'notes' column to quotes table for internal notes and additional context
ALTER TABLE quotes
    ADD COLUMN IF NOT EXISTS notes TEXT;
