# OC Mirror v2 Web Application

A modern web-based interface for managing OpenShift Container Platform mirroring operations using oc-mirror v2. This application provides a user-friendly way to create, manage, and execute mirror configurations without requiring command-line expertise.

**Current Version: v3.1.1**

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

> **🚨 IMPORTANT: First Run Requirement** 🚨
> 
> **For your first run, you MUST use the `--fetch-catalogs` flag to download operator catalogs:**
> 
> ```bash
> # Make the script executable
> chmod +x container-run.sh
> 
> # ⭐ FIRST RUN: Build and run with catalog fetching (REQUIRED)
> ./container-run.sh --fetch-catalogs
> ```
> 
> **Why is this important?**
> - The `--fetch-catalogs` flag downloads real operator catalog data for all OCP versions (4.15-4.19)
> - **Without this flag, the application will not work properly** - it requires the catalog data to function
> - This ensures you have access to the complete list of operators and their channels
> - Subsequent runs can use `./container-run.sh` (without the flag) for faster startup

The script automatically detects whether you have Docker or Podman and uses the appropriate one.

The script will:
- ✅ Detect your container runtime (Docker or Podman)
- ✅ Check container runtime availability
- ✅ Create necessary data directories
- ✅ Build the container image (includes oc and oc-mirror v2)
- ✅ Start the containerized application with optimized settings
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

# Build with catalog fetching (complete data, slower build)
./container-run.sh --fetch-catalogs

# Build without fetching catalogs (fast build, uses fallback data)
./container-run.sh
```

The container now includes:
- **Multi-architecture support** for AMD64 and ARM64
- **Optimized environment variables** for better performance
- **Enhanced logging** with configurable log levels
- **Improved caching** for OC Mirror operations
- **Better error handling** and health checks
- **Pre-fetched operator catalogs** for OCP versions 4.15-4.19 (faster operator selection)
- **Multi-format catalog processing** for complete operator coverage
- **Automatic architecture detection** and display in system status

### Operator Catalog Fetching

The application now pre-fetches operator catalogs for all supported OCP versions (4.15-4.19) during the build process. This provides:

- **Faster operator selection** - No need to query catalogs at runtime
- **Version-specific channels** - Each OCP version has its own operator catalog
- **Offline capability** - Works without internet access after build
- **Accurate channel information** - Real catalog data instead of static fallbacks
- **Enhanced compatibility** - Supports multiple catalog formats including index.yaml

**Build Options:**
- **Default (Fast)**: No catalog fetch (uses fallback data, builds in 2-3 minutes)
- **Complete build**: Use `--fetch-catalogs` flag (takes 5-10 minutes, provides complete data)

**Supported Catalogs:**
- Red Hat Operator Index
- Certified Operator Index  
- Community Operator Index

**Catalog Processing:**
- **Multi-format support**: Handles catalog.json, index.json, index.yaml, package.json, and YAML formats
- **Robust extraction**: Gracefully handles non-standard operator structures
- **Complete coverage**: Processes all operators including edge cases like lightspeed-operator

### Alternative: Quay.io Images (quay-run.sh)

For production deployments using pre-built images from Quay.io:

```bash
# Make the script executable
chmod +x quay-run.sh

# Start the application from Quay.io
./quay-run.sh

# View logs
./quay-run.sh --logs

# Stop the application
./quay-run.sh --stop

# Show status
./quay-run.sh --status

# Restart the application
./quay-run.sh --restart
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



## 📋 Features

### 🎯 Core Functionality
- **Configuration Management**: Create, edit, and manage mirror configurations
- **Operation Execution**: Run mirror operations with real-time monitoring
- **History Tracking**: View and analyze past operations
- **Log Management**: Centralized logging with search and filtering
- **Settings Management**: Configure application preferences
- **Multi-Architecture Support**: Automatic detection and support for AMD64 and ARM64
- **Enhanced Catalog Processing**: Multi-format support for all operator catalog types
- **Dynamic Download Progress**: Real-time progress bar for archive downloads with automatic modal management

### 🔧 Technical Features
- **Real-time Updates**: Live status updates during operations
- **File Management**: Upload, download, and manage configuration files
- **Error Handling**: Comprehensive error reporting and recovery
- **Responsive Design**: Works on desktop and mobile devices
- **RESTful API**: Full API for integration with other tools
- **Dynamic Operator Discovery**: Real-time query of operator catalogs
- **Smart Operator Selection**: Dropdown lists with dynamic operator packages and channels
- **Multi-Format Catalog Support**: Handles catalog.json, index.json, index.yaml, package.json, and YAML formats
- **Advanced Download System**: Polling-based progress tracking with robust error handling and automatic cleanup

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
├── quay-run.sh           # Quay.io image runner
├── podman-compose.sh     # Podman-specific compose runner
└── README.md             # This file
```

## 📥 Download System

### Dynamic Progress Tracking
The application features an advanced download system with real-time progress tracking:

- **Real-time Progress Bar**: Visual progress indicator showing archive creation progress (0% → 95%)
- **Smart Modal Management**: Progress modal automatically closes when archive creation completes
- **Polling-based Updates**: Robust progress tracking using polling instead of SSE for better reliability
- **Error Recovery**: Graceful handling of download failures and network issues
- **Success Notifications**: Clear user feedback when downloads are ready

### Download Process
1. **Archive Creation**: System creates a compressed archive of operation files
2. **Progress Tracking**: Real-time progress updates via polling
3. **Modal Closure**: Progress modal closes at 95% completion
4. **Browser Download**: Archive automatically starts downloading in the browser
5. **Success Notification**: User receives confirmation of successful download

### Technical Implementation
- **Backend**: Uses `child_process.spawn` with `tar` for efficient archive creation
- **Frontend**: Polling-based progress updates with comprehensive error handling
- **Progress Storage**: Global progress tracking with automatic cleanup
- **Modal Management**: Multiple exit conditions ensure proper modal closure

## 🔄 oc-mirror v2 Support

This application is specifically designed for **oc-mirror v2**.

### ✅ Supported Features
- **Cache-based Storage**: Uses local cache for efficient operations
- **Improved Performance**: Faster mirroring operations
- **Better Error Handling**: Enhanced error reporting and recovery
- **Simplified Configuration**: Streamlined configuration format

### 📋 Configuration Format

The application generates clean oc-mirror v2 configurations:

```yaml
kind: ImageSetConfiguration
apiVersion: mirror.openshift.io/v2alpha1
mirror:
  platform:
    channels:
    - name: stable-4.18
      minVersion: "4.18.0"
      maxVersion: "4.18.10"
    graph: true
  operators:
  - catalog: registry.redhat.io/redhat/redhat-operator-index:v4.18
    packages:
    - name: advanced-cluster-management
      channels:
      - name: release-2.8
        minVersion: "2.8.0"
        maxVersion: "2.8.0"
  additionalImages:
  - name: registry.redhat.io/ubi8/ubi:latest
```

### 📝 Configuration Features
- ✅ **Cache-based Storage**: Local cache for efficient operations
- ✅ **Direct Package Configuration**: Streamlined operator configuration
- ✅ **Enhanced Validation**: Better validation and error handling
- ✅ **Simplified Format**: Clean and readable configuration structure

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
- **Dynamic Download Progress**: Real-time progress bar for archive creation and download
- **Smart Modal Management**: Automatic modal closure with success notifications
- **Robust Error Handling**: Graceful handling of download failures and edge cases

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

## 📚 API Documentation

The application provides a comprehensive RESTful API at `http://localhost:3001/api/`. For detailed API documentation including all endpoints, request/response formats, and examples, see [API.md](API.md).

**Key Endpoints:**
- `GET /api/system/info` - System health check and information (includes architecture detection)
- `GET /api/stats` - Application statistics
- `GET /api/config/list` - List configurations
- `POST /api/config/save` - Create/save configuration
- `GET /api/operations` - List operations
- `POST /api/operations/start` - Start operation
- `GET /api/operations/:id/download` - Download operation archive
- `GET /api/operations/:id/download-progress` - Get download progress (polling endpoint)
- `GET /api/catalogs` - Get available operator catalogs
- `GET /api/operators` - Get available operators (dynamic discovery)
- `GET /api/operator-channels/:operator` - Get channels for specific operator (dynamic)

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

## 🔧 Version Compatibility

### Supported oc-mirror Versions
- **oc-mirror v2.x**: ✅ Fully supported

### Supported OpenShift Versions
- **OCP 4.15**: ✅ Supported
- **OCP 4.16**: ✅ Supported  
- **OCP 4.17**: ✅ Supported
- **OCP 4.18**: ✅ Supported
- **OCP 4.19**: ✅ Supported

### Deployment Options
- **Local Build**: `./container-run.sh` - Build and run locally
- **Quay.io Images**: `./quay-run.sh` - Use pre-built images from Quay.io
- **Docker Compose**: `docker-compose up -d` - Multi-service deployment
- **Podman Compose**: `./podman-compose.sh` - Podman-specific compose

### Container Runtime Requirements
- **Docker**: 20.10+ ✅ Supported
- **Podman**: 4.0+ ✅ Supported
- **Node.js**: 18+ (included in container)

### Architecture Support
- **AMD64 (x86_64)**: ✅ Fully supported
- **ARM64 (aarch64)**: ✅ Fully supported 