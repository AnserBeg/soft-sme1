# Debug Sales Orders
# This script examines the sales orders data to understand timestamp issues

$env:PGPASSWORD = "123"

Write-Host "Debugging sales orders data..." -ForegroundColor Green

Write-Host "`nStep 1: Checking sales orders in source database..." -ForegroundColor Yellow

# Check sales orders in source database
$sourceCheck = psql -h localhost -p 5432 -U postgres -d soft_sme_db -c "
SELECT 
    sales_order_id,
    sales_order_number,
    customer_id,
    sales_date,
    qbo_exported_date,
    created_at,
    updated_at
FROM salesorderhistory 
ORDER BY sales_order_id 
LIMIT 10;"

Write-Host "Sample sales orders from source:" -ForegroundColor Cyan
Write-Host $sourceCheck

Write-Host "`nStep 2: Checking problematic timestamp values..." -ForegroundColor Yellow

# Check for problematic timestamp values
$timestampCheck = psql -h localhost -p 5432 -U postgres -d soft_sme_db -c "
SELECT 
    'qbo_exported_date' as field_name,
    qbo_exported_date as value,
    COUNT(*) as count
FROM salesorderhistory 
WHERE qbo_exported_date IS NOT NULL
GROUP BY qbo_exported_date
ORDER BY count DESC
LIMIT 10;"

Write-Host "Timestamp value analysis:" -ForegroundColor Cyan
Write-Host $timestampCheck

Write-Host "`nStep 3: Testing export with simpler timestamp handling..." -ForegroundColor Yellow

# Test export with simpler timestamp handling
try {
    psql -h localhost -p 5432 -U postgres -d soft_sme_db -c "`\copy (SELECT sales_order_id, sales_order_number, customer_id, sales_date, product_name, product_description, subtotal, total_gst_amount, total_amount, status, estimated_cost, default_hourly_rate, created_at, updated_at, exported_to_qbo, NULL as qbo_exported_date, qbo_export_status, sequence_number, customer_po_number, vin_number, quote_id, terms, qbo_invoice_id FROM salesorderhistory) TO 'C:\temp\salesorderhistory_test.csv' WITH CSV HEADER"
    Write-Host "✓ Test export successful" -ForegroundColor Green
} catch {
    Write-Host "Error in test export: $_" -ForegroundColor Red
}

Write-Host "`nStep 4: Checking the test CSV file..." -ForegroundColor Yellow

# Check the test CSV file
if (Test-Path "C:\temp\salesorderhistory_test.csv") {
    $csvContent = Get-Content "C:\temp\salesorderhistory_test.csv" -Head 5
    Write-Host "First 5 lines of test CSV:" -ForegroundColor Cyan
    $csvContent | ForEach-Object { Write-Host $_ }
} else {
    Write-Host "Test CSV file not found" -ForegroundColor Red
}

Write-Host "`nDebug completed!" -ForegroundColor Green
