-- Multi-company support: add company_id to business tables and scope key uniques per company
DO $$
DECLARE
  default_company_id INTEGER;
  tbl TEXT;
  tables_to_tag CONSTANT TEXT[] := ARRAY[
    'business_profile',
    'labourrate',
    'global_settings',
    'customermaster',
    'customer_contact_people',
    'customer_emails',
    'customer_phones',
    'vendormaster',
    'vendor_contact_people',
    'vendor_emails',
    'vendor_phones',
    'profiles',
    'profile_documents',
    'profile_document_reads',
    'document_profile_visibility',
    'products',
    'part_categories',
    'part_usage_global',
    'inventory',
    'inventory_audit_log',
    'inventory_vendors',
    'aggregated_parts_to_order',
    'purchasehistory',
    'purchaselineitems',
    'purchase_order_allocations',
    'return_orders',
    'return_order_line_items',
    'quotes',
    'quote_description_templates',
    'salesorderhistory',
    'salesorderlineitems',
    'sales_order_parts_to_order',
    'sales_order_part_prefs',
    'labour_line_items',
    'time_entries',
    'time_entries_backup',
    'attendance_shifts',
    'attendance_shifts_backup',
    'leave_requests',
    'vacation_days_management',
    'vacation_reset_settings',
    'invoices',
    'invoicelineitems'
  ];
  tables_existing_company CONSTANT TEXT[] := ARRAY['users'];
BEGIN
  -- Pick an existing company or create one to backfill historical rows
  SELECT id INTO default_company_id FROM companies ORDER BY id LIMIT 1;
  IF default_company_id IS NULL THEN
    INSERT INTO companies (company_name) VALUES ('Default Company') RETURNING id INTO default_company_id;
  END IF;

  -- Add company_id where missing and enforce NOT NULL + FK + index
  FOREACH tbl IN ARRAY tables_to_tag LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'company_id'
      ) THEN
        EXECUTE format('ALTER TABLE %I ADD COLUMN company_id INTEGER', tbl);
      END IF;

      EXECUTE format(
        'ALTER TABLE %I ALTER COLUMN company_id SET DEFAULT COALESCE(NULLIF(current_setting(''app.current_company'', true), '''')::INT, %s)',
        tbl,
        default_company_id
      );
      EXECUTE format('UPDATE %I SET company_id = COALESCE(company_id, %s)', tbl, default_company_id);
      EXECUTE format('ALTER TABLE %I ALTER COLUMN company_id SET NOT NULL', tbl);

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = tbl
          AND constraint_type = 'FOREIGN KEY'
          AND constraint_name = format('%s_company_id_fkey', tbl)
      ) THEN
        EXECUTE format(
          'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE',
          tbl,
          tbl || '_company_id_fkey'
        );
      END IF;

      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I(company_id)', 'idx_' || tbl || '_company_id', tbl);
    END IF;
  END LOOP;

  -- Tighten existing company columns
  FOREACH tbl IN ARRAY tables_existing_company LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'company_id'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ALTER COLUMN company_id SET DEFAULT COALESCE(NULLIF(current_setting(''app.current_company'', true), '''')::INT, %s)',
        tbl,
        default_company_id
      );
      EXECUTE format('UPDATE %I SET company_id = COALESCE(company_id, %s)', tbl, default_company_id);
      EXECUTE format('ALTER TABLE %I ALTER COLUMN company_id SET NOT NULL', tbl);

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = tbl
          AND constraint_type = 'FOREIGN KEY'
          AND constraint_name = format('%s_company_id_fkey', tbl)
      ) THEN
        EXECUTE format(
          'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE',
          tbl,
          tbl || '_company_id_fkey'
        );
      END IF;

      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I(company_id)', 'idx_' || tbl || '_company_id', tbl);
    END IF;
  END LOOP;

  -- One-per-company helpers
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'business_profile' AND column_name = 'company_id') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_schema = 'public' AND table_name = 'business_profile' AND constraint_name = 'business_profile_company_id_key'
    ) THEN
      ALTER TABLE business_profile ADD CONSTRAINT business_profile_company_id_key UNIQUE (company_id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'labourrate' AND column_name = 'company_id') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_schema = 'public' AND table_name = 'labourrate' AND constraint_name = 'labourrate_company_id_key'
    ) THEN
      ALTER TABLE labourrate ADD CONSTRAINT labourrate_company_id_key UNIQUE (company_id);
    END IF;
  END IF;

  -- Global settings should be keyed by company + key
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'global_settings' AND column_name = 'company_id') THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_schema = 'public' AND table_name = 'global_settings' AND constraint_type = 'PRIMARY KEY'
    ) THEN
      ALTER TABLE global_settings DROP CONSTRAINT global_settings_pkey;
    END IF;

    ALTER TABLE global_settings
      ADD CONSTRAINT global_settings_pkey PRIMARY KEY (company_id, key);
  END IF;

  -- Scope uniques by company
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'users' AND constraint_name = 'users_username_key') THEN
    ALTER TABLE users DROP CONSTRAINT users_username_key;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'users' AND constraint_name = 'users_email_key') THEN
    ALTER TABLE users DROP CONSTRAINT users_email_key;
  END IF;
  CREATE UNIQUE INDEX IF NOT EXISTS ux_users_company_username ON users(company_id, username);
  CREATE UNIQUE INDEX IF NOT EXISTS ux_users_company_email ON users(company_id, email);

  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'profiles' AND constraint_name = 'profiles_email_key') THEN
    ALTER TABLE profiles DROP CONSTRAINT profiles_email_key;
  END IF;
  CREATE UNIQUE INDEX IF NOT EXISTS ux_profiles_company_email ON profiles(company_id, email);

  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'products' AND constraint_name = 'products_product_name_key') THEN
    ALTER TABLE products DROP CONSTRAINT products_product_name_key;
  END IF;
  CREATE UNIQUE INDEX IF NOT EXISTS ux_products_company_name ON products(company_id, product_name);

  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'part_categories' AND constraint_name = 'part_categories_category_name_key') THEN
    ALTER TABLE part_categories DROP CONSTRAINT part_categories_category_name_key;
  END IF;
  CREATE UNIQUE INDEX IF NOT EXISTS ux_part_categories_company_name ON part_categories(company_id, category_name);

  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'aggregated_parts_to_order' AND constraint_name = 'aggregated_parts_to_order_part_number') THEN
    ALTER TABLE aggregated_parts_to_order DROP CONSTRAINT aggregated_parts_to_order_part_number;
  END IF;
  CREATE UNIQUE INDEX IF NOT EXISTS ux_aggregated_parts_company_part ON aggregated_parts_to_order(company_id, part_number);

  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'part_usage_global' AND constraint_name = 'part_usage_global_pkey') THEN
    ALTER TABLE part_usage_global DROP CONSTRAINT part_usage_global_pkey;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'part_usage_global' AND column_name = 'company_id') THEN
    ALTER TABLE part_usage_global ADD PRIMARY KEY (company_id, part_number);
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'quotes' AND constraint_name = 'quotes_quote_number_key') THEN
    ALTER TABLE quotes DROP CONSTRAINT quotes_quote_number_key;
  END IF;
  CREATE UNIQUE INDEX IF NOT EXISTS ux_quotes_company_number ON quotes(company_id, quote_number);

  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'salesorderhistory' AND constraint_name = 'salesorderhistory_sales_order_number_key') THEN
    ALTER TABLE salesorderhistory DROP CONSTRAINT salesorderhistory_sales_order_number_key;
  END IF;
  CREATE UNIQUE INDEX IF NOT EXISTS ux_sales_orders_company_number ON salesorderhistory(company_id, sales_order_number);

  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'purchasehistory' AND constraint_name = 'purchasehistory_purchase_number_key') THEN
    ALTER TABLE purchasehistory DROP CONSTRAINT purchasehistory_purchase_number_key;
  END IF;
  CREATE UNIQUE INDEX IF NOT EXISTS ux_purchase_orders_company_number ON purchasehistory(company_id, purchase_number);

  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'return_orders' AND constraint_name = 'return_orders_return_number_key') THEN
    ALTER TABLE return_orders DROP CONSTRAINT return_orders_return_number_key;
  END IF;
  CREATE UNIQUE INDEX IF NOT EXISTS ux_return_orders_company_number ON return_orders(company_id, return_number);

  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'invoices' AND constraint_name = 'invoices_invoice_number_key') THEN
    ALTER TABLE invoices DROP CONSTRAINT invoices_invoice_number_key;
  END IF;
  CREATE UNIQUE INDEX IF NOT EXISTS ux_invoices_company_number ON invoices(company_id, invoice_number);
END $$;
