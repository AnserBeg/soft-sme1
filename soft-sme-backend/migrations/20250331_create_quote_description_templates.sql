CREATE TABLE IF NOT EXISTS quote_description_templates (
    template_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_quote_description_templates_name
    ON quote_description_templates ((LOWER(name)));

CREATE OR REPLACE FUNCTION update_quote_description_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_quote_description_templates_updated_at ON quote_description_templates;

CREATE TRIGGER trg_quote_description_templates_updated_at
BEFORE UPDATE ON quote_description_templates
FOR EACH ROW
EXECUTE FUNCTION update_quote_description_templates_updated_at();
