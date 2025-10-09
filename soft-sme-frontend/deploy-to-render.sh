#!/bin/bash

# Deploy Aiven Frontend to Render
# This script helps prepare and deploy the frontend to Render

echo "🚀 Deploying Aiven Frontend to Render..."

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Please run this script from the frontend directory."
    exit 1
fi

# Check if render.yaml exists
if [ ! -f "render.yaml" ]; then
    echo "❌ Error: render.yaml not found. Please make sure the deployment configuration exists."
    exit 1
fi

echo "✅ Found package.json and render.yaml"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build the project
echo "🔨 Building the project..."
npm run build

# Check if build was successful
if [ ! -d "frontend-dist" ]; then
    echo "❌ Error: Build failed. frontend-dist directory not found."
    exit 1
fi

echo "✅ Build successful!"

# Check if git is initialized
if [ ! -d ".git" ]; then
    echo "⚠️  Warning: Git not initialized. Please initialize git and push to GitHub first."
    echo "Run: git init && git add . && git commit -m 'Initial commit' && git push origin main"
    exit 1
fi

# Check if there are uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
    echo "📝 Found uncommitted changes. Committing them..."
    git add .
    git commit -m "Deploy frontend to Render - $(date)"
fi

# Push to GitHub
echo "📤 Pushing to GitHub..."
git push origin main

echo "✅ Frontend code pushed to GitHub!"
echo ""
echo "🎯 Next steps:"
echo "1. Go to https://render.com"
echo "2. Click 'New +' → 'Blueprint'"
echo "3. Connect your GitHub repository"
echo "4. Render will automatically deploy both frontend and backend"
echo ""
echo "🌐 Your frontend will be available at: https://soft-sme-frontend.onrender.com"
echo "🔗 Backend API: https://soft-sme-backend.onrender.com"
echo ""
echo "✨ Deployment preparation complete!"

