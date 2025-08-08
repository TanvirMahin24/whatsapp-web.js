# 📱 WhatsApp Web Interface

A full-stack WhatsApp Web.js application with a modern React frontend, built with Vite and Express backend.

## 🚀 Features

-   ✅ **Real-time QR Code Scanning**: Scan QR code with your phone to connect
-   ✅ **Send Messages**: Send WhatsApp messages to any number
-   ✅ **Contact Management**: View and manage your WhatsApp contacts
-   ✅ **Chat History**: View recent chats and conversations
-   ✅ **Real-time Updates**: Live status updates via Socket.IO
-   ✅ **Modern UI**: Beautiful React frontend with responsive design
-   ✅ **Docker Support**: Easy deployment with Docker and Docker Compose
-   ✅ **Production Ready**: Optimized for production deployment

## 🛠️ Tech Stack

### Backend

-   **Node.js** - Runtime environment
-   **Express.js** - Web framework
-   **Socket.IO** - Real-time communication
-   **WhatsApp Web.js** - WhatsApp API client
-   **Puppeteer** - Browser automation

### Frontend

-   **React** - UI framework
-   **Vite** - Build tool and dev server
-   **Socket.IO Client** - Real-time communication
-   **Axios** - HTTP client
-   **QRCode.react** - QR code generation

### Infrastructure

-   **Docker** - Containerization
-   **Docker Compose** - Multi-container orchestration
-   **Nginx** - Reverse proxy

## 📋 Prerequisites

-   Node.js 18+
-   Docker and Docker Compose
-   Git

## 🚀 Quick Start

### Option 1: Docker Deployment (Recommended)

1. **Clone the repository**

```bash
git clone <your-repo-url>
cd whatsapp-web-interface
```

2. **Run the deployment script**

```bash
# Default deployment (localhost:3000)
./deploy.sh

# Custom backend URL
BACKEND_URL=your-domain.com ./deploy.sh
```

3. **Access the application**

-   Open your browser and go to `http://localhost`
-   Scan the QR code with your phone
-   Start using the WhatsApp Web Interface!

### Option 2: Local Development

1. **Install dependencies**

```bash
npm run install:all
```

2. **Set up environment variables**

```bash
# Copy environment templates
cp .env.example .env
cp client/.env.example client/.env
```

3. **Start development servers**

```bash
npm run dev
```

4. **Access the application**

-   Frontend: `http://localhost:5173`
-   Backend: `http://localhost:3000`

## 📁 Project Structure

```
whatsapp-web-interface/
├── src/
│   └── server/
│       └── server.js          # Express server with WhatsApp integration
├── client/
│   ├── src/
│   │   ├── App.jsx           # Main React component
│   │   └── App.css           # Styles
│   └── package.json          # Frontend dependencies
├── dist/                     # Built files (generated)
├── sessions/                 # WhatsApp session storage
├── logs/                     # Application logs
├── Dockerfile               # Docker configuration
├── docker-compose.yml       # Docker Compose setup
├── nginx.conf              # Nginx configuration
├── package.json            # Backend dependencies
└── deploy.sh              # Deployment script
```

## 🔧 Configuration

### Environment Variables

The application uses environment variables to configure the backend URL:

-   **Default**: `localhost:3000`
-   **Custom**: Set `BACKEND_URL` environment variable

```bash
# Examples
BACKEND_URL=api.mydomain.com ./deploy.sh
BACKEND_URL=192.168.1.100:3000 ./deploy.sh
BACKEND_URL=myapp.herokuapp.com ./deploy.sh
```

### Frontend Environment Variables

Copy `client/.env.example` to `client/.env` for frontend configuration:

```bash
cp client/.env.example client/.env
```

The React frontend automatically uses these environment variables:

-   `VITE_API_BASE_URL`: API endpoint URL
-   `VITE_SOCKET_URL`: WebSocket connection URL
-   `VITE_APP_TITLE`: Application title

### Backend Environment Variables

Copy `.env.example` to `.env` in the root directory for backend configuration:

```bash
cp .env.example .env
```

Or create manually:

```env
PORT=3000
NODE_ENV=production
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

### Docker Configuration

The application uses a multi-stage Docker build:

-   **Base**: Node.js 18 with Chromium
-   **Dependencies**: Installs all required packages
-   **Build**: Compiles React frontend
-   **Production**: Optimized production image

## 📱 Usage

### Connecting WhatsApp

1. Start the application
2. Open your browser to `http://localhost`
3. You'll see a QR code on the screen
4. Open WhatsApp on your phone
5. Go to Settings > Linked Devices > Link a Device
6. Scan the QR code
7. Your WhatsApp is now connected!

### Sending Messages

1. Once connected, you'll see the main interface
2. Enter a phone number (with country code, no +)
3. Type your message
4. Click "Send Message"

### Managing Contacts

1. Click "Load Contacts" to see your WhatsApp contacts
2. Click on any contact to auto-fill the phone number
3. Type your message and send

### Viewing Chats

1. Click "Load Chats" to see recent conversations
2. View chat information and unread message counts

## 🔍 API Endpoints

-   `GET /api/status` - Get WhatsApp connection status
-   `POST /api/send-message` - Send a WhatsApp message
-   `GET /api/contacts` - Get WhatsApp contacts
-   `GET /api/chats` - Get recent chats
-   `GET /health` - Health check endpoint

## 🐳 Docker Commands

```bash
# Build and start
docker-compose up -d --build

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Restart services
docker-compose restart

# Rebuild and restart
docker-compose up -d --build --force-recreate
```

## 🔧 Development

### Backend Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev:server
```

### Frontend Development

```bash
# Navigate to client directory
cd client

# Install dependencies
npm install

# Start development server
npm run dev
```

### Full Stack Development

```bash
# Start both frontend and backend
npm run dev
```

## 📊 Monitoring

### Health Check

```bash
curl http://localhost/health
```

Response:

```json
{
    "status": "OK",
    "timestamp": "2024-01-01T00:00:00.000Z",
    "whatsapp": {
        "isAuthenticated": true,
        "isReady": true
    }
}
```

### Logs

```bash
# View all logs
docker-compose logs

# View specific service logs
docker-compose logs whatsapp-web

# Follow logs in real-time
docker-compose logs -f
```

## 🔒 Security Considerations

1. **Firewall**: Only open necessary ports (80, 443, 3000)
2. **SSL**: Use HTTPS in production with Let's Encrypt
3. **Updates**: Keep dependencies updated
4. **Monitoring**: Set up monitoring for the application
5. **Backups**: Regular backups of session data

## 🐛 Troubleshooting

### Common Issues

1. **QR Code Not Showing**

    - Check if Chromium is installed in Docker
    - Verify Puppeteer can access the browser
    - Check application logs for errors

2. **Connection Issues**

    - Ensure WhatsApp Web is not already connected elsewhere
    - Try refreshing the page
    - Check if the session is valid

3. **Docker Build Issues**

    - Ensure Docker has enough memory (2GB+ recommended)
    - Try building without cache: `docker-compose build --no-cache`
    - Check Docker logs for specific errors

4. **Port Conflicts**
    - Change the port in `docker-compose.yml`
    - Kill processes using port 3000: `sudo lsof -ti:3000 | xargs kill -9`

### Logs Location

-   **Docker logs**: `docker-compose logs -f`
-   **Application logs**: `./logs/` directory
-   **Session data**: `./sessions/` directory

## 📈 Performance Optimization

1. **Docker Optimization**

    - Use multi-stage builds
    - Optimize layer caching
    - Use `.dockerignore` to exclude unnecessary files

2. **Application Optimization**

    - Enable gzip compression
    - Use CDN for static assets
    - Implement caching strategies

3. **Resource Limits**
    - Set memory limits in Docker Compose
    - Monitor resource usage
    - Scale horizontally if needed

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## ⚠️ Disclaimer

This project is not affiliated with WhatsApp Inc. Use at your own risk. WhatsApp does not officially support third-party clients, and using this application may violate WhatsApp's terms of service.

## 📞 Support

If you encounter issues:

1. Check the logs for error messages
2. Verify all prerequisites are installed
3. Ensure proper permissions
4. Check firewall and network connectivity
5. Create an issue in the repository

---

**Made with ❤️ for the WhatsApp community**
