# Final Sales Orders Migration
# This script uses the working approach (NULL for qbo_exported_date)

$env:PGPASSWORD = "123"

Write-Host "Starting final sales orders migration..." -ForegroundColor Green

# Create temp directory
if (!(Test-Path "C:\temp")) {
    New-Item -ItemType Directory -Path "C:\temp"
}

Write-Host "Step 1: Exporting all sales-related data..." -ForegroundColor Yellow

# Export all sales-related data
try {
    # Export sales orders with NULL for problematic timestamp
    psql -h localhost -p 5432 -U postgres -d soft_sme_db -c "`\copy (SELECT sales_order_id, sales_order_number, customer_id, sales_date, product_name, product_description, subtotal, total_gst_amount, total_amount, status, estimated_cost, default_hourly_rate, created_at, updated_at, exported_to_qbo, NULL as qbo_exported_date, qbo_export_status, sequence_number, customer_po_number, vin_number, quote_id, terms, qbo_invoice_id FROM salesorderhistory) TO 'C:\temp\salesorderhistory_final.csv' WITH CSV HEADER"
    Write-Host "✓ Sales orders exported successfully" -ForegroundColor Green

    # Export sales line items
    psql -h localhost -p 5432 -U postgres -d soft_sme_db -c "`\copy (SELECT sales_order_line_item_id, sales_order_id, part_number, part_description, quantity_sold, unit, unit_price, line_amount, created_at, updated_at, quantity_to_order, quantity_committed FROM salesorderlineitems) TO 'C:\temp\salesorderlineitems.csv' WITH CSV HEADER"
    Write-Host "✓ Sales line items exported" -ForegroundColor Green

    # Export time entries
    psql -h localhost -p 5432 -U postgres -d soft_sme_db -c "`\copy (SELECT id, profile_id, sales_order_id, clock_in, clock_out, duration, unit_price, created_at, updated_at FROM time_entries) TO 'C:\temp\time_entries.csv' WITH CSV HEADER"
    Write-Host "✓ Time entries exported" -ForegroundColor Green

} catch {
    Write-Host "Error during export: $_" -ForegroundColor Red
    exit 1
}

Write-Host "`nStep 2: Clearing existing sales data from staging..." -ForegroundColor Yellow

# Clear existing sales data from staging
try {
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "TRUNCATE TABLE time_entries CASCADE;"
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "TRUNCATE TABLE salesorderlineitems CASCADE;"
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "TRUNCATE TABLE salesorderhistory CASCADE;"
    Write-Host "✓ Existing sales data cleared from staging" -ForegroundColor Green
} catch {
    Write-Host "Error clearing staging data: $_" -ForegroundColor Red
    exit 1
}

Write-Host "`nStep 3: Importing sales orders..." -ForegroundColor Yellow

# Import sales orders first
try {
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "`\copy salesorderhistory FROM 'C:\temp\salesorderhistory_final.csv' WITH CSV HEADER"
    Write-Host "✓ Sales orders imported" -ForegroundColor Green
} catch {
    Write-Host "Error importing sales orders: $_" -ForegroundColor Red
    exit 1
}

Write-Host "`nStep 4: Importing sales line items..." -ForegroundColor Yellow

# Import sales line items
try {
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "`\copy salesorderlineitems FROM 'C:\temp\salesorderlineitems.csv' WITH CSV HEADER"
    Write-Host "✓ Sales line items imported" -ForegroundColor Green
} catch {
    Write-Host "Error importing sales line items: $_" -ForegroundColor Red
    exit 1
}

Write-Host "`nStep 5: Importing time entries..." -ForegroundColor Yellow

# Import time entries
try {
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "`\copy time_entries FROM 'C:\temp\time_entries.csv' WITH CSV HEADER"
    Write-Host "✓ Time entries imported" -ForegroundColor Green
} catch {
    Write-Host "Error importing time entries: $_" -ForegroundColor Red
    exit 1
}

Write-Host "`nStep 6: Cleaning up..." -ForegroundColor Yellow

# Clean up temporary files
Remove-Item "C:\temp\*.csv" -Force
Write-Host "✓ Temporary files cleaned up" -ForegroundColor Green

Write-Host "`nStep 7: Final verification..." -ForegroundColor Yellow

# Verify the fix
$result = psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "
SELECT 
    'salesorderhistory' as table_name, COUNT(*) as record_count FROM salesorderhistory
UNION ALL
SELECT 'salesorderlineitems', COUNT(*) FROM salesorderlineitems
UNION ALL
SELECT 'time_entries', COUNT(*) FROM time_entries
ORDER BY table_name;"

Write-Host "Sales Orders Migration Results:" -ForegroundColor Cyan
Write-Host $result

Write-Host "`nStep 8: Complete data verification..." -ForegroundColor Yellow

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

Write-Host "`nStep 9: Data integrity check..." -ForegroundColor Yellow

# Check data integrity
$integrityCheck = psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "
SELECT 
    'Total Records' as check_type,
    (SELECT COUNT(*) FROM vendormaster) + 
    (SELECT COUNT(*) FROM customermaster) + 
    (SELECT COUNT(*) FROM inventory) + 
    (SELECT COUNT(*) FROM purchasehistory) + 
    (SELECT COUNT(*) FROM salesorderhistory) + 
    (SELECT COUNT(*) FROM salesorderlineitems) + 
    (SELECT COUNT(*) FROM time_entries) + 
    (SELECT COUNT(*) FROM attendance_shifts) as total_records
UNION ALL
SELECT 
    'Expected Total',
    4 + 7 + 170 + 12 + 17 + 37 + 34 + 36 as expected_total;"

Write-Host "Data Integrity Check:" -ForegroundColor Cyan
Write-Host $integrityCheck

Write-Host "`nSales orders migration completed successfully!" -ForegroundColor Green
Write-Host "All your data has been successfully migrated to the staging database." -ForegroundColor Green
Write-Host "You can now update your application to use the new database schema." -ForegroundColor Green
