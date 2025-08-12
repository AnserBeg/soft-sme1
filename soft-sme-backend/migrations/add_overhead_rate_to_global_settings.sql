-- Add overhead rate to global_settings table
INSERT INTO global_settings (key, value) VALUES ('overhead_rate', '50.00') ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE global_settings IS 'Global settings table for system configuration values'; 