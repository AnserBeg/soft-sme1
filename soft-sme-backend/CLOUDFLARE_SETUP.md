# Cloudflare Tunnel Setup for Aiven Backend

This guide will help you set up Cloudflare Tunnel to expose your local backend server to the internet.

## 🚀 Quick Start

### Prerequisites
1. Cloudflare account (free)
2. Domain name (optional, but recommended)
3. Backend server running on port 3000

### Step 1: Authenticate with Cloudflare
```bash
cloudflared tunnel login
```
This will open your browser to authenticate with Cloudflare.

### Step 2: Create Tunnel
```bash
cloudflared tunnel create soft-sme-backend
```

### Step 3: Configure Domain (Optional)
If you have a domain:
```bash
cloudflared tunnel route dns soft-sme-backend api.yourdomain.com
```

### Step 4: Start Backend and Tunnel
```bash
# Start backend server
npm start

# In another terminal, start tunnel
cloudflared tunnel run soft-sme-backend
```

## 📋 Detailed Setup

### 1. Cloudflare Account Setup
1. Go to [cloudflare.com](https://cloudflare.com)
2. Create a free account
3. Add your domain (optional)

### 2. Tunnel Authentication
```bash
cloudflared tunnel login
```
- Opens browser to authenticate
- Creates credentials file in `.cloudflared/`

### 3. Tunnel Creation
```bash
# Create tunnel
cloudflared tunnel create soft-sme-backend

# List tunnels
cloudflared tunnel list
```

### 4. Domain Configuration (Optional)
If you have a domain:
```bash
# Route DNS
cloudflared tunnel route dns soft-sme-backend api.yourdomain.com

# Or use a random subdomain
cloudflared tunnel route dns soft-sme-backend
```

### 5. Configuration File
The `cloudflared.yml` file is already configured for:
- Backend service on port 3000
- Proper routing rules
- Error handling

## 🌐 Accessing Your Application

### With Custom Domain
- **URL**: `https://api.yourdomain.com`
- **Status**: Professional, permanent URL

### Without Custom Domain
- **URL**: `https://random-subdomain.trycloudflare.com`
- **Status**: Temporary, changes on restart

## 🔧 Configuration Options

### Basic Configuration
```yaml
tunnel: soft-sme-backend
credentials-file: .cloudflared/credentials.json

ingress:
  - hostname: api.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

### Advanced Configuration
```yaml
tunnel: soft-sme-backend
credentials-file: .cloudflared/credentials.json

ingress:
  - hostname: api.yourdomain.com
    service: http://localhost:3000
    originRequest:
      noTLSVerify: true
      connectTimeout: 30s
  - service: http_status:404
```

## 📊 Monitoring

### Tunnel Status
```bash
# Check tunnel status
cloudflared tunnel info soft-sme-backend

# View tunnel logs
cloudflared tunnel logs soft-sme-backend
```

### Dashboard
- Access Cloudflare dashboard
- View tunnel metrics
- Monitor traffic

## 🔒 Security Features

### Automatic HTTPS
- SSL/TLS encryption
- No certificate management needed

### DDoS Protection
- Built-in protection
- Global CDN

### Access Control
- IP filtering
- Authentication rules

## 🛠️ Troubleshooting

### Common Issues

1. **Authentication Failed**
   ```bash
   # Re-authenticate
   cloudflared tunnel login
   ```

2. **Port Already in Use**
   ```bash
   # Check what's using port 3000
   netstat -ano | findstr :3000
   ```

3. **Tunnel Not Starting**
   ```bash
   # Check tunnel status
   cloudflared tunnel list
   
   # Delete and recreate if needed
   cloudflared tunnel delete soft-sme-backend
   cloudflared tunnel create soft-sme-backend
   ```

### Debug Commands
```bash
# Test tunnel
cloudflared tunnel run --loglevel debug soft-sme-backend

# Check configuration
cloudflared tunnel validate

# View logs
cloudflared tunnel logs soft-sme-backend
```

## 📱 Frontend Integration

### Update API Configuration
Once you have your tunnel URL, update your frontend:

**Environment Variable:**
```bash
# .env.local
VITE_API_BASE_URL=https://api.yourdomain.com
```

**Direct Configuration:**
```typescript
// src/config/api.ts
export const API_CONFIG = {
  cloudflare: {
    baseURL: 'https://api.yourdomain.com',
    timeout: 15000,
  }
}
```

## 🎯 Benefits Over Ngrok

- ✅ **No connection limits**
- ✅ **Custom domains**
- ✅ **Better performance**
- ✅ **Professional appearance**
- ✅ **DDoS protection**
- ✅ **Global CDN**

## 📞 Support

- [Cloudflare Documentation](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)
- [Tunnel Troubleshooting](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/troubleshooting/)

---

**Happy tunneling! 🚀** 