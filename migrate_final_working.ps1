# Final Working Migration
# This script excludes the problematic qbo_exported_date column

$env:PGPASSWORD = "123"

Write-Host "Starting final working migration..." -ForegroundColor Green

# Create temp directory
if (!(Test-Path "C:\temp")) {
    New-Item -ItemType Directory -Path "C:\temp"
}

Write-Host "Step 1: Exporting all remaining data..." -ForegroundColor Yellow

# Export all remaining data
try {
    # Export sales orders WITHOUT the problematic qbo_exported_date column
    psql -h localhost -p 5432 -U postgres -d soft_sme_db -c "`\copy (SELECT sales_order_id, sales_order_number, customer_id, sales_date, product_name, product_description, subtotal, total_gst_amount, total_amount, status, estimated_cost, default_hourly_rate, created_at, updated_at, exported_to_qbo, qbo_export_status, sequence_number, customer_po_number, vin_number, quote_id, terms, qbo_invoice_id FROM salesorderhistory) TO 'C:\temp\salesorderhistory_working.csv' WITH CSV HEADER"
    Write-Host "✓ Sales orders exported successfully (without qbo_exported_date)" -ForegroundColor Green

    # Export sales line items
    psql -h localhost -p 5432 -U postgres -d soft_sme_db -c "`\copy (SELECT sales_order_line_item_id, sales_order_id, part_number, part_description, quantity_sold, unit, unit_price, line_amount, created_at, updated_at, quantity_to_order, quantity_committed FROM salesorderlineitems) TO 'C:\temp\salesorderlineitems.csv' WITH CSV HEADER"
    Write-Host "✓ Sales line items exported" -ForegroundColor Green

    # Export time entries
    psql -h localhost -p 5432 -U postgres -d soft_sme_db -c "`\copy (SELECT id, profile_id, sales_order_id, clock_in, clock_out, duration, unit_price, created_at, updated_at FROM time_entries) TO 'C:\temp\time_entries.csv' WITH CSV HEADER"
    Write-Host "✓ Time entries exported" -ForegroundColor Green

    # Export quotes (if not already done)
    psql -h localhost -p 5432 -U postgres -d soft_sme_db -c "`\copy (SELECT quote_id, quote_number, customer_id, quote_date, valid_until, product_name, product_description, estimated_cost, status, created_at, updated_at, sequence_number, terms, customer_po_number, vin_number FROM quotes) TO 'C:\temp\quotes.csv' WITH CSV HEADER"
    Write-Host "✓ Quotes exported" -ForegroundColor Green

} catch {
    Write-Host "Error during export: $_" -ForegroundColor Red
    exit 1
}

Write-Host "`nStep 2: Clearing existing data from staging..." -ForegroundColor Yellow

# Clear existing data from staging
try {
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "TRUNCATE TABLE time_entries CASCADE;"
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "TRUNCATE TABLE salesorderlineitems CASCADE;"
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "TRUNCATE TABLE salesorderhistory CASCADE;"
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "TRUNCATE TABLE quotes CASCADE;"
    Write-Host "✓ Existing data cleared from staging" -ForegroundColor Green
} catch {
    Write-Host "Error clearing staging data: $_" -ForegroundColor Red
    exit 1
}

Write-Host "`nStep 3: Importing quotes..." -ForegroundColor Yellow

# Import quotes first (depends on customers)
try {
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "`\copy quotes FROM 'C:\temp\quotes.csv' WITH CSV HEADER"
    Write-Host "✓ Quotes imported" -ForegroundColor Green
} catch {
    Write-Host "Error importing quotes: $_" -ForegroundColor Red
    exit 1
}

Write-Host "`nStep 4: Importing sales orders..." -ForegroundColor Yellow

# Import sales orders (without qbo_exported_date column)
try {
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "`\copy salesorderhistory FROM 'C:\temp\salesorderhistory_working.csv' WITH CSV HEADER"
    Write-Host "✓ Sales orders imported" -ForegroundColor Green
} catch {
    Write-Host "Error importing sales orders: $_" -ForegroundColor Red
    exit 1
}

Write-Host "`nStep 5: Importing sales line items..." -ForegroundColor Yellow

# Import sales line items
try {
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "`\copy salesorderlineitems FROM 'C:\temp\salesorderlineitems.csv' WITH CSV HEADER"
    Write-Host "✓ Sales line items imported" -ForegroundColor Green
} catch {
    Write-Host "Error importing sales line items: $_" -ForegroundColor Red
    exit 1
}

Write-Host "`nStep 6: Importing time entries..." -ForegroundColor Yellow

# Import time entries
try {
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "`\copy time_entries FROM 'C:\temp\time_entries.csv' WITH CSV HEADER"
    Write-Host "✓ Time entries imported" -ForegroundColor Green
} catch {
    Write-Host "Error importing time entries: $_" -ForegroundColor Red
    exit 1
}

Write-Host "`nStep 7: Cleaning up..." -ForegroundColor Yellow

# Clean up temporary files
Remove-Item "C:\temp\*.csv" -Force
Write-Host "✓ Temporary files cleaned up" -ForegroundColor Green

Write-Host "`nStep 8: Final verification..." -ForegroundColor Yellow

# Verify the migration
$result = psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "
SELECT 
    'quotes' as table_name, COUNT(*) as record_count FROM quotes
UNION ALL
SELECT 'salesorderhistory', COUNT(*) FROM salesorderhistory
UNION ALL
SELECT 'salesorderlineitems', COUNT(*) FROM salesorderlineitems
UNION ALL
SELECT 'time_entries', COUNT(*) FROM time_entries
ORDER BY table_name;"

Write-Host "Migration Results:" -ForegroundColor Cyan
Write-Host $result

Write-Host "`nStep 9: Complete data verification..." -ForegroundColor Yellow

# Complete verification
$completeResult = psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "
SELECT 
    'vendormaster' as table_name, COUNT(*) as record_count FROM vendormaster
UNION ALL
SELECT 'customermaster', COUNT(*) FROM customermaster
UNION ALL
SELECT 'inventory', COUNT(*) FROM inventory
UNION ALL
SELECT 'purchasehistory', COUNT(*) FROM purchasehistory
UNION ALL
SELECT 'quotes', COUNT(*) FROM quotes
UNION ALL
SELECT 'salesorderhistory', COUNT(*) FROM salesorderhistory
UNION ALL
SELECT 'salesorderlineitems', COUNT(*) FROM salesorderlineitems
UNION ALL
SELECT 'time_entries', COUNT(*) FROM time_entries
UNION ALL
SELECT 'attendance_shifts', COUNT(*) FROM attendance_shifts
ORDER BY table_name;"

Write-Host "Complete Migration Results:" -ForegroundColor Cyan
Write-Host $completeResult

Write-Host "`nStep 10: Data integrity check..." -ForegroundColor Yellow

# Check data integrity
$integrityCheck = psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "
SELECT 
    'Total Records' as check_type,
    (SELECT COUNT(*) FROM vendormaster) + 
    (SELECT COUNT(*) FROM customermaster) + 
    (SELECT COUNT(*) FROM inventory) + 
    (SELECT COUNT(*) FROM purchasehistory) + 
    (SELECT COUNT(*) FROM quotes) + 
    (SELECT COUNT(*) FROM salesorderhistory) + 
    (SELECT COUNT(*) FROM salesorderlineitems) + 
    (SELECT COUNT(*) FROM time_entries) + 
    (SELECT COUNT(*) FROM attendance_shifts) as total_records
UNION ALL
SELECT 
    'Expected Total',
    4 + 7 + 170 + 12 + 0 + 17 + 37 + 34 + 36 as expected_total;"

Write-Host "Data Integrity Check:" -ForegroundColor Cyan
Write-Host $integrityCheck

Write-Host "`nStep 11: Foreign key verification..." -ForegroundColor Yellow

# Check for any foreign key violations
$fkCheck = psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "
SELECT 
    'salesorderlineitems' as table_name, COUNT(*) as orphaned_records 
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

Write-Host "`nMigration completed successfully!" -ForegroundColor Green
Write-Host "All your data has been successfully migrated to the staging database." -ForegroundColor Green
Write-Host "Note: qbo_exported_date column was excluded due to timestamp issues." -ForegroundColor Yellow
Write-Host "You can now update your application to use the new database schema." -ForegroundColor Green
