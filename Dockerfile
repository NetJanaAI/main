# Stage 1: Build Frontend
FROM node:22-slim AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: Build Backend
FROM node:22-slim AS server-build
WORKDIR /app
COPY package*.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 3: Production Runtime (Playwright)
# Image version matches the playwright version pinned in package-lock.json.
FROM mcr.microsoft.com/playwright:v1.58.2-jammy
WORKDIR /app

# Production optimization: Only install production dependencies
COPY package*.json .npmrc ./
RUN npm ci --omit=dev

# Copy compiled artifacts
COPY --from=server-build /app/dist ./dist
COPY --from=client-build /app/client/dist ./client/dist

# Ensure the data directory exists for local vault persistence and is owned by pwuser
RUN mkdir -p /app/data && chown -R pwuser:pwuser /app && chmod 750 /app/data

# Set environment
ENV NODE_ENV=production
ENV PORT=3000
ENV NETJANA_MODE=standalone
ENV ROLE=api_only

# Azure App Service and Container Apps will use the PORT env var
EXPOSE 3000

# Metadata
LABEL maintainer="NetJana AI Team"
LABEL version="1.2.0"
LABEL description="Sovereign Alpha B2B Scraper - Azure Ready"

USER pwuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.status < 500 ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "start"]
