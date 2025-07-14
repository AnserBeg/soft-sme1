@echo off
echo Starting Soft SME Backend Server...
echo.

cd /d "%~dp0soft-sme-backend"

echo Installing dependencies...
call npm install

echo Running database migrations...
call npm run migrate

echo Starting the server...
call npm start

pause 