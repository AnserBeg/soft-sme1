Write-Host "Starting Aiven Backend with Cloudflare Tunnel..." -ForegroundColor Green
Write-Host ""

# Start the backend server in the background
Write-Host "Starting backend server..." -ForegroundColor Yellow
Start-Process -NoNewWindow -FilePath "npm" -ArgumentList "start" -WorkingDirectory $PWD

# Wait a moment for the server to start
Write-Host "Waiting for server to start..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Start Cloudflare tunnel
Write-Host "Starting Cloudflare tunnel..." -ForegroundColor Yellow
Write-Host ""
Write-Host "Note: You'll need to authenticate with Cloudflare first." -ForegroundColor Cyan
Write-Host "Run: cloudflared tunnel login" -ForegroundColor Cyan
Write-Host ""
cloudflared tunnel run soft-sme-backend

Write-Host ""
Write-Host "Cloudflare tunnel stopped." -ForegroundColor Red
Read-Host "Press Enter to exit" 