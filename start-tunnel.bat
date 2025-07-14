@echo off
echo Starting Cloudflare Tunnel...
echo.

echo Make sure you have authenticated with: cloudflared tunnel login
echo.

cloudflared tunnel --url http://localhost:5000

pause 