# AWS Deployment Guide for NeuraTask Backend

## Prerequisites

1. **AWS Account** with appropriate permissions
2. **AWS CLI** installed and configured
3. **Node.js** and **npm** installed
4. **PostgreSQL Database** (RDS or external)

## Option 1: AWS Elastic Beanstalk (Recommended for beginners)

### Step 1: Install EB CLI
```bash
pip install awsebcli
```

### Step 2: Configure Environment Variables
Edit `.ebextensions/01_environment.config` with your actual values:
- `DB_HOST`: Your RDS endpoint
- `DB_PASSWORD`: Your database password
- `JWT_SECRET`: A secure random string
- `CORS_ORIGIN`: Your frontend domain

### Step 3: Deploy
```bash
# Make the deployment script executable
chmod +x deploy-aws.sh

# Run the deployment
./deploy-aws.sh
```

### Step 4: Manual Deployment (if script doesn't work)
```bash
# Initialize EB application
eb init soft-sme-backend --platform node.js --region us-east-1

# Create environment
eb create soft-sme-backend-prod --instance-type t3.micro --single-instance

# Deploy updates
eb deploy
```

## Option 2: AWS EC2 with Docker

### Step 1: Launch EC2 Instance
1. Launch Ubuntu 22.04 LTS instance
2. Configure security group to allow port 8081
3. Attach IAM role with ECR permissions

### Step 2: Install Docker on EC2
```bash
# SSH into your EC2 instance
ssh -i your-key.pem ubuntu@your-ec2-ip

# Install Docker
sudo apt update
sudo apt install -y docker.io docker-compose

# Add user to docker group
sudo usermod -aG docker ubuntu
newgrp docker
```

### Step 3: Deploy with Docker
```bash
# Clone your repository
git clone your-repo-url
cd soft-sme-backend

# Create .env file
cat > .env << EOF
DB_HOST=your-rds-endpoint.amazonaws.com
DB_PORT=5432
DB_NAME=soft_sme_db
DB_USER=postgres
DB_PASSWORD=your-db-password
JWT_SECRET=your-jwt-secret
CORS_ORIGIN=https://your-frontend-domain.com
EOF

# Build and run
docker-compose -f docker-compose.aws.yml up -d
```

## Option 3: AWS ECS (Advanced)

### Step 1: Create ECR Repository
```bash
aws ecr create-repository --repository-name soft-sme-backend --region us-east-1
```

### Step 2: Build and Push Docker Image
```bash
# Get login token
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com

# Build image
docker build -f Dockerfile.aws -t soft-sme-backend .

# Tag image
docker tag soft-sme-backend:latest YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/soft-sme-backend:latest

# Push image
docker push YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/soft-sme-backend:latest
```

### Step 3: Create ECS Cluster and Service
1. Create ECS cluster in AWS Console
2. Create task definition using `ecs-task-definition.json`
3. Create ECS service
4. Configure Application Load Balancer

## Database Setup

### Option A: AWS RDS PostgreSQL
1. Create RDS PostgreSQL instance
2. Configure security group to allow connections from your application
3. Update environment variables with RDS endpoint

### Option B: External PostgreSQL
1. Use your existing PostgreSQL database
2. Ensure it's accessible from AWS
3. Update environment variables accordingly

## Environment Variables

Create a `.env` file or set these in your deployment platform:

```env
NODE_ENV=production
PORT=8081
DB_HOST=your-database-host
DB_PORT=5432
DB_NAME=soft_sme_db
DB_USER=postgres
DB_PASSWORD=your-db-password
JWT_SECRET=your-secure-jwt-secret
CORS_ORIGIN=https://your-frontend-domain.com
```

## Security Considerations

1. **Use AWS Secrets Manager** for sensitive data
2. **Configure security groups** properly
3. **Use HTTPS** in production
4. **Set up monitoring** and logging
5. **Regular security updates**

## Monitoring and Logging

### CloudWatch Logs
```bash
# View application logs
aws logs describe-log-groups --log-group-name-prefix /aws/elasticbeanstalk
```

### Health Checks
Add a health check endpoint to your application:
```javascript
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});
```

## Cost Optimization

1. **Use t3.micro** instances for development
2. **Enable auto-scaling** for production
3. **Use reserved instances** for predictable workloads
4. **Monitor costs** with AWS Cost Explorer

## Troubleshooting

### Common Issues:
1. **Database connection errors**: Check security groups and credentials
2. **CORS errors**: Verify CORS_ORIGIN setting
3. **Port conflicts**: Ensure port 8081 is open
4. **Memory issues**: Increase instance size if needed

### Debug Commands:
```bash
# Check application status
eb status

# View logs
eb logs

# SSH into instance
eb ssh

# Check environment variables
eb printenv
```

## Next Steps

1. **Set up CI/CD** with GitHub Actions or AWS CodePipeline
2. **Configure custom domain** with Route 53
3. **Set up SSL certificate** with AWS Certificate Manager
4. **Implement auto-scaling** for production workloads
5. **Set up monitoring** with CloudWatch
