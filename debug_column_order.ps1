# Debug Column Order
# This script checks the exact column order in the staging database

$env:PGPASSWORD = "123"

Write-Host "Debugging column order..." -ForegroundColor Green

Write-Host "`nStep 1: Checking salesorderhistory table structure..." -ForegroundColor Yellow

# Check the table structure
$structure = psql -h localhost -p 5432 -U postgres -d soft_sme_db_staging -c "
SELECT column_name, data_type, ordinal_position 
FROM information_schema.columns 
WHERE table_name = 'salesorderhistory' 
ORDER BY ordinal_position;"

Write-Host "Salesorderhistory table structure:" -ForegroundColor Cyan
Write-Host $structure

Write-Host "`nStep 2: Checking the CSV file column order..." -ForegroundColor Yellow

# Check the CSV file header
if (Test-Path "C:\temp\salesorderhistory_working.csv") {
    $header = Get-Content "C:\temp\salesorderhistory_working.csv" -Head 1
    Write-Host "CSV file header:" -ForegroundColor Cyan
    Write-Host $header
    
    # Split and number the columns
    $columns = $header -split ','
    Write-Host "`nColumn positions:" -ForegroundColor Cyan
    for ($i = 0; $i -lt $columns.Count; $i++) {
        Write-Host "$i : $($columns[$i])"
    }
} else {
    Write-Host "CSV file not found" -ForegroundColor Red
}

Write-Host "`nStep 3: Checking source table structure..." -ForegroundColor Yellow

# Check the source table structure
$sourceStructure = psql -h localhost -p 5432 -U postgres -d soft_sme_db -c "
SELECT column_name, data_type, ordinal_position 
FROM information_schema.columns 
WHERE table_name = 'salesorderhistory' 
ORDER BY ordinal_position;"

Write-Host "Source salesorderhistory table structure:" -ForegroundColor Cyan
Write-Host $sourceStructure

Write-Host "`nDebug completed!" -ForegroundColor Green
