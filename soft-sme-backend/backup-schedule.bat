@echo off
echo ========================================
echo SOFT SME BACKUP SCHEDULER SETUP
echo ========================================
echo.

cd /d "%~dp0"

echo This script will help you set up automated backups using Windows Task Scheduler.
echo.
echo Prerequisites:
echo 1. Windows Task Scheduler must be enabled
echo 2. You must run this script as Administrator
echo 3. Node.js must be installed and in PATH
echo.

set /p choice="Do you want to continue? (y/N): "
if /i not "%choice%"=="y" (
    echo Setup cancelled.
    pause
    exit /b 0
)

echo.
echo Creating backup task...

REM Get the current directory
set "BACKUP_DIR=%~dp0"
set "BACKUP_SCRIPT=%BACKUP_DIR%backup.bat"

REM Create the task using schtasks
schtasks /create /tn "SOFT SME Backup" /tr "%BACKUP_SCRIPT%" /sc daily /st 02:00 /ru "SYSTEM" /f

if errorlevel 1 (
    echo.
    echo Failed to create scheduled task. You may need to run as Administrator.
    echo.
    echo Manual setup instructions:
    echo 1. Open Task Scheduler (taskschd.msc)
    echo 2. Create Basic Task
    echo 3. Name: SOFT SME Backup
    echo 4. Trigger: Daily at 2:00 AM
    echo 5. Action: Start a program
    echo 6. Program: %BACKUP_SCRIPT%
    echo 7. Finish
    pause
    exit /b 1
) else (
    echo.
    echo Scheduled task created successfully!
    echo Task Name: SOFT SME Backup
    echo Schedule: Daily at 2:00 AM
    echo Script: %BACKUP_SCRIPT%
    echo.
    echo To modify the schedule:
    echo 1. Open Task Scheduler (taskschd.msc)
    echo 2. Find "SOFT SME Backup" task
    echo 3. Right-click and select Properties
    echo 4. Modify the trigger settings
    echo.
    echo To test the backup now:
    echo %BACKUP_SCRIPT%
    pause
) 