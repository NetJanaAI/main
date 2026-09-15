import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Detect at BUILD TIME whether a real Clerk publishable key is available.
// If not, alias @clerk/clerk-react to a no-op stub so Clerk's CDN script
// is never injected and ERR_CONNECTION_CLOSED never occurs.
const clerkKey = process.env.VITE_CLERK_PUBLISHABLE_KEY ?? '';
const isDummyClerkKey =
  !clerkKey ||
  clerkKey.includes('ZHVtbXlrZXk') ||
  clerkKey.toLowerCase().includes('dummy');

console.log(
  isDummyClerkKey
    ? '[vite] No real Clerk key detected — aliasing @clerk/clerk-react to stub.'
    : '[vite] Real Clerk key detected — using @clerk/clerk-react normally.'
);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: isDummyClerkKey
      ? { '@clerk/clerk-react': path.resolve(__dirname, 'src/lib/clerk-stub.ts') }
      : {},
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true
      }
    }
  }
})
