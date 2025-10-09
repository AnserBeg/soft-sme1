@echo off
echo Building Aiven Desktop App for Windows...
echo.

echo Step 1: Installing dependencies...
cd soft-sme-frontend
call npm install
if %errorlevel% neq 0 (
    echo Error: Failed to install dependencies
    pause
    exit /b 1
)

echo.
echo Step 2: Building desktop app...
call npm run build:desktop:win
if %errorlevel% neq 0 (
    echo Error: Failed to build desktop app
    pause
    exit /b 1
)

echo.
echo Build completed successfully!
echo The installer can be found in: soft-sme-frontend\release\
echo.
pause 