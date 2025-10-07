@echo off
echo ========================================
echo NEURATASK RESTORE SYSTEM
echo ========================================
echo.

cd /d "%~dp0"

echo Checking if Node.js is installed...
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo Checking if archiver package is installed...
if not exist "node_modules\archiver" (
    echo Installing archiver package...
    npm install archiver
)

echo.
echo WARNING: Restoring will overwrite your current data!
echo Make sure you have a backup of your current data before proceeding.
echo.

set /p choice="Do you want to continue? (y/N): "
if /i not "%choice%"=="y" (
    echo Restore cancelled.
    pause
    exit /b 0
)

echo.
echo Available backups:
node restore-system.js list

echo.
set /p manifest="Enter manifest file name to restore from: "

if "%manifest%"=="" (
    echo No manifest file specified.
    pause
    exit /b 1
)

echo.
echo Starting restore process...
node restore-system.js restore "%manifest%"

if errorlevel 1 (
    echo.
    echo Restore failed! Check the error messages above.
    pause
    exit /b 1
) else (
    echo.
    echo Restore completed successfully!
    pause
) 