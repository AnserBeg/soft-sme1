@echo off
echo ========================================
echo SOFT SME BACKUP SYSTEM
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
echo Starting backup process...
node backup-system.js backup

if errorlevel 1 (
    echo.
    echo Backup failed! Check the error messages above.
    pause
    exit /b 1
) else (
    echo.
    echo Backup completed successfully!
    echo Check the 'backups' folder for your backup files.
    pause
) 