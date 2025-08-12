# PowerShell script to build portable version with correct environment variables

Write-Host "Setting environment variables for portable build..." -ForegroundColor Green

# Set environment variables
$env:VITE_API_BASE_URL = "https://consequences-composition-uh-counters.trycloudflare.com"
$env:VITE_CLOUDFLARE_URL = "https://consequences-composition-uh-counters.trycloudflare.com"
$env:NODE_ENV = "production"

Write-Host "Environment variables set:" -ForegroundColor Yellow
Write-Host "VITE_API_BASE_URL: $env:VITE_API_BASE_URL" -ForegroundColor Cyan
Write-Host "VITE_CLOUDFLARE_URL: $env:VITE_CLOUDFLARE_URL" -ForegroundColor Cyan
Write-Host "NODE_ENV: $env:NODE_ENV" -ForegroundColor Cyan

Write-Host "Building portable version..." -ForegroundColor Green
npm run build:desktop:win:portable

Write-Host "Build complete!" -ForegroundColor Green
Read-Host "Press Enter to continue" 