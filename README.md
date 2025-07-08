# OC Mirror v2 Web Application

A modern web-based interface for managing OpenShift Container Platform mirroring operations using oc-mirror v2. This application provides a user-friendly way to create, manage, and execute mirror configurations without requiring command-line expertise.

## 🚀 Quick Start (Containerized - No Host Dependencies)

The easiest way to run this application is using containers. This approach requires **no installation** of Node.js, oc, or oc-mirror on your host system.

### Prerequisites

- **Docker** OR **Podman** (choose one!)
- **OpenShift pull-secret.json** (required to connect to Red Hat registries)

> **Note:** You must provide a valid `pull-secret.json` file (downloadable from https://console.redhat.com/openshift/downloads#tool-pull-secret) in order to mirror images from Red Hat registries.

### 1. Clone and Navigate

```bash
cd oc-mirror-web-app
```

### 2. Run with Container Script (Recommended)

The script automatically detects whether you have Docker or Podman and uses the appropriate one.

```bash
# Make the script executable
chmod +x container-run.sh

# Build and run the application
./container-run.sh
```

The script will:
- ✅ Detect your container runtime (Docker or Podman)
- ✅ Check container runtime availability
- ✅ Create necessary data directories
- ✅ Build the container image (includes oc and oc-mirror v2)
- ✅ Start the containerized application
- ✅ Display access information

### 3. Access the Application

Once running, access the web interface at:
- **Web UI**: http://localhost:3000
- **API**: http://localhost:3001

### Container Management

```bash
# View logs
./container-run.sh --logs

# Stop the application
./container-run.sh --stop

# Build image only
./container-run.sh --build-only

# Run container only (assumes image exists)
./container-run.sh --run-only

# Check which container engine is detected
./container-run.sh --engine
```

### Alternative: Podman Compose

If you prefer using compose with Podman:

```bash
# Make the script executable
chmod +x podman-compose.sh

# Start with podman-compose
./podman-compose.sh

# View logs
./podman-compose.sh logs

# Stop services
./podman-compose.sh down

# Show status
./podman-compose.sh status
```

### Alternative: Docker Compose

```bash
# Start with docker-compose
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

## 🔧 Manual Setup (Advanced Users Only)

If you prefer to run the application directly on your host system:

### Prerequisites

- Node.js 18+ and npm
- OpenShift CLI (oc)
- oc-mirror v2

### Installation

```bash
# Install dependencies
npm install

# Start the application
npm start
```

## 📋 Features

### 🎯 Core Functionality
- **Configuration Management**: Create, edit, and manage mirror configurations
- **Operation Execution**: Run mirror operations with real-time monitoring
- **History Tracking**: View and analyze past operations
- **Log Management**: Centralized logging with search and filtering
- **Settings Management**: Configure application preferences

### 🔧 Technical Features
- **Real-time Updates**: Live status updates during operations
- **File Management**: Upload, download, and manage configuration files
- **Error Handling**: Comprehensive error reporting and recovery
- **Responsive Design**: Works on desktop and mobile devices
- **RESTful API**: Full API for integration with other tools

### 🛡️ Security Features
- **Input Validation**: Comprehensive validation of all inputs
- **File Sanitization**: Secure file handling and processing
- **Error Isolation**: Operations are isolated to prevent system impact

## 📁 Application Structure

```
oc-mirror-web-app/
├── src/                    # React frontend
│   ├── components/         # UI components
│   └── App.js             # Main application
├── server/                # Node.js backend
│   └── index.js           # API server
├── data/                  # Persistent data (created automatically)
│   ├── configs/           # Mirror configurations
│   ├── operations/        # Operation history
│   ├── logs/             # Application logs
│   └── cache/            # oc-mirror v2 cache
├── examples/              # Configuration examples
├── Dockerfile            # Container definition
├── docker-compose.yml    # Multi-service setup
├── container-run.sh      # Easy container runner (Docker/Podman)
├── podman-compose.sh     # Podman-specific compose runner
└── README.md             # This file
```

## 🔄 oc-mirror v2 Support

This application is specifically designed for **oc-mirror v2**, which includes:

### ✅ Supported Features
- **Cache-based Storage**: No more `storageConfig` - uses local cache
- **Improved Performance**: Faster mirroring operations
- **Better Error Handling**: Enhanced error reporting and recovery
- **Simplified Configuration**: Streamlined configuration format

### 📝 Configuration Changes
- ❌ **Removed**: `storageConfig` field (no longer needed)
- ✅ **Added**: Cache directory management
- ✅ **Enhanced**: Better validation and error handling

## 🎨 User Interface

### Dashboard
- System status overview
- Recent operations
- Quick action buttons
- Resource usage statistics

### Mirror Configuration
- Visual configuration builder
- Template-based creation
- Import/export functionality
- Validation and preview

### Mirror Operations
- One-click operation execution
- Real-time progress monitoring
- Log streaming
- Operation cancellation

### History
- Comprehensive operation history
- Filtering and search
- Detailed operation analysis

### Settings
- Application configuration
- Registry credentials
- System preferences
- Maintenance tools

## 📸 Screenshots

### Dashboard
![Dashboard](docs/screenshots/dashboard.jpg)

### Mirror Configuration
![Mirror Configuration](docs/screenshots/mirror-configuration.jpg)

## 🛠️ Development

### Prerequisites
- Node.js 18+
- npm or yarn

### Setup
```bash
# Install dependencies
npm install

# Start development server
npm start

# Build for production
npm run build

# Start production server
npm run server
```

### API Documentation
The application provides a RESTful API at `http://localhost:3001/api/`:

- `GET /api/system/status` - System health check
- `GET /api/stats` - Application statistics
- `GET /api/config` - List configurations
- `POST /api/config` - Create configuration
- `GET /api/operations` - List operations
- `POST /api/operations` - Start operation

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For issues and questions:
1. Check the troubleshooting section in QUICKSTART.md
2. Review the application logs
3. Open an issue on GitHub

## 🔄 Version History

### v2.0.0
- Complete rewrite for oc-mirror v2
- Containerized deployment
- Modern React interface
- Real-time operation monitoring
- Enhanced error handling 