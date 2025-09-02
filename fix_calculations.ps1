Write-Host "🔧 Fixing all sales order calculations..." -ForegroundColor Green
Write-Host ""

Set-Location "soft-sme-backend"

Write-Host "📊 Running SQL fix script..." -ForegroundColor Yellow
psql $env:DATABASE_URL -f fix_calculations.sql

Write-Host ""
Write-Host "✅ Fix completed! All sales orders should now have correct calculations." -ForegroundColor Green
Write-Host ""
Read-Host "Press Enter to continue"
