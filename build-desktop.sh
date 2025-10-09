#!/bin/bash

echo "Building Aiven Desktop App..."
echo

# Check if platform argument is provided
PLATFORM=${1:-"all"}

echo "Step 1: Installing dependencies..."
cd soft-sme-frontend
npm install
if [ $? -ne 0 ]; then
    echo "Error: Failed to install dependencies"
    exit 1
fi

echo
echo "Step 2: Building desktop app for platform: $PLATFORM"

case $PLATFORM in
    "win"|"windows")
        echo "Building for Windows..."
        npm run build:desktop:win
        ;;
    "mac"|"macos")
        echo "Building for macOS..."
        npm run build:desktop:mac
        ;;
    "linux")
        echo "Building for Linux..."
        npm run build:desktop:linux
        ;;
    "all")
        echo "Building for all platforms..."
        npm run build:desktop
        ;;
    *)
        echo "Invalid platform. Use: win, mac, linux, or all"
        exit 1
        ;;
esac

if [ $? -ne 0 ]; then
    echo "Error: Failed to build desktop app"
    exit 1
fi

echo
echo "Build completed successfully!"
echo "The installers can be found in: soft-sme-frontend/release/"
echo 