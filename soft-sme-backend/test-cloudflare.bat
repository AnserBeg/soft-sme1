@echo off
echo Testing Cloudflare Tunnel setup...
echo.

REM Test if cloudflared is available
cloudflared version
if %errorlevel% neq 0 (
    echo Error: cloudflared not found
    echo Please install with: npm install -g cloudflared
    pause
    exit /b 1
)

echo.
echo Cloudflare Tunnel is installed!
echo.
echo Next steps:
echo 1. Create Cloudflare account at cloudflare.com
echo 2. Run: cloudflared tunnel login
echo 3. Run: cloudflared tunnel create soft-sme-backend
echo 4. Start your backend: npm start
echo 5. Start tunnel: cloudflared tunnel run soft-sme-backend
echo.
pause 