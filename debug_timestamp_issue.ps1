# Debug Timestamp Issue
# This script examines the exact timestamp problem

$env:PGPASSWORD = "123"

Write-Host "Debugging timestamp issue..." -ForegroundColor Green

# Create temp directory
if (!(Test-Path "C:\temp")) {
    New-Item -ItemType Directory -Path "C:\temp"
}

Write-Host "`nStep 1: Checking the CSV file that was created..." -ForegroundColor Yellow

# Check if the CSV file exists and examine its contents
if (Test-Path "C:\temp\salesorderhistory_final.csv") {
    $csvContent = Get-Content "C:\temp\salesorderhistory_final.csv" -Head 3
    Write-Host "First 3 lines of the CSV file:" -ForegroundColor Cyan
    $csvContent | ForEach-Object { Write-Host $_ }
} else {
    Write-Host "CSV file not found - recreating it..." -ForegroundColor Yellow
    
    # Recreate the CSV with explicit NULL handling
    try {
        psql -h localhost -p 5432 -U postgres -d soft_sme_db -c "`\copy (SELECT sales_order_id, sales_order_number, customer_id, sales_date, product_name, product_description, subtotal, total_gst_amount, total_amount, status, estimated_cost, default_hourly_rate, created_at, updated_at, exported_to_qbo, NULL as qbo_exported_date, qbo_export_status, sequence_number, customer_po_number, vin_number, quote_id, terms, qbo_invoice_id FROM salesorderhistory) TO 'C:\temp\salesorderhistory_final.csv' WITH CSV HEADER"
        Write-Host "✓ CSV file recreated" -ForegroundColor Green
        
        $csvContent = Get-Content "C:\temp\salesorderhistory_final.csv" -Head 3
        Write-Host "First 3 lines of the recreated CSV file:" -ForegroundColor Cyan
        $csvContent | ForEach-Object { Write-Host $_ }
    } catch {
        Write-Host "Error recreating CSV: $_" -ForegroundColor Red
    }
}

Write-Host "`nStep 2: Testing import with explicit NULL handling..." -ForegroundColor Yellow

# Test import with explicit NULL handling
try {
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "TRUNCATE TABLE salesorderhistory CASCADE;"
    Write-Host "✓ Cleared salesorderhistory table" -ForegroundColor Green
    
    # Try importing with explicit NULL handling
    psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "`\copy salesorderhistory FROM 'C:\temp\salesorderhistory_final.csv' WITH CSV HEADER NULL ''"
    Write-Host "✓ Import test completed" -ForegroundColor Green
    
    # Check the result
    $result = psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "SELECT COUNT(*) as count FROM salesorderhistory;"
    Write-Host "Records imported: $result" -ForegroundColor Cyan
    
} catch {
    Write-Host "Error in import test: $_" -ForegroundColor Red
}

Write-Host "`nStep 3: Alternative approach - export without problematic column..." -ForegroundColor Yellow

# Try exporting without the problematic column
try {
    psql -h localhost -p 5432 -U postgres -d soft_sme_db -c "`\copy (SELECT sales_order_id, sales_order_number, customer_id, sales_date, product_name, product_description, subtotal, total_gst_amount, total_amount, status, estimated_cost, default_hourly_rate, created_at, updated_at, exported_to_qbo, qbo_export_status, sequence_number, customer_po_number, vin_number, quote_id, terms, qbo_invoice_id FROM salesorderhistory) TO 'C:\temp\salesorderhistory_no_qbo.csv' WITH CSV HEADER"
    Write-Host "✓ Export without qbo_exported_date completed" -ForegroundColor Green
    
    # Check the new CSV
    $csvContent2 = Get-Content "C:\temp\salesorderhistory_no_qbo.csv" -Head 3
    Write-Host "First 3 lines of CSV without qbo_exported_date:" -ForegroundColor Cyan
    $csvContent2 | ForEach-Object { Write-Host $_ }
    
} catch {
    Write-Host "Error in alternative export: $_" -ForegroundColor Red
}

Write-Host "`nDebug completed!" -ForegroundColor Green
