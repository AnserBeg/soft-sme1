-- Create contact tables for vendors and customers, allowing multiple entries with a single preferred per category

-- Vendors: contact people
CREATE TABLE IF NOT EXISTS vendor_contact_people (
  id SERIAL PRIMARY KEY,
  vendor_id INTEGER NOT NULL REFERENCES vendormaster(vendor_id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  is_preferred BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_vendor_contact_people_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_vendor_contact_people_updated_at ON vendor_contact_people;
CREATE TRIGGER trg_update_vendor_contact_people_updated_at
BEFORE UPDATE ON vendor_contact_people
FOR EACH ROW EXECUTE FUNCTION update_vendor_contact_people_updated_at();

-- Ensure only one preferred per vendor
CREATE UNIQUE INDEX IF NOT EXISTS ux_vendor_contact_people_preferred
ON vendor_contact_people (vendor_id)
WHERE is_preferred = TRUE;

-- Vendors: emails
CREATE TABLE IF NOT EXISTS vendor_emails (
  id SERIAL PRIMARY KEY,
  vendor_id INTEGER NOT NULL REFERENCES vendormaster(vendor_id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  is_preferred BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_vendor_email UNIQUE (vendor_id, email)
);

CREATE OR REPLACE FUNCTION update_vendor_emails_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_vendor_emails_updated_at ON vendor_emails;
CREATE TRIGGER trg_update_vendor_emails_updated_at
BEFORE UPDATE ON vendor_emails
FOR EACH ROW EXECUTE FUNCTION update_vendor_emails_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS ux_vendor_emails_preferred
ON vendor_emails (vendor_id)
WHERE is_preferred = TRUE;

-- Vendors: phones
CREATE TABLE IF NOT EXISTS vendor_phones (
  id SERIAL PRIMARY KEY,
  vendor_id INTEGER NOT NULL REFERENCES vendormaster(vendor_id) ON DELETE CASCADE,
  phone VARCHAR(50) NOT NULL,
  label VARCHAR(50),
  is_preferred BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_vendor_phone UNIQUE (vendor_id, phone)
);

CREATE OR REPLACE FUNCTION update_vendor_phones_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_vendor_phones_updated_at ON vendor_phones;
CREATE TRIGGER trg_update_vendor_phones_updated_at
BEFORE UPDATE ON vendor_phones
FOR EACH ROW EXECUTE FUNCTION update_vendor_phones_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS ux_vendor_phones_preferred
ON vendor_phones (vendor_id)
WHERE is_preferred = TRUE;

-- Customers: contact people
CREATE TABLE IF NOT EXISTS customer_contact_people (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customermaster(customer_id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  is_preferred BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_customer_contact_people_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_customer_contact_people_updated_at ON customer_contact_people;
CREATE TRIGGER trg_update_customer_contact_people_updated_at
BEFORE UPDATE ON customer_contact_people
FOR EACH ROW EXECUTE FUNCTION update_customer_contact_people_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS ux_customer_contact_people_preferred
ON customer_contact_people (customer_id)
WHERE is_preferred = TRUE;

-- Customers: emails
CREATE TABLE IF NOT EXISTS customer_emails (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customermaster(customer_id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  is_preferred BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_customer_email UNIQUE (customer_id, email)
);

CREATE OR REPLACE FUNCTION update_customer_emails_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_customer_emails_updated_at ON customer_emails;
CREATE TRIGGER trg_update_customer_emails_updated_at
BEFORE UPDATE ON customer_emails
FOR EACH ROW EXECUTE FUNCTION update_customer_emails_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS ux_customer_emails_preferred
ON customer_emails (customer_id)
WHERE is_preferred = TRUE;

-- Customers: phones
CREATE TABLE IF NOT EXISTS customer_phones (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customermaster(customer_id) ON DELETE CASCADE,
  phone VARCHAR(50) NOT NULL,
  label VARCHAR(50),
  is_preferred BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_customer_phone UNIQUE (customer_id, phone)
);

CREATE OR REPLACE FUNCTION update_customer_phones_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_customer_phones_updated_at ON customer_phones;
CREATE TRIGGER trg_update_customer_phones_updated_at
BEFORE UPDATE ON customer_phones
FOR EACH ROW EXECUTE FUNCTION update_customer_phones_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS ux_customer_phones_preferred
ON customer_phones (customer_id)
WHERE is_preferred = TRUE;

-- Backfill from existing single-value fields as preferred entries
INSERT INTO vendor_contact_people (vendor_id, name, is_preferred)
SELECT vendor_id, contact_person, TRUE FROM vendormaster WHERE contact_person IS NOT NULL AND contact_person <> ''
ON CONFLICT DO NOTHING;

INSERT INTO vendor_emails (vendor_id, email, is_preferred)
SELECT vendor_id, email, TRUE FROM vendormaster WHERE email IS NOT NULL AND email <> ''
ON CONFLICT DO NOTHING;

INSERT INTO vendor_phones (vendor_id, phone, label, is_preferred)
SELECT vendor_id, telephone_number, 'Primary', TRUE FROM vendormaster WHERE telephone_number IS NOT NULL AND telephone_number <> ''
ON CONFLICT DO NOTHING;

INSERT INTO customer_contact_people (customer_id, name, is_preferred)
SELECT customer_id, contact_person, TRUE FROM customermaster WHERE contact_person IS NOT NULL AND contact_person <> ''
ON CONFLICT DO NOTHING;

INSERT INTO customer_emails (customer_id, email, is_preferred)
SELECT customer_id, email, TRUE FROM customermaster WHERE email IS NOT NULL AND email <> ''
ON CONFLICT DO NOTHING;

INSERT INTO customer_phones (customer_id, phone, label, is_preferred)
SELECT customer_id, telephone_number, 'Primary', TRUE FROM customermaster WHERE telephone_number IS NOT NULL AND telephone_number <> ''
ON CONFLICT DO NOTHING;


