# Deploying Aiven Backend to Render

## Prerequisites
1. GitHub account with your code repository
2. Render account (free tier available)

## Step-by-Step Deployment

### 1. Prepare Your Repository
Make sure your backend code is pushed to GitHub with these files:
- `package.json` (with build and start scripts)
- `render.yaml` (deployment configuration)
- `src/` directory with your TypeScript code
- `tsconfig.json`

### 2. Deploy to Render

#### Option A: Using Render Dashboard (Recommended)
1. Go to [render.com](https://render.com) and sign up/login
2. Click "New +" and select "Web Service"
3. Connect your GitHub repository
4. Configure the service:
   - **Name**: `soft-sme-backend`
   - **Root Directory**: `soft-sme-backend`
   - **Environment**: `Node`
   - **Build Command**: `./render-build.sh` (logs whether `apt.txt` was detected and runs the Node build)
   - **Start Command**: `./render-start.sh`
   - **Plan**: Free (or choose paid plan)

#### Option B: Using render.yaml (Blueprints)
1. Go to [render.com](https://render.com)
2. Click "New +" and select "Blueprint"
3. Connect your GitHub repository
4. Render will automatically detect `render.yaml` and deploy

### 3. Environment Variables
Render will automatically set these from the database:
- `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USER`, `DB_PASSWORD`

You need to manually set:
- `JWT_SECRET`: Generate a secure random string
- `CORS_ORIGIN`: Set to `*` for development, or your domain for production
- Hugging Face cache location (choose whichever variables you already rely on, such as `TRANSFORMERS_CACHE`, `HUGGINGFACE_HUB_CACHE`, `HF_HOME`, or `XDG_CACHE_HOME`). Point them to the mounted persistent disk (for example `/var/lib/render/ai-cache/huggingface`). If these variables are already defined in your environment, no additional configuration is required.

### 3a. Persist the Hugging Face Cache (Optional but Recommended)
If you plan to use the AI assistant features, the backend downloads the `sentence-transformers` model the first time it boots. Attach a Render disk so the model is only downloaded once:

1. In the Render dashboard, open **Disks** → **New Disk** and give it a name such as `ai-cache`. Mount it at `/var/lib/render/ai-cache` with the size you need (20 GB is plenty).
2. In your service settings (or in `render.yaml`), attach that disk to the backend service.
3. Point your chosen Hugging Face cache variables (for example `TRANSFORMERS_CACHE`, `HUGGINGFACE_HUB_CACHE`, `HF_HOME`, or `XDG_CACHE_HOME`) to `/var/lib/render/ai-cache/huggingface`.

The backend will create that folder automatically if it doesn’t exist, ensuring the Hugging Face cache survives restarts and redeploys. The `render-start.sh` script runs before `npm start` and takes care of provisioning any cache directories configured through these variables.

### 4. Database Setup
1. In Render dashboard, go to your service
2. Click "Environment" tab
3. Add a PostgreSQL database:
   - Click "New +" → "PostgreSQL"
   - Name: `soft-sme-db`
   - Plan: Free (or choose paid plan)

### 5. Connect Database to Service
1. In your web service settings
2. Go to "Environment" tab
3. Add environment variables that reference the database:
   ```
   DB_HOST: From Database (soft-sme-db) - host
   DB_PORT: From Database (soft-sme-db) - port
   DB_DATABASE: From Database (soft-sme-db) - database
   DB_USER: From Database (soft-sme-db) - user
   DB_PASSWORD: From Database (soft-sme-db) - password
   ```

### 6. Deploy and Test
1. Click "Deploy" to start the deployment
2. Wait for build to complete (usually 2-5 minutes)
3. Your service will be available at: `https://your-service-name.onrender.com`

### 7. Run Database Migrations
After deployment, you may need to run database migrations:
1. Go to your service in Render dashboard
2. Click "Shell" tab
3. Run: `npm run migrate`

## Troubleshooting

### Build Failures
- Check that all dependencies are in `package.json`
- Verify TypeScript compilation works locally
- Check build logs in Render dashboard
- Confirm `apt.txt` exists at `soft-sme-backend/apt.txt` so Render installs `tesseract-ocr`, `tesseract-ocr-eng`, and `poppler-utils`

### Database Connection Issues
- Verify database environment variables are set correctly
- Check database is running and accessible
- Verify database credentials

### Runtime Errors
- Check application logs in Render dashboard
- Verify all environment variables are set
- Check CORS configuration

## Post-Deployment

### 1. Update Desktop App Configuration
Once deployed, update `soft-sme-frontend/src/config/api.ts`:
```typescript
production: {
  baseURL: 'https://your-service-name.onrender.com',
  timeout: 15000,
}
```

### 2. Test API Endpoints
Test your deployed API:
```bash
curl https://your-service-name.onrender.com/api/auth/register
```

### 3. Build Desktop App
Now you can build the desktop app with the production backend:
```bash
cd soft-sme-frontend
npm run build:desktop:win
```

## Cost Considerations
- **Free Tier**: 750 hours/month, 512MB RAM, shared CPU
- **Paid Plans**: Start at $7/month for dedicated resources
- **Database**: Free tier includes 1GB storage

## Security Notes
- JWT_SECRET should be a strong, random string
- Consider restricting CORS_ORIGIN to specific domains
- Enable HTTPS (automatic on Render)
- Regularly update dependencies 
