#!/bin/bash

# AWS Elastic Beanstalk Deployment Script
# Make sure you have AWS CLI and EB CLI installed

echo "🚀 Starting AWS deployment..."

# Check if EB CLI is installed
if ! command -v eb &> /dev/null; then
    echo "❌ EB CLI not found. Please install it first:"
    echo "pip install awsebcli"
    exit 1
fi

# Check if AWS CLI is configured
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ AWS CLI not configured. Please run:"
    echo "aws configure"
    exit 1
fi

# Build the application
echo "📦 Building application..."
npm run build

# Initialize EB application (only needed once)
if [ ! -f ".elasticbeanstalk/config.yml" ]; then
    echo "🔧 Initializing Elastic Beanstalk application..."
    eb init soft-sme-backend --platform node.js --region us-east-1
fi

# Create environment (only needed once)
if ! eb status &> /dev/null; then
    echo "🌍 Creating Elastic Beanstalk environment..."
    eb create soft-sme-backend-prod --instance-type t3.micro --single-instance
else
    echo "🔄 Deploying to existing environment..."
    eb deploy
fi

echo "✅ Deployment complete!"
echo "🌐 Your application URL: $(eb status | grep CNAME | awk '{print $2}')"
