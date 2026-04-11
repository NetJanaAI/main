# Cloud Deployment Guide — NetJana Sovereign Alpha

This guide details how to launch the ConvoSpan Intel platform on a production cloud environment.

## 1. Prerequisites (Managed Infrastructure)

Before deploying the app, provision the following managed services:

- **PostgreSQL**: [Neon.tech](https://neon.tech) or [Supabase](https://supabase.com) (Recommended for serverless scalability).
- **Redis**: [Upstash](https://upstash.com) (Crucial for job queues and rate limiting).
- **Authentication**: [Clerk](https://clerk.com) (Create a new Production Application).
- **AI**: [Google AI Studio](https://aistudio.google.com) (New production API Key).

## 2. Choosing a Cloud Host

### Option A: Azure App Service (Enterprise Choice)
1. In Azure Portal, create an **App Service** (Linux, Docker).
2. Configure **Environment Variables** in the `Configuration` tab (Use `production.env.example` as a reference).
3. Set `PORT=80` in Azure (Internal mapping to 3000).
4. Direct deploy via **GitHub Actions** using the `Dockerfile`.

### Option B: DigitalOcean / Render (Simpler Choice)
1. Connect your GitHub repository.
2. Select the `Dockerfile` for the build process.
3. Map the environment variables.
4. Ensure you have a **Persistent Volume** attached to `/app/data` to preserve vault tokens.

## 3. Post-Deployment Checklist

- [ ] **Verify Domains**: Ensure `ALLOWED_ORIGINS` in your env matches your custom domain.
- [ ] **SSL**: Most providers (Azure/Render) provide this automatically.
- [ ] **Data Encryption**: Ensure `DATABASE_URL` includes `?sslmode=require`.
- [ ] **Job Processing**: Ensure the `SCRAPE_WORKER_CONCURRENCY` is tuned to your cloud tier (Default: 2).

## 4. Troubleshooting

- **CORS Errors**: Check if your browser matches the `ALLOWED_ORIGINS` exactly (no trailing slashes).
- **DB Connection**: Ensure your production IP is whitelisted on Neon/Supabase if strict firewalling is enabled.
- **Port Mapping**: Ensure the cloud provider knows the app listens on `PORT 3000`.
