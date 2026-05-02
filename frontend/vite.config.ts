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
    host: true,
    proxy: {
      '/api': 'http://localhost:8000',
      '/artifacts': 'http://localhost:8000',
      '/pay': 'http://localhost:8000',
      '/jobs': 'http://localhost:8000',
    }
  }
})
