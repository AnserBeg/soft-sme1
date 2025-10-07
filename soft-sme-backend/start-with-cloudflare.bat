@echo off
echo Starting NeuraTask Backend with Cloudflare Tunnel...
echo.

REM Start the backend server in the background
echo Starting backend server...
start "Backend Server" cmd /k "npm start"

REM Wait a moment for the server to start
timeout /t 5 /nobreak > nul

REM Start Cloudflare tunnel
echo Starting Cloudflare tunnel...
echo.
echo Note: You'll need to authenticate with Cloudflare first.
echo Run: cloudflared tunnel login
echo.
cloudflared tunnel run soft-sme-backend

echo.
echo Cloudflare tunnel stopped.
pause 