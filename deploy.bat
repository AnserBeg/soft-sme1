@echo off
REM NeuraTask Deployment Script for Windows
REM This script automates the deployment process

echo 🚀 Starting NeuraTask Deployment...

REM Check if Docker is installed
docker --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker is not installed. Please install Docker Desktop first.
    pause
    exit /b 1
)

REM Check if Docker Compose is installed
docker-compose --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker Compose is not installed. Please install Docker Compose first.
    pause
    exit /b 1
)

echo [INFO] Docker and Docker Compose are available

REM Check if environment files exist
if not exist "soft-sme-backend\.env" (
    echo [WARNING] Backend .env file not found. Creating from template...
    if exist "soft-sme-backend\env.production" (
        copy "soft-sme-backend\env.production" "soft-sme-backend\.env" >nul
        echo [INFO] Backend .env file created from template
        echo [WARNING] Please edit soft-sme-backend\.env with your actual values
    ) else (
        echo [ERROR] Backend environment template not found
        pause
        exit /b 1
    )
)

if not exist "soft-sme-frontend\.env" (
    echo [WARNING] Frontend .env file not found. Creating from template...
    if exist "soft-sme-frontend\env.production" (
        copy "soft-sme-frontend\env.production" "soft-sme-frontend\.env" >nul
        echo [INFO] Frontend .env file created from template
        echo [WARNING] Please edit soft-sme-frontend\.env with your actual values
    ) else (
        echo [ERROR] Frontend environment template not found
        pause
        exit /b 1
    )
)

REM Stop existing containers
echo [INFO] Stopping existing containers...
docker-compose down

REM Remove old images if --clean flag is provided
if "%1"=="--clean" (
    echo [INFO] Cleaning old images...
    docker-compose down --rmi all
)

REM Build and start services
echo [INFO] Building and starting services...
docker-compose up -d --build

REM Wait for services to be ready
echo [INFO] Waiting for services to be ready...
timeout /t 30 /nobreak >nul

REM Check service status
echo [INFO] Checking service status...
docker-compose ps

echo.
echo [INFO] Deployment completed!
echo.
echo 🌐 Your application is now running at:
echo    Frontend: http://localhost:3000
echo    Backend API: http://localhost:3001
echo    Health Check: http://localhost:3001/health
echo.
echo 📋 Useful commands:
echo    View logs: docker-compose logs -f
echo    Stop services: docker-compose down
echo    Restart services: docker-compose restart
echo    Update application: deploy.bat
echo.
echo [INFO] Deployment script completed successfully! 🎉
pause 