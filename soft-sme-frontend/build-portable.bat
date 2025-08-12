@echo off
echo Setting environment variables for portable build...

REM Set environment variables for the build process
set VITE_API_BASE_URL=https://consequences-composition-uh-counters.trycloudflare.com
set VITE_CLOUDFLARE_URL=https://consequences-composition-uh-counters.trycloudflare.com
set NODE_ENV=production

echo Environment variables set:
echo VITE_API_BASE_URL=%VITE_API_BASE_URL%
echo VITE_CLOUDFLARE_URL=%VITE_CLOUDFLARE_URL%
echo NODE_ENV=%NODE_ENV%

echo Building portable version...
call npm run build:desktop:win:portable

echo Build complete!
pause 