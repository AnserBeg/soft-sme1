const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/soft_sme_db'
});

async function fixAllMissingColumns() {
  const client = await pool.connect();
  try {
    console.log('🔧 Starting comprehensive database migration...\n');
    
    await client.query('BEGIN');

    // 1. Create user_profile_access table
    console.log('1. Creating user_profile_access table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_profile_access (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        granted_by INTEGER REFERENCES users(id),
        granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, profile_id)
      )
    `);
    
    // Create indexes for user_profile_access
    await client.query('CREATE INDEX IF NOT EXISTS idx_user_profile_access_user_id ON user_profile_access(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_user_profile_access_profile_id ON user_profile_access(profile_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_user_profile_access_active ON user_profile_access(is_active)');
    console.log('   ✅ user_profile_access table created with indexes');

    // 2. Add QBO export fields to purchasehistory
    console.log('\n2. Adding QBO export fields to purchasehistory...');
    await client.query(`
      ALTER TABLE purchasehistory 
      ADD COLUMN IF NOT EXISTS exported_to_qbo BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS qbo_exported_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS qbo_export_status TEXT
    `);
    console.log('   ✅ QBO export fields added to purchasehistory');

    // 3. Add GST rate to purchasehistory
    console.log('\n3. Adding GST rate to purchasehistory...');
    await client.query(`
      ALTER TABLE purchasehistory 
      ADD COLUMN IF NOT EXISTS gst_rate DECIMAL(5,2) DEFAULT 0.00
    `);
    console.log('   ✅ GST rate field added to purchasehistory');

    // 4. Add website to business_profile
    console.log('\n4. Adding website to business_profile...');
    await client.query(`
      ALTER TABLE business_profile 
      ADD COLUMN IF NOT EXISTS website VARCHAR(255)
    `);
    console.log('   ✅ Website field added to business_profile');

    // 5. Add postal_code to business_profile (if not exists)
    console.log('\n5. Adding postal_code to business_profile...');
    await client.query(`
      ALTER TABLE business_profile 
      ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20)
    `);
    console.log('   ✅ Postal code field added to business_profile');

    // 6. Add QBO export fields to salesorderhistory (if needed)
    console.log('\n6. Adding QBO export fields to salesorderhistory...');
    await client.query(`
      ALTER TABLE salesorderhistory 
      ADD COLUMN IF NOT EXISTS exported_to_qbo BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS qbo_exported_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS qbo_export_status TEXT
    `);
    console.log('   ✅ QBO export fields added to salesorderhistory');

    // 7. Add QBO export fields to purchase_orders (if table exists)
    console.log('\n7. Adding QBO export fields to purchase_orders...');
    try {
      await client.query(`
        ALTER TABLE purchase_orders 
        ADD COLUMN IF NOT EXISTS exported_to_qbo BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS qbo_exported_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS qbo_export_status TEXT
      `);
      console.log('   ✅ QBO export fields added to purchase_orders');
    } catch (error) {
      console.log('   ⚠️  purchase_orders table not found, skipping...');
    }

    // 8. Add QBO export fields to quotes (if table exists)
    console.log('\n8. Adding QBO export fields to quotes...');
    try {
      await client.query(`
        ALTER TABLE quotes 
        ADD COLUMN IF NOT EXISTS exported_to_qbo BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS qbo_exported_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS qbo_export_status TEXT
      `);
      console.log('   ✅ QBO export fields added to quotes');
    } catch (error) {
      console.log('   ⚠️  quotes table not found, skipping...');
    }

    // 9. Add QBO export fields to salesorderhistory (if table exists)
    console.log('\n9. Adding QBO export fields to salesorderhistory...');
    try {
      await client.query(`
        ALTER TABLE salesorderhistory 
        ADD COLUMN IF NOT EXISTS exported_to_qbo BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS qbo_exported_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS qbo_export_status TEXT
      `);
      console.log('   ✅ QBO export fields added to salesorderhistory');
    } catch (error) {
      console.log('   ⚠️  salesorderhistory table not found, skipping...');
    }

    // 10. Add overhead rate to global_settings (if table exists)
    console.log('\n10. Adding overhead rate to global_settings...');
    try {
      await client.query(`
        ALTER TABLE global_settings 
        ADD COLUMN IF NOT EXISTS overhead_rate DECIMAL(5,2) DEFAULT 0.00
      `);
      console.log('   ✅ Overhead rate field added to global_settings');
    } catch (error) {
      console.log('   ⚠️  global_settings table not found, skipping...');
    }

    // 11. Add sequence number fields to quotes and sales orders
    console.log('\n11. Adding sequence number fields...');
    try {
      await client.query(`
        ALTER TABLE quotes 
        ADD COLUMN IF NOT EXISTS sequence_number INTEGER
      `);
      console.log('   ✅ Sequence number added to quotes');
    } catch (error) {
      console.log('   ⚠️  quotes table not found, skipping...');
    }

    try {
      await client.query(`
        ALTER TABLE salesorderhistory 
        ADD COLUMN IF NOT EXISTS sequence_number INTEGER
      `);
      console.log('   ✅ Sequence number added to salesorderhistory');
    } catch (error) {
      console.log('   ⚠️  salesorderhistory table not found, skipping...');
    }

    // 12. Add customer PO and VIN fields
    console.log('\n12. Adding customer PO and VIN fields...');
    try {
      await client.query(`
        ALTER TABLE quotes 
        ADD COLUMN IF NOT EXISTS customer_po VARCHAR(255),
        ADD COLUMN IF NOT EXISTS vin VARCHAR(255)
      `);
      console.log('   ✅ Customer PO and VIN added to quotes');
    } catch (error) {
      console.log('   ⚠️  quotes table not found, skipping...');
    }

    try {
      await client.query(`
        ALTER TABLE salesorderhistory 
        ADD COLUMN IF NOT EXISTS customer_po VARCHAR(255),
        ADD COLUMN IF NOT EXISTS vin VARCHAR(255)
      `);
      console.log('   ✅ Customer PO and VIN added to salesorderhistory');
    } catch (error) {
      console.log('   ⚠️  salesorderhistory table not found, skipping...');
    }

    // 13. Add quote_id to salesorderhistory
    console.log('\n13. Adding quote_id to salesorderhistory...');
    try {
      await client.query(`
        ALTER TABLE salesorderhistory 
        ADD COLUMN IF NOT EXISTS quote_id INTEGER REFERENCES quotes(id)
      `);
      console.log('   ✅ Quote ID added to salesorderhistory');
    } catch (error) {
      console.log('   ⚠️  salesorderhistory or quotes table not found, skipping...');
    }

    // 14. Add terms fields
    console.log('\n14. Adding terms fields...');
    try {
      await client.query(`
        ALTER TABLE quotes 
        ADD COLUMN IF NOT EXISTS terms TEXT
      `);
      console.log('   ✅ Terms added to quotes');
    } catch (error) {
      console.log('   ⚠️  quotes table not found, skipping...');
    }

    try {
      await client.query(`
        ALTER TABLE salesorderhistory 
        ADD COLUMN IF NOT EXISTS terms TEXT
      `);
      console.log('   ✅ Terms added to salesorderhistory');
    } catch (error) {
      console.log('   ⚠️  salesorderhistory table not found, skipping...');
    }

    // 15. Add quantity to order field
    console.log('\n15. Adding quantity to order field...');
    try {
      await client.query(`
        ALTER TABLE salesorderlineitems 
        ADD COLUMN IF NOT EXISTS quantity_to_order DECIMAL(10,2) DEFAULT 0
      `);
      console.log('   ✅ Quantity to order added to salesorderlineitems');
    } catch (error) {
      console.log('   ⚠️  salesorderlineitems table not found, skipping...');
    }

    await client.query('COMMIT');
    console.log('\n🎉 All migrations completed successfully!');
    console.log('\n📋 Summary of changes:');
    console.log('   ✅ Created user_profile_access table');
    console.log('   ✅ Added QBO export fields to purchasehistory');
    console.log('   ✅ Added GST rate to purchasehistory');
    console.log('   ✅ Added website to business_profile');
    console.log('   ✅ Added postal_code to business_profile');
    console.log('   ✅ Added various QBO export fields to other tables');
    console.log('   ✅ Added sequence numbers, customer PO, VIN, terms fields');
    console.log('   ✅ Added quantity to order field');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the migration
fixAllMissingColumns()
  .then(() => {
    console.log('\n✅ Migration completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Migration failed:', error);
    process.exit(1);
  }); 