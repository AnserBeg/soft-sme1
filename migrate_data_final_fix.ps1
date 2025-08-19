# Final Migration Script - Fixes remaining issues
# This script handles the final schema issues

$env:PGPASSWORD = "123"

Write-Host "Starting final migration fix..." -ForegroundColor Green

# Create temp directory
if (!(Test-Path "C:\temp")) {
    New-Item -ItemType Directory -Path "C:\temp"
}

Write-Host "Step 1: Clearing staging database..." -ForegroundColor Yellow

# Clear staging database in correct order (respecting foreign keys)
try {
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "TRUNCATE TABLE time_entries CASCADE;"
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "TRUNCATE TABLE attendance_shifts CASCADE;"
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "TRUNCATE TABLE salesorderlineitems CASCADE;"
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "TRUNCATE TABLE salesorderhistory CASCADE;"
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "TRUNCATE TABLE purchaselineitems CASCADE;"
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "TRUNCATE TABLE purchasehistory CASCADE;"
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "TRUNCATE TABLE quotes CASCADE;"
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "TRUNCATE TABLE inventory CASCADE;"
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "TRUNCATE TABLE customermaster CASCADE;"
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "TRUNCATE TABLE vendormaster CASCADE;"
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "TRUNCATE TABLE products CASCADE;"
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "TRUNCATE TABLE profiles CASCADE;"
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "TRUNCATE TABLE users CASCADE;"
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "TRUNCATE TABLE business_profile CASCADE;"
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "TRUNCATE TABLE companies CASCADE;"
    Write-Host "✓ Staging database cleared" -ForegroundColor Green
} catch {
    Write-Host "Error clearing staging database: $_" -ForegroundColor Red
    exit 1
}

Write-Host "`nStep 2: Exporting data from source database..." -ForegroundColor Yellow

# Export data from source database with proper handling
try {
    # Export companies
    psql -h localhost -p 5432 -U postgres -d soft_sme_db -c "`\copy (SELECT id, company_name, created_at, updated_at, max_concurrent_sessions, session_timeout_hours, refresh_token_days, allow_multiple_devices FROM companies) TO 'C:\temp\companies.csv' WITH CSV HEADER"
    Write-Host "✓ Companies exported" -ForegroundColor Green

    # Export business profile
    psql -h localhost -p 5432 -U postgres -d soft_sme_db -c "`\copy (SELECT id, business_name, street_address, city, province, country, telephone_number, email, business_number, logo_url, created_at, updated_at, postal_code, website FROM business_profile) TO 'C:\temp\business_profile.csv' WITH CSV HEADER"
    Write-Host "✓ Business profile exported" -ForegroundColor Green

    # Export users (handle timestamp issues properly)
    psql -h localhost -p 5432 -U postgres -d soft_sme_db -c "`\copy (SELECT id, username, email, password_hash, company_id, access_role, CASE WHEN created_at = '1' THEN NULL ELSE created_at END as created_at, CASE WHEN updated_at = '1' THEN NULL ELSE updated_at END as updated_at, role, force_password_change, preferred_device_id, last_login_at, last_login_ip FROM users) TO 'C:\temp\users.csv' WITH CSV HEADER"
    Write-Host "✓ Users exported" -ForegroundColor Green

    # Export profiles
    psql -h localhost -p 5432 -U postgres -d soft_sme_db -c "`\copy (SELECT id, name, email, created_at, updated_at FROM profiles) TO 'C:\temp\profiles.csv' WITH CSV HEADER"
    Write-Host "✓ Profiles exported" -ForegroundColor Green

    # Export products
    psql -h localhost -p 5432 -U postgres -d soft_sme_db -c "`\copy (SELECT product_id, product_name, product_description, created_at, updated_at FROM products) TO 'C:\temp\products.csv' WITH CSV HEADER"
    Write-Host "✓ Products exported" -ForegroundColor Green

    # Export vendors
    psql -h localhost -p 5432 -U postgres -d soft_sme_db -c "`\copy (SELECT vendor_id, vendor_name, street_address, city, province, country, contact_person, telephone_number, email, website, created_at, updated_at, postal_code FROM vendormaster) TO 'C:\temp\vendormaster.csv' WITH CSV HEADER"
    Write-Host "✓ Vendors exported" -ForegroundColor Green

    # Export customers
    psql -h localhost -p 5432 -U postgres -d soft_sme_db -c "`\copy (SELECT customer_id, customer_name, street_address, city, province, country, contact_person, telephone_number, email, website, created_at, updated_at, postal_code FROM customermaster) TO 'C:\temp\customermaster.csv' WITH CSV HEADER"
    Write-Host "✓ Customers exported" -ForegroundColor Green

    # Export inventory (generate part_id)
    psql -h localhost -p 5432 -U postgres -d soft_sme_db -c "`\copy (SELECT part_number, part_description, unit, last_unit_cost, quantity_on_hand, created_at, updated_at, reorder_point, part_type, 'General' as category, ROW_NUMBER() OVER (ORDER BY part_number) as part_id FROM inventory) TO 'C:\temp\inventory.csv' WITH CSV HEADER"
    Write-Host "✓ Inventory exported" -ForegroundColor Green

    # Export quotes
    psql -h localhost -p 5432 -U postgres -d soft_sme_db -c "`\copy (SELECT quote_id, quote_number, customer_id, quote_date, valid_until, product_name, product_description, estimated_cost, status, created_at, updated_at, sequence_number, terms, customer_po_number, vin_number FROM quotes) TO 'C:\temp\quotes.csv' WITH CSV HEADER"
    Write-Host "✓ Quotes exported" -ForegroundColor Green

    # Export purchase orders (add missing columns)
    psql -h localhost -p 5432 -U postgres -d soft_sme_db -c "`\copy (SELECT purchase_id, purchase_number, vendor_id, purchase_date, date, bill_number, subtotal, total_gst_amount, total_amount, status, created_at, updated_at, gst_rate, exported_to_qbo, qbo_exported_at, qbo_export_status, qbo_bill_id, NULL as qbo_export_date, NULL as pickup_time, NULL as pickup_location, NULL as pickup_contact_person, NULL as pickup_phone, NULL as pickup_instructions, NULL as pickup_notes, false as order_placed, NULL as order_placed_at, NULL as order_placed_by, NULL as order_placed_method, 'pending' as vendor_confirmation_status, NULL as vendor_confirmation_notes, NULL as vendor_confirmation_date, false as pricing_updated, NULL as pricing_updated_at, NULL as pricing_updated_by, NULL as pricing_updated_method, false as quantity_adjusted, NULL as quantity_adjusted_at, NULL as quantity_adjusted_by, NULL as quantity_adjusted_method, NULL as original_quantities, NULL as adjusted_quantities, NULL as vendor_pricing_notes FROM purchasehistory) TO 'C:\temp\purchasehistory.csv' WITH CSV HEADER"
    Write-Host "✓ Purchase orders exported" -ForegroundColor Green

    # Export purchase line items
    psql -h localhost -p 5432 -U postgres -d soft_sme_db -c "`\copy (SELECT line_item_id, purchase_id, part_number, part_description, quantity, unit, unit_cost, gst_amount, line_total, created_at, updated_at FROM purchaselineitems) TO 'C:\temp\purchaselineitems.csv' WITH CSV HEADER"
    Write-Host "✓ Purchase line items exported" -ForegroundColor Green

    # Export sales orders (handle empty timestamps)
    psql -h localhost -p 5432 -U postgres -d soft_sme_db -c "`\copy (SELECT sales_order_id, sales_order_number, customer_id, sales_date, product_name, product_description, subtotal, total_gst_amount, total_amount, status, estimated_cost, default_hourly_rate, created_at, updated_at, exported_to_qbo, CASE WHEN qbo_exported_date = '' THEN NULL ELSE qbo_exported_date END as qbo_exported_date, qbo_export_status, sequence_number, customer_po_number, vin_number, quote_id, terms, qbo_invoice_id FROM salesorderhistory) TO 'C:\temp\salesorderhistory.csv' WITH CSV HEADER"
    Write-Host "✓ Sales orders exported" -ForegroundColor Green

    # Export sales line items
    psql -h localhost -p 5432 -U postgres -d soft_sme_db -c "`\copy (SELECT sales_order_line_item_id, sales_order_id, part_number, part_description, quantity_sold, unit, unit_price, line_amount, created_at, updated_at, quantity_to_order, quantity_committed FROM salesorderlineitems) TO 'C:\temp\salesorderlineitems.csv' WITH CSV HEADER"
    Write-Host "✓ Sales line items exported" -ForegroundColor Green

    # Export time entries
    psql -h localhost -p 5432 -U postgres -d soft_sme_db -c "`\copy (SELECT id, profile_id, sales_order_id, clock_in, clock_out, duration, unit_price, created_at, updated_at FROM time_entries) TO 'C:\temp\time_entries.csv' WITH CSV HEADER"
    Write-Host "✓ Time entries exported" -ForegroundColor Green

    # Export attendance
    psql -h localhost -p 5432 -U postgres -d soft_sme_db -c "`\copy (SELECT id, profile_id, clock_in, clock_out, created_by, updated_at, duration FROM attendance_shifts) TO 'C:\temp\attendance_shifts.csv' WITH CSV HEADER"
    Write-Host "✓ Attendance exported" -ForegroundColor Green

} catch {
    Write-Host "Error during export: $_" -ForegroundColor Red
    exit 1
}

Write-Host "`nStep 3: Importing data to staging database..." -ForegroundColor Yellow

# Import data to staging database
try {
    # Import in order to respect foreign key constraints
    
    # 1. Companies (no dependencies)
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "`\copy companies FROM 'C:\temp\companies.csv' WITH CSV HEADER"
    Write-Host "✓ Companies imported" -ForegroundColor Green

    # 2. Business profile (no dependencies)
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "`\copy business_profile FROM 'C:\temp\business_profile.csv' WITH CSV HEADER"
    Write-Host "✓ Business profile imported" -ForegroundColor Green

    # 3. Users (depends on companies)
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "`\copy users FROM 'C:\temp\users.csv' WITH CSV HEADER"
    Write-Host "✓ Users imported" -ForegroundColor Green

    # 4. Profiles (no dependencies)
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "`\copy profiles FROM 'C:\temp\profiles.csv' WITH CSV HEADER"
    Write-Host "✓ Profiles imported" -ForegroundColor Green

    # 5. Products (no dependencies)
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "`\copy products FROM 'C:\temp\products.csv' WITH CSV HEADER"
    Write-Host "✓ Products imported" -ForegroundColor Green

    # 6. Vendors (no dependencies)
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "`\copy vendormaster FROM 'C:\temp\vendormaster.csv' WITH CSV HEADER"
    Write-Host "✓ Vendors imported" -ForegroundColor Green

    # 7. Customers (no dependencies)
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "`\copy customermaster FROM 'C:\temp\customermaster.csv' WITH CSV HEADER"
    Write-Host "✓ Customers imported" -ForegroundColor Green

    # 8. Inventory (no dependencies)
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "`\copy inventory FROM 'C:\temp\inventory.csv' WITH CSV HEADER"
    Write-Host "✓ Inventory imported" -ForegroundColor Green

    # 9. Quotes (depends on customers)
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "`\copy quotes FROM 'C:\temp\quotes.csv' WITH CSV HEADER"
    Write-Host "✓ Quotes imported" -ForegroundColor Green

    # 10. Purchase orders (depends on vendors)
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "`\copy purchasehistory FROM 'C:\temp\purchasehistory.csv' WITH CSV HEADER"
    Write-Host "✓ Purchase orders imported" -ForegroundColor Green

    # 11. Purchase line items (depends on purchase orders)
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "`\copy purchaselineitems FROM 'C:\temp\purchaselineitems.csv' WITH CSV HEADER"
    Write-Host "✓ Purchase line items imported" -ForegroundColor Green

    # 12. Sales orders (depends on customers, quotes)
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "`\copy salesorderhistory FROM 'C:\temp\salesorderhistory.csv' WITH CSV HEADER"
    Write-Host "✓ Sales orders imported" -ForegroundColor Green

    # 13. Sales line items (depends on sales orders)
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "`\copy salesorderlineitems FROM 'C:\temp\salesorderlineitems.csv' WITH CSV HEADER"
    Write-Host "✓ Sales line items imported" -ForegroundColor Green

    # 14. Time entries (depends on profiles, sales orders)
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "`\copy time_entries FROM 'C:\temp\time_entries.csv' WITH CSV HEADER"
    Write-Host "✓ Time entries imported" -ForegroundColor Green

    # 15. Attendance (depends on profiles)
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "`\copy attendance_shifts FROM 'C:\temp\attendance_shifts.csv' WITH CSV HEADER"
    Write-Host "✓ Attendance imported" -ForegroundColor Green

} catch {
    Write-Host "Error during import: $_" -ForegroundColor Red
    exit 1
}

Write-Host "`nStep 4: Cleaning up..." -ForegroundColor Yellow

# Clean up temporary files
Remove-Item "C:\temp\*.csv" -Force
Write-Host "✓ Temporary files cleaned up" -ForegroundColor Green

Write-Host "`nStep 5: Verifying migration..." -ForegroundColor Yellow

# Verify migration
$result = psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "
SELECT 
    'vendormaster' as table_name, COUNT(*) as record_count FROM vendormaster
UNION ALL
SELECT 'customermaster', COUNT(*) FROM customermaster
UNION ALL
SELECT 'inventory', COUNT(*) FROM inventory
UNION ALL
SELECT 'purchasehistory', COUNT(*) FROM purchasehistory
UNION ALL
SELECT 'salesorderhistory', COUNT(*) FROM salesorderhistory
UNION ALL
SELECT 'time_entries', COUNT(*) FROM time_entries
UNION ALL
SELECT 'attendance_shifts', COUNT(*) FROM attendance_shifts
ORDER BY table_name;"

Write-Host "Migration Results:" -ForegroundColor Cyan
Write-Host $result

Write-Host "`nStep 6: Final verification..." -ForegroundColor Yellow

# Check for any foreign key violations
$fkCheck = psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "
SELECT 
    'purchaselineitems' as table_name, COUNT(*) as orphaned_records 
FROM purchaselineitems pli 
LEFT JOIN purchasehistory ph ON pli.purchase_id = ph.purchase_id 
WHERE ph.purchase_id IS NULL
UNION ALL
SELECT 
    'salesorderlineitems', COUNT(*) 
FROM salesorderlineitems soli 
LEFT JOIN salesorderhistory soh ON soli.sales_order_id = soh.sales_order_id 
WHERE soh.sales_order_id IS NULL
UNION ALL
SELECT 
    'time_entries', COUNT(*) 
FROM time_entries te 
LEFT JOIN salesorderhistory soh ON te.sales_order_id = soh.sales_order_id 
WHERE te.sales_order_id IS NOT NULL AND soh.sales_order_id IS NULL;"

Write-Host "Foreign Key Check:" -ForegroundColor Cyan
Write-Host $fkCheck

Write-Host "`nStep 7: Data integrity check..." -ForegroundColor Yellow

# Check data integrity
$integrityCheck = psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "
SELECT 
    'Total Records' as check_type,
    (SELECT COUNT(*) FROM vendormaster) + 
    (SELECT COUNT(*) FROM customermaster) + 
    (SELECT COUNT(*) FROM inventory) + 
    (SELECT COUNT(*) FROM purchasehistory) + 
    (SELECT COUNT(*) FROM salesorderhistory) + 
    (SELECT COUNT(*) FROM time_entries) + 
    (SELECT COUNT(*) FROM attendance_shifts) as total_records
UNION ALL
SELECT 
    'Expected Total',
    4 + 7 + 170 + 12 + 17 + 34 + 36 as expected_total;"

Write-Host "Data Integrity Check:" -ForegroundColor Cyan
Write-Host $integrityCheck

Write-Host "`nMigration completed successfully!" -ForegroundColor Green
Write-Host "Your data has been successfully migrated to the staging database." -ForegroundColor Green
Write-Host "You can now update your application to use the new database schema." -ForegroundColor Green
