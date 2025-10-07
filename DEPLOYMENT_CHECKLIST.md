# 🚀 Render Deployment Checklist

## ✅ Pre-Deployment (Completed)
- [x] Backend builds successfully (`npm run build`)
- [x] All dependencies are in `package.json`
- [x] Environment variables are configured
- [x] Database connection is working
- [x] `render.yaml` configuration file created
- [x] TypeScript compilation works

## 🔄 Next Steps for Deployment

### 1. Push Code to GitHub
```bash
# If you haven't already, create a GitHub repository and push your code
git add .
git commit -m "Prepare for Render deployment"
git push origin main
```

### 2. Deploy to Render

#### Option A: Manual Deployment (Recommended for first time)
1. **Go to [render.com](https://render.com)**
2. **Sign up/Login** with your GitHub account
3. **Click "New +"** → **"Web Service"**
4. **Connect your GitHub repository**
5. **Configure the service:**
   - **Name**: `soft-sme-backend`
   - **Root Directory**: `soft-sme-backend` (ensures Render sees `apt.txt` so the build script can install the OCR packages when needed)
   - **Environment**: `Node`
   - **Build Command**: `./render-build.sh` (the script ensures `apt.txt` exists and will install the OCR tools from it with a tmp `apt` cache if Render did not preinstall them)
   - **Start Command**: `npm start`
   - **Plan**: Free (or choose paid plan)
   - _Render automatically installs the packages listed in `soft-sme-backend/apt.txt`; do not remove or rename this file._
6. **Click "Create Web Service"**

#### Option B: Blueprint Deployment
1. **Go to [render.com](https://render.com)**
2. **Click "New +"** → **"Blueprint"**
3. **Connect your GitHub repository**
4. **Render will automatically detect `render.yaml`**

### 3. Set Up Database
1. **In your web service dashboard**
2. **Go to "Environment" tab**
3. **Add PostgreSQL database:**
   - Click "New +" → "PostgreSQL"
   - Name: `soft-sme-db`
   - Plan: Free
4. **Connect database to service:**
   - Add environment variables that reference the database
   - Render will automatically populate: `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USER`, `DB_PASSWORD`

### 4. Set Environment Variables
**Manually add these:**
- `JWT_SECRET`: Generate a secure random string (e.g., use a password generator)
- `CORS_ORIGIN`: Set to `*` for now (you can restrict later)
- `NODE_ENV`: `production`

### 5. Deploy and Test
1. **Click "Deploy"** to start the deployment
2. **Wait for build** (2-5 minutes)
3. **Check logs** for any errors
4. **Test the API** at your new URL

### 6. Run Database Migrations
1. **Go to your service dashboard**
2. **Click "Shell" tab**
3. **Run**: `npm run migrate`

## 🔗 After Deployment

### 1. Get Your Backend URL
Your service will be available at: `https://your-service-name.onrender.com`

### 2. Update Desktop App Configuration
Edit `soft-sme-frontend/src/config/api.ts`:
```typescript
production: {
  baseURL: 'https://your-service-name.onrender.com',
  timeout: 15000,
}
```

### 3. Test the Connection
```bash
curl https://your-service-name.onrender.com/api/auth/register
```

### 4. Build Desktop App
```bash
cd soft-sme-frontend
npm run build:desktop:win
```

## 🛠️ Troubleshooting

### Build Fails
- Check Render logs for specific errors
- Verify all dependencies are in `package.json`
- Test build locally first

### Database Connection Issues
- Verify database environment variables are set
- Check database is running
- Test connection in Render shell

### Runtime Errors
- Check application logs in Render dashboard
- Verify all environment variables are set
- Check CORS configuration

## 📞 Support
- **Render Documentation**: [docs.render.com](https://docs.render.com)
- **Render Community**: [community.render.com](https://community.render.com)
- **Check logs** in your Render dashboard for specific errors

## 🎯 Success Criteria
- [ ] Backend deploys successfully
- [ ] Database connects without errors
- [ ] API endpoints respond correctly
- [ ] Desktop app can connect to deployed backend
- [ ] Desktop app builds successfully with production backend

---

**Ready to deploy?** Follow the steps above and let me know if you encounter any issues! 