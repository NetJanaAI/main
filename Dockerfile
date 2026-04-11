# Stage 1: Build Frontend
FROM node:20-slim AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install --legacy-peer-deps
COPY client/ ./
RUN npm run build

# Stage 2: Build Backend
FROM node:20-slim AS server-build
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

# Stage 3: Production Runtime (Playwright)
# Using Microsoft's official Playwright image for best compatibility
FROM mcr.microsoft.com/playwright:v1.45.0-jammy
WORKDIR /app

# Production optimization: Only install production dependencies
COPY package*.json ./
RUN npm install --only=production --legacy-peer-deps

# Copy compiled artifacts
COPY --from=server-build /app/dist ./dist
COPY --from=client-build /app/client/dist ./client/dist

# Ensure the data directory exists for local vault persistence
RUN mkdir -p /app/data && chmod 777 /app/data

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Azure App Service and Container Apps will use the PORT env var
EXPOSE 3000

# Metadata
LABEL maintainer="NetJana AI Team"
LABEL version="1.2.0"
LABEL description="Sovereign Alpha B2B Scraper - Azure Ready"

CMD ["npm", "run", "start:standalone"]
