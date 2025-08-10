#!/bin/bash

# WhatsApp Web Interface - Full Stack Deployment Script
echo "🚀 WhatsApp Web Interface - Full Stack Deployment"
echo "================================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_blue() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker compose &> /dev/null; then
    print_error "Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Create necessary directories
print_status "Creating directories..."
mkdir -p sessions logs ssl

# Install dependencies
print_blue "Installing dependencies..."
npm install

# Set default backend URL if not provided
BACKEND_URL=${BACKEND_URL:-"localhost:4000"}
print_blue "Using backend URL: $BACKEND_URL"

# Update environment variables
print_blue "Updating environment variables..."
cat > client/.env << EOF
VITE_API_BASE_URL=http://$BACKEND_URL/api
VITE_SOCKET_URL=http://$BACKEND_URL
VITE_APP_TITLE="WhatsApp Web Interface"
EOF

# Create backend .env if it doesn't exist
if [ ! -f ".env" ]; then
    print_blue "Creating backend .env from template..."
    cp .env.example .env 2>/dev/null || {
        cat > .env << EOF
PORT=3000
NODE_ENV=production
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
EOF
    }
fi

# Build the React frontend
print_blue "Building React frontend..."
cd client && npm install && npm run build && cd ..

# Copy built frontend to dist folder
print_blue "Copying frontend build files..."
mkdir -p dist
rm -rf dist/client

# Check if client/dist exists
if [ ! -d "client/dist" ]; then
    print_error "client/dist directory not found. Frontend build may have failed."
    exit 1
fi

cp -r client/dist dist/client

# Verify frontend build files
if [ ! -f "dist/client/index.html" ]; then
    print_error "Frontend build failed - index.html not found"
    print_error "Contents of dist/client:"
    ls -la dist/client/ 2>/dev/null || echo "dist/client directory is empty or doesn't exist"
    exit 1
fi
print_status "Frontend build files copied successfully"

# Build the server
print_blue "Building server..."
mkdir -p dist/server
npm run build:server

# Verify server build files
if [ ! -f "dist/server/server.js" ]; then
    print_error "Server build failed - server.js not found"
    exit 1
fi
print_status "Server build files created successfully"

# Build and start with Docker Compose
print_blue "Building and starting Docker containers..."
docker compose up -d --build

# Wait for containers to start
print_blue "Waiting for containers to start..."
sleep 10

# Check if containers are running
if docker compose ps | grep -q "Up"; then
    print_status "✅ Deployment successful!"
    echo ""
    echo "🎉 WhatsApp Web Interface is now running!"
    echo ""
    echo "📱 Access your application at:"
    echo "   http://localhost"
    echo "   http://localhost:3000 (direct)"
    echo ""
    echo "🔧 Environment Configuration:"
    echo "   Backend URL: $BACKEND_URL"
    echo "   To change backend URL, run: BACKEND_URL=your-domain.com ./deploy.sh"
    echo ""
    echo "📋 Useful commands:"
    echo "   - View logs: docker compose logs -f"
    echo "   - Stop: docker compose down"
    echo "   - Restart: docker compose restart"
    echo "   - Rebuild: docker compose up -d --build"
    echo ""
    print_warning "Remember to scan the QR code with your phone to connect WhatsApp!"
else
    print_error "❌ Deployment failed. Check logs with: docker compose logs"
    exit 1
fi
