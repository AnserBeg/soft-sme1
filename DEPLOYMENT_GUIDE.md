# 🚀 NeuraTask Cloud Deployment Guide

This guide will help you deploy your NeuraTask business management application to the cloud.

## 📋 Prerequisites

- [Docker](https://docs.docker.com/get-docker/) installed
- [Docker Compose](https://docs.docker.com/compose/install/) installed
- A cloud provider account (AWS, Google Cloud, Azure, DigitalOcean, etc.)
- Domain name (optional but recommended)

## 🏗️ Architecture Overview

Your application consists of:
- **Frontend**: React + TypeScript + Material-UI (served by Nginx)
- **Backend**: Node.js + Express + TypeScript API
- **Database**: PostgreSQL
- **File Storage**: Local uploads directory

## 🚀 Deployment Options

### Option 1: Docker Compose (Recommended for VPS)

Perfect for VPS providers like DigitalOcean, Linode, or AWS EC2.

### Option 2: Cloud Platform Services

For managed services like AWS, Google Cloud, or Azure.

---

## 🐳 Option 1: Docker Compose Deployment

### Step 1: Prepare Your Server

1. **Connect to your VPS/Server**
   ```bash
   ssh your-username@your-server-ip
   ```

2. **Install Docker and Docker Compose**
   ```bash
   # Ubuntu/Debian
   curl -fsSL https://get.docker.com -o get-docker.sh
   sudo sh get-docker.sh
   sudo usermod -aG docker $USER
   
   # Install Docker Compose
   sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
   sudo chmod +x /usr/local/bin/docker-compose
   ```

3. **Clone your repository**
   ```bash
   git clone https://github.com/your-username/soft-sme.git
   cd soft-sme
   ```

### Step 2: Configure Environment Variables

1. **Create production environment files**
   ```bash
   # Backend environment
   cp soft-sme-backend/env.production soft-sme-backend/.env
   
   # Frontend environment
   cp soft-sme-frontend/env.production soft-sme-frontend/.env
   ```

2. **Edit the environment files with your actual values**
   ```bash
   nano soft-sme-backend/.env
   nano soft-sme-frontend/.env
   ```

   **Backend (.env) - Update these values:**
   ```env
   NODE_ENV=production
   PORT=3001
   DB_HOST=postgres
   DB_PORT=5432
   DB_DATABASE=soft_sme_db
   DB_USER=postgres
   DB_PASSWORD=your_actual_secure_password
   JWT_SECRET=your_actual_jwt_secret_key
   JWT_REFRESH_SECRET=your_actual_refresh_secret_key
   CORS_ORIGIN=https://your-domain.com
   SESSION_SECRET=your_actual_session_secret
   ```

   **Frontend (.env) - Update this value:**
   ```env
   REACT_APP_API_URL=https://your-domain.com
   ```

### Step 3: Deploy with Docker Compose

1. **Build and start the services**
   ```bash
   docker-compose up -d --build
   ```

2. **Check the status**
   ```bash
   docker-compose ps
   docker-compose logs -f
   ```

3. **Access your application**
   - Frontend: `http://your-server-ip:3000`
   - Backend API: `http://your-server-ip:3001`

### Step 4: Set Up Domain and SSL (Optional)

1. **Point your domain to your server IP**

2. **Install Nginx as reverse proxy**
   ```bash
   sudo apt update
   sudo apt install nginx certbot python3-certbot-nginx
   ```

3. **Create Nginx configuration**
   ```bash
   sudo nano /etc/nginx/sites-available/soft-sme
   ```

   Add this configuration:
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;
       
       location / {
           proxy_pass http://localhost:3000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
       
       location /api/ {
           proxy_pass http://localhost:3001;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

4. **Enable the site and get SSL certificate**
   ```bash
   sudo ln -s /etc/nginx/sites-available/soft-sme /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl reload nginx
   sudo certbot --nginx -d your-domain.com
   ```

---

## ☁️ Option 2: Cloud Platform Deployment

### AWS Deployment

1. **AWS ECS (Elastic Container Service)**
   - Create ECS cluster
   - Define task definitions for frontend, backend, and database
   - Use Application Load Balancer
   - Set up RDS for PostgreSQL

2. **AWS App Runner**
   - Deploy backend to App Runner
   - Deploy frontend to S3 + CloudFront
   - Use RDS for database

### Google Cloud Deployment

1. **Google Cloud Run**
   - Deploy backend to Cloud Run
   - Deploy frontend to Cloud Run
   - Use Cloud SQL for PostgreSQL

### Azure Deployment

1. **Azure Container Instances**
   - Deploy containers to ACI
   - Use Azure Database for PostgreSQL

---

## 🔧 Maintenance and Updates

### Updating Your Application

1. **Pull latest changes**
   ```bash
   git pull origin main
   ```

2. **Rebuild and restart**
   ```bash
   docker-compose down
   docker-compose up -d --build
   ```

### Database Backups

1. **Create backup script**
   ```bash
   #!/bin/bash
   docker exec soft-sme-db pg_dump -U postgres soft_sme_db > backup_$(date +%Y%m%d_%H%M%S).sql
   ```

2. **Automate backups with cron**
   ```bash
   crontab -e
   # Add: 0 2 * * * /path/to/backup-script.sh
   ```

### Monitoring

1. **Check application health**
   ```bash
   curl http://your-domain.com/health
   ```

2. **View logs**
   ```bash
   docker-compose logs -f backend
   docker-compose logs -f frontend
   ```

---

## 🔒 Security Considerations

1. **Change default passwords**
2. **Use strong JWT secrets**
3. **Enable HTTPS**
4. **Set up firewall rules**
5. **Regular security updates**
6. **Database access restrictions**

---

## 🆘 Troubleshooting

### Common Issues

1. **Port already in use**
   ```bash
   sudo netstat -tulpn | grep :3000
   sudo kill -9 <PID>
   ```

2. **Database connection issues**
   ```bash
   docker-compose logs postgres
   docker-compose exec postgres psql -U postgres -d soft_sme_db
   ```

3. **Build failures**
   ```bash
   docker-compose build --no-cache
   ```

### Getting Help

- Check Docker logs: `docker-compose logs`
- Verify environment variables
- Test database connectivity
- Check network connectivity

---

## 📞 Support

For deployment issues:
1. Check the logs: `docker-compose logs -f`
2. Verify your environment configuration
3. Test each service individually
4. Check your cloud provider's documentation

Your NeuraTask application is now ready for cloud deployment! 🎉 