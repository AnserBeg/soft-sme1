#!/bin/bash

# Aiven Deployment Script
# This script automates the deployment process

set -e  # Exit on any error

echo "🚀 Starting Aiven Deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    print_error "Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

print_status "Docker and Docker Compose are available"

# Check if environment files exist
if [ ! -f "soft-sme-backend/.env" ]; then
    print_warning "Backend .env file not found. Creating from template..."
    if [ -f "soft-sme-backend/env.production" ]; then
        cp soft-sme-backend/env.production soft-sme-backend/.env
        print_status "Backend .env file created from template"
        print_warning "Please edit soft-sme-backend/.env with your actual values"
    else
        print_error "Backend environment template not found"
        exit 1
    fi
fi

if [ ! -f "soft-sme-frontend/.env" ]; then
    print_warning "Frontend .env file not found. Creating from template..."
    if [ -f "soft-sme-frontend/env.production" ]; then
        cp soft-sme-frontend/env.production soft-sme-frontend/.env
        print_status "Frontend .env file created from template"
        print_warning "Please edit soft-sme-frontend/.env with your actual values"
    else
        print_error "Frontend environment template not found"
        exit 1
    fi
fi

# Stop existing containers
print_status "Stopping existing containers..."
docker-compose down

# Remove old images (optional)
if [ "$1" = "--clean" ]; then
    print_status "Cleaning old images..."
    docker-compose down --rmi all
fi

# Build and start services
print_status "Building and starting services..."
docker-compose up -d --build

# Wait for services to be ready
print_status "Waiting for services to be ready..."
sleep 30

# Check service status
print_status "Checking service status..."
docker-compose ps

# Check if services are healthy
print_status "Checking service health..."

# Check backend health
if curl -f http://localhost:3001/health > /dev/null 2>&1; then
    print_status "✅ Backend is healthy"
else
    print_warning "⚠️  Backend health check failed"
fi

# Check frontend
if curl -f http://localhost:3000 > /dev/null 2>&1; then
    print_status "✅ Frontend is accessible"
else
    print_warning "⚠️  Frontend accessibility check failed"
fi

# Check database
if docker-compose exec -T postgres pg_isready -U postgres > /dev/null 2>&1; then
    print_status "✅ Database is ready"
else
    print_warning "⚠️  Database readiness check failed"
fi

print_status "Deployment completed!"
echo ""
echo "🌐 Your application is now running at:"
echo "   Frontend: http://localhost:3000"
echo "   Backend API: http://localhost:3001"
echo "   Health Check: http://localhost:3001/health"
echo ""
echo "📋 Useful commands:"
echo "   View logs: docker-compose logs -f"
echo "   Stop services: docker-compose down"
echo "   Restart services: docker-compose restart"
echo "   Update application: ./deploy.sh"
echo ""
print_status "Deployment script completed successfully! 🎉" 