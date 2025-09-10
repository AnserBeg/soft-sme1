# Deploying Soft SME Frontend to Render

## Prerequisites
- Backend already deployed at: `https://soft-sme-backend.onrender.com`
- GitHub repository with frontend code
- Render account

## Step-by-Step Deployment

### 1. Prepare Your Repository
Make sure your frontend code is pushed to GitHub with these files:
- `package.json` (with build script)
- `render.yaml` (deployment configuration)
- `vite.config.ts`
- `src/` directory with your React code

### 2. Deploy to Render

#### Option A: Using Blueprint (Recommended)
1. Go to [render.com](https://render.com) and sign up/login
2. Click "New +" and select "Blueprint"
3. Connect your GitHub repository
4. Render will automatically detect `render.yaml` and deploy both services

#### Option B: Manual Static Site Deployment
1. Go to [render.com](https://render.com) and sign up/login
2. Click "New +" and select "Static Site"
3. Connect your GitHub repository
4. Configure the service:
   - **Name**: `soft-sme-frontend`
   - **Environment**: `Static Site`
   - **Build Command**: `npm install && npm run build`
   - **Publish Directory**: `frontend-dist`
   - **Plan**: Free (or choose paid plan)

### 3. Environment Variables
The following environment variables will be automatically set from `render.yaml`:
- `VITE_API_BASE_URL`: `https://soft-sme-backend.onrender.com`
- `NODE_ENV`: `production`

### 4. Deploy and Test
1. Click "Deploy" to start the deployment
2. Wait for build to complete (usually 2-5 minutes)
3. Your frontend will be available at: `https://soft-sme-frontend.onrender.com`

### 5. Test the Connection
1. Open your frontend URL in a browser
2. Check the browser console for API connection logs
3. Try logging in to verify the backend connection works

## Troubleshooting

### Build Failures
- Check that all dependencies are in `package.json`
- Verify Vite build works locally: `npm run build`
- Check build logs in Render dashboard

### API Connection Issues
- Verify `VITE_API_BASE_URL` is set correctly
- Check that backend is running and accessible
- Verify CORS configuration in backend

### Runtime Errors
- Check application logs in Render dashboard
- Verify all environment variables are set
- Check browser console for errors

## Post-Deployment

### 1. Update Desktop App Configuration
Once deployed, update `soft-sme-frontend/src/config/api.ts` if needed:
```typescript
production: {
  baseURL: 'https://soft-sme-backend.onrender.com',
  timeout: 120000,
}
```

### 2. Test All Features
- User authentication
- API calls to backend
- File uploads
- Real-time features (if any)

### 3. Monitor Performance
- Check Render dashboard for usage metrics
- Monitor API response times
- Check for any errors in logs

## Cost Considerations
- **Free Tier**: 750 hours/month, 100GB bandwidth
- **Paid Plans**: Start at $7/month for dedicated resources
- **Static sites**: Generally very cost-effective

## Security Notes
- HTTPS is automatic on Render
- Environment variables are secure
- CORS is properly configured
- No sensitive data in frontend code

## Custom Domain (Optional)
1. Go to your service in Render dashboard
2. Click "Settings" tab
3. Add your custom domain
4. Update DNS records as instructed
5. Update `VITE_API_BASE_URL` if needed
