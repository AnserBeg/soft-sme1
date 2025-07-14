# Backend Deployment Package for New Computer

## Prerequisites
- Node.js 18+ installed
- PostgreSQL installed and running
- Git (optional, for easy file transfer)

## Step 1: Transfer Files
Copy these folders/files to the new computer:
```
soft-sme-backend/     (entire folder)
prisma/              (entire folder)
package.json         (root level)
package-lock.json    (root level)
```

## Step 2: Database Setup
1. Install PostgreSQL on the new computer
2. Create a new database:
   ```sql
   CREATE DATABASE soft_sme_db;
   CREATE USER soft_sme_user WITH PASSWORD 'your_password';
   GRANT ALL PRIVILEGES ON DATABASE soft_sme_db TO soft_sme_user;
   ```

## Step 3: Environment Configuration
1. Navigate to `soft-sme-backend/`
2. Copy `env.example` to `.env`
3. Update `.env` with your database details:
   ```
   DB_HOST=localhost
   DB_PORT=5432
   DB_DATABASE=soft_sme_db
   DB_USER=soft_sme_user
   DB_PASSWORD=your_password
   JWT_SECRET=your-super-secret-jwt-key-here
   PORT=5000
   NODE_ENV=production
   CORS_ORIGIN=*
   UPLOAD_PATH=./uploads
   MAX_FILE_SIZE=10485760
   ```

## Step 4: Install Dependencies
```bash
cd soft-sme-backend
npm install
```

## Step 5: Run Database Migrations
```bash
npm run migrate
```

## Step 6: Install Cloudflare Tunnel
```bash
# Windows (PowerShell as Administrator)
winget install Cloudflare.cloudflared

# Or download from: https://github.com/cloudflare/cloudflared/releases
```

## Step 7: Authenticate Cloudflare Tunnel
```bash
cloudflared tunnel login
```
This will open a browser for authentication.

## Step 8: Start the Application
```bash
# Start backend
npm start

# In another terminal, start Cloudflare Tunnel
cloudflared tunnel --url http://localhost:5000
```

## Step 9: Update Frontend Configuration
On all client computers, update the API URL in the frontend to use the new tunnel URL.

## Troubleshooting
- Ensure PostgreSQL is running and accessible
- Check firewall settings allow port 5000
- Verify database credentials in .env file
- Make sure all dependencies are installed

## Security Notes
- Change default passwords
- Use strong JWT_SECRET
- Consider using HTTPS in production
- Restrict CORS_ORIGIN to specific domains if needed 