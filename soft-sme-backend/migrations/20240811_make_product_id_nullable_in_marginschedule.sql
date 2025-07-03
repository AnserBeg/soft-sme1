-- Migration: Make product_id nullable in marginschedule
ALTER TABLE marginschedule ALTER COLUMN product_id DROP NOT NULL; 