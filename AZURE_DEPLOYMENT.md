# Azure Deployment Guide: NetJana AI

This guide outlines the steps to deploy the NetJana AI "Sovereign Alpha" platform to Azure using **Azure Container Registry (ACR)** and **Azure Container Apps (ACA)**.

## 🏗️ Prerequisites
- [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) installed and authenticated (`az login`).
- Docker Desktop or a similar container engine.
- A Resource Group and ACR instance created in your Azure portal.

## 🚥 Deployment Steps

### 1. Login to Azure Container Registry
```bash
az acr login --name <your_registry_name>
```

### 2. Build the Production Image
Build for the `linux/amd64` platform (standard for Azure):
```bash
docker build --platform linux/amd64 -t netjana-scraper:v1.2 .
```

### 3. Tag and Push to ACR
```bash
docker tag netjana-scraper:v1.2 <your_registry_name>.azurecr.io/netjana-scraper:v1.2
docker push <your_registry_name>.azurecr.io/netjana-scraper:v1.2
```

### 4. Deploy to Azure Container Apps
Use the Azure CLI to create the container app. Ensure you inject the required environment secrets.

```bash
az containerapp create \
  --name netjana-scraper \
  --resource-group <your_resource_group> \
  --environment <your_aca_environment> \
  --image <your_registry_name>.azurecr.io/netjana-scraper:v1.2 \
  --target-port 3000 \
  --ingress external \
  --min-replicas 0 \
  --max-replicas 5 \
  --env-vars \
    NODE_ENV=production \
    PORT=3000 \
    GOOGLE_API_KEY=secretref:google-api-key \
    HMAC_SECRET=secretref:hmac-secret \
    REDIS_URL=<your_azure_redis_url>
```

## 🛡️ Important Notes for Azure

- **Scale to Zero**: Set `--min-replicas` to `0` to allow the app to shut down when not in use, potentially saving $30+/month.
- **Spot Instances**: For non-critical scraping tasks, consider using **ACA Spot instances** for up to 60% savings (note: these can be evicted).
- **Sticky Sessions**: If using multiple replicas, ensure you enable session affinity in ACA for Socket.IO stability.
- **Scaling**: Set memory limits to at least **1GB** and CPU to **0.5 vCPU** per replica to handle the Puppeteer overhead.
- **Persistence**: Mount an **Azure File Share** volume to `/app/data` if you need the PII regional vault to persist across container restarts.

---
**NetJana AI | Azure Deployment Protocol v1.0**
