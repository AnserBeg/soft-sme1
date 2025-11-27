@echo off
echo Starting Clockwise Mobile with Cloudflare Tunnel...
echo.

REM Start the mobile dev server in the background
echo Starting mobile dev server...
start "Mobile Dev Server" cmd /k "npm run dev"

REM Wait a moment for the server to start
timeout /t 5 /nobreak > nul

REM Start Cloudflare tunnel
echo Starting Cloudflare tunnel...
echo.
echo Note: You'll need to authenticate with Cloudflare first.
echo Run: cloudflared tunnel login
echo.
cloudflared tunnel run clockwise-mobile

echo.
echo Cloudflare tunnel stopped.
pause
