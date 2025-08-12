# Soft SME Desktop App Deployment Guide

## Overview
This guide explains how to deploy the Soft SME application as a desktop app that can be installed on multiple devices and connect to a centralized backend server.

## Architecture
- **Desktop App**: Electron-based application that runs on Windows, Mac, and Linux
- **Backend Server**: Centralized API server that all desktop apps connect to
- **Database**: Centralized database shared by all users

## Prerequisites

### For Development
1. Node.js 18+ installed
2. Backend server running (local or remote)
3. Database configured

### For Production Deployment
1. Backend server deployed to a cloud provider (AWS, Azure, GCP, etc.)
2. Database deployed and accessible
3. Domain name configured for backend API
4. SSL certificate for HTTPS

## Development Setup

### 1. Start Backend Server
```bash
cd soft-sme-backend
npm install
npm run dev
```

### 2. Start Desktop App in Development
```bash
cd soft-sme-frontend
npm install
npm run electron:dev
```

## Production Deployment

### 1. Deploy Backend Server
Deploy your backend to a cloud provider and note the public URL.

### 2. Update API Configuration
Edit `src/config/api.ts` and update the production URL:
```typescript
production: {
  baseURL: 'https://your-actual-backend-domain.com',
  timeout: 15000,
}
```

### 3. Build Desktop App

#### For Windows
```bash
npm run build:desktop:win
```

#### For Mac
```bash
npm run build:desktop:mac
```

#### For Linux
```bash
npm run build:desktop:linux
```

#### For All Platforms
```bash
npm run build:desktop
```

### 4. Distribute the App
The built applications will be in the `release` folder:
- Windows: `.exe` installer
- Mac: `.dmg` file
- Linux: `.AppImage` or `.deb` files

## Installation on Client Devices

### Windows
1. Download the `.exe` installer
2. Run the installer
3. Follow the installation wizard
4. Launch the app from Start Menu or Desktop shortcut

### Mac
1. Download the `.dmg` file
2. Open the `.dmg` file
3. Drag the app to Applications folder
4. Launch from Applications

### Linux
1. Download the `.AppImage` file
2. Make it executable: `chmod +x Soft-SME.AppImage`
3. Run: `./Soft-SME.AppImage`

## Configuration for Different Environments

### Development
- Backend: `http://localhost:5000`
- Database: Local development database

### Staging
- Backend: `https://staging.your-domain.com`
- Database: Staging database

### Production
- Backend: `https://your-domain.com`
- Database: Production database

## Security Considerations

1. **HTTPS**: Always use HTTPS in production
2. **Authentication**: Implement proper JWT token management
3. **CORS**: Configure CORS on backend to allow desktop app connections
4. **API Rate Limiting**: Implement rate limiting on backend
5. **Data Encryption**: Encrypt sensitive data in transit and at rest

## Troubleshooting

### App Won't Connect to Backend
1. Check if backend server is running
2. Verify API URL in `src/config/api.ts`
3. Check network connectivity
4. Verify CORS settings on backend

### Build Errors
1. Ensure all dependencies are installed
2. Check Node.js version compatibility
3. Clear npm cache: `npm cache clean --force`

### Runtime Errors
1. Check Electron version compatibility
2. Verify file paths in production build
3. Check system requirements

## Updates and Maintenance

### Automatic Updates
Consider implementing auto-update functionality using `electron-updater`.

### Manual Updates
1. Build new version of desktop app
2. Distribute new installer to users
3. Users install new version

## Support

For issues and questions:
1. Check the logs in the app (Help > Show Logs)
2. Check backend server logs
3. Verify network connectivity
4. Contact support team 