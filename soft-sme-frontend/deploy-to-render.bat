@echo off
REM Deploy Soft SME Frontend to Render
REM This script helps prepare and deploy the frontend to Render

echo 🚀 Deploying Soft SME Frontend to Render...

REM Check if we're in the right directory
if not exist "package.json" (
    echo ❌ Error: package.json not found. Please run this script from the frontend directory.
    pause
    exit /b 1
)

REM Check if render.yaml exists
if not exist "render.yaml" (
    echo ❌ Error: render.yaml not found. Please make sure the deployment configuration exists.
    pause
    exit /b 1
)

echo ✅ Found package.json and render.yaml

REM Install dependencies
echo 📦 Installing dependencies...
call npm install

REM Build the project
echo 🔨 Building the project...
call npm run build

REM Check if build was successful
if not exist "frontend-dist" (
    echo ❌ Error: Build failed. frontend-dist directory not found.
    pause
    exit /b 1
)

echo ✅ Build successful!

REM Check if git is initialized
if not exist ".git" (
    echo ⚠️  Warning: Git not initialized. Please initialize git and push to GitHub first.
    echo Run: git init ^&^& git add . ^&^& git commit -m "Initial commit" ^&^& git push origin main
    pause
    exit /b 1
)

REM Check if there are uncommitted changes
git status --porcelain > temp_status.txt
for /f %%i in (temp_status.txt) do (
    echo 📝 Found uncommitted changes. Committing them...
    git add .
    git commit -m "Deploy frontend to Render - %date% %time%"
    goto :push
)
del temp_status.txt

:push
REM Push to GitHub
echo 📤 Pushing to GitHub...
git push origin main

echo ✅ Frontend code pushed to GitHub!
echo.
echo 🎯 Next steps:
echo 1. Go to https://render.com
echo 2. Click 'New +' → 'Blueprint'
echo 3. Connect your GitHub repository
echo 4. Render will automatically deploy both frontend and backend
echo.
echo 🌐 Your frontend will be available at: https://soft-sme-frontend.onrender.com
echo 🔗 Backend API: https://soft-sme-backend.onrender.com
echo.
echo ✨ Deployment preparation complete!
pause
