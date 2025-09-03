# Quick Start Guide - OC Mirror v2 Web Application

**Current Version: v3.0**

## 🚀 Containerized Deployment (Recommended)

This is the **easiest and most reliable** way to run the application. No host dependencies required!

### Step 1: Prerequisites
- **Podman** (required)

### Step 2: Clone and Run

> **🚨 IMPORTANT: First Run Requirement** 🚨
> 
> **For your first run, you MUST use the `--fetch-catalogs` flag to download operator catalogs:**
> 
> ```bash
> # Navigate to the application directory
> cd oc-mirror-web-app
> 
> # Make the container script executable
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

The script automatically detects whether you have Podman and uses it.

### Step 3: Access the Application
- **Web Interface**: http://localhost:3000
- **API Server**: http://localhost:3001

### Step 4: First Configuration
1. Go to **Mirror Configuration** tab
2. Click **Create New Configuration**
3. Choose a template (Basic, Advanced, or Minimal)
4. **Configure Operators**:
   - Select operator catalogs from dropdown
   - Choose packages from dynamic list (auto-updated)
   - Select channels from real-time catalog data
5. Save the configuration

### Step 5: Run Your First Operation
1. Go to **Mirror Operations** tab
2. Select your configuration
3. Click **Start Operation**
4. Monitor progress in real-time

## 🐳 Container Runtime Options

### Option 1: Automatic Detection (Recommended)
```bash
./container-run.sh
```
The script automatically detects Podman and uses it.

### Option 2: Quay.io Images (Production Ready)
```bash
# Make the script executable
chmod +x quay-run.sh

# Start the application from Quay.io
./quay-run.sh

# View logs
./quay-run.sh --logs
```

### Option 3: Podman Compose
```bash
# Make the script executable
chmod +x podman-compose.sh

# Start with podman-compose
./podman-compose.sh

# View logs
./podman-compose.sh logs

# Stop services
./podman-compose.sh down
```



## 📋 What's Included

The containerized version includes:
- ✅ **Node.js 20** runtime
- ✅ **OpenShift CLI (oc)** 
- ✅ **oc-mirror v2** 
- ✅ **All dependencies** pre-installed
- ✅ **Persistent data storage**
- ✅ **Health monitoring**
- ✅ **Multi-architecture support** (AMD64, ARM64)
- ✅ **Pre-fetched operator catalogs** (fast access to operator data)
- ✅ **Enhanced performance** (compression, error handling, logging)
- ✅ **Multi-format catalog processing** (supports all operator catalog formats)
- ✅ **Version 3.0 features** (enhanced channel selection, improved UI, better error handling)

## 🔧 Container Management

### Local Build (container-run.sh)
```bash
# View application logs
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

### Quay.io Images (quay-run.sh)
```bash
# Start the application
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

## 📁 Data Persistence

Your data is automatically persisted in the `data/` directory:
- **Configurations**: `data/configs/`
- **Operations**: `data/operations/`
- **Logs**: `data/logs/`
- **Cache**: `data/cache/`

## 🔐 Pull Secret (Optional)

If you need to access private registries, place your pull secret at:
```
./pull-secret/pull-secret.json
```

The container will automatically mount and use it.

## 🆘 Troubleshooting

### Container Won't Start
```bash
# Check container runtime status
podman info

# View build logs
podman build -t oc-mirror-web-app .

# Check container logs
podman logs oc-mirror-web-app
```

### Port Already in Use
```bash
# Check what's using port 3000
lsof -i :3000

# Stop the application
./container-run.sh --stop

# Start again
./container-run.sh
```

### Permission Issues
```bash
# Make script executable
chmod +x container-run.sh

# Run with sudo if needed
sudo ./container-run.sh

# For Podman, ensure user namespace is configured
podman system connection list
```

### Configuration Saving Issues

**Problem**: Popup shows "Failed to save configuration"

**Solution**: This is typically a directory permission issue. The container needs write access to the data directories.

```bash
# Fix directory permissions (recommended)
sudo chmod -R 755 data/

# Alternative: Make directories world-writable (less secure)
sudo chmod -R 777 data/
```

**Why this happens**: The container runs as the `nodejs` user (UID 1001), but the data directories might be owned by `root` or have insufficient permissions.

**Verification**: After fixing permissions, try saving a configuration again. The popup should show "Configuration saved successfully".

### Podman-Specific Issues
```bash
# Check Podman status
podman info

# Check if running rootless
podman system connection list

# Restart Podman service (if needed)
sudo systemctl restart podman
```

### Configuration Format Issues
If you encounter configuration errors:
- **Problem**: Invalid configuration format
- **Solution**: Use the application's web interface to generate valid configurations
- **Note**: The application validates configurations before saving

### Invalid GPG signature for images error
See https://access.redhat.com/solutions/6542281 for solution

## 📊 Verification

After starting, verify everything is working:

1. **Web Interface**: http://localhost:3000 loads successfully
2. **API Health**: http://localhost:3001/api/system/info returns OK
3. **Container Status**: 
   ```bash
   podman ps
   ```
4. **Data Directory**: `ls -la data/` shows created directories

## 🎯 Next Steps

Once the application is running:

1. **Create Configurations**: Use the web interface to create mirror configurations
2. **Run Operations**: Execute mirror operations and monitor progress
3. **Review History**: Check operation history and logs

 
