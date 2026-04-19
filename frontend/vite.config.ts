import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8000',  // proxy API calls to FastAPI
      // Artifact snapshots (PNG + HTML) are saved by the worker and served
      // via a StaticFiles mount at /artifacts/ on the FastAPI backend.
      '/artifacts': 'http://localhost:8000',
      // /pay/{job_id} and /jobs/{job_id}/resume are FastAPI routes (noVNC
      // payment page + cookie-based cart resume). In production the frontend
      // build is served from FastAPI so these resolve naturally; in dev the
      // Vite server needs to forward them.
      '/pay': 'http://localhost:8000',
      '/jobs': 'http://localhost:8000',
    }
  }
})