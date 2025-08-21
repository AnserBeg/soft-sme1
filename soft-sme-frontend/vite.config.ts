import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_BASE_URL || 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      },
    },
    // Allow Cloudflare tunnel hostnames when exposing the dev server
    allowedHosts: true,
  },
  preview: {
    port: 3000,
    host: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'frontend-dist',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
      },
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          mui: ['@mui/material', '@mui/icons-material', '@mui/x-data-grid', '@mui/x-date-pickers'],
        },
        sourcemapExcludeSources: true,
      },
    },
  },
  define: {
    'process.env': {
      NODE_ENV: JSON.stringify(process.env.NODE_ENV),
      VITE_API_BASE_URL: JSON.stringify(process.env.VITE_API_BASE_URL),
      VITE_CLOUDFLARE_URL: JSON.stringify(process.env.VITE_CLOUDFLARE_URL),
    },
    // Also define them as global constants for Vite
    __VITE_API_BASE_URL__: JSON.stringify(process.env.VITE_API_BASE_URL),
    __VITE_CLOUDFLARE_URL__: JSON.stringify(process.env.VITE_CLOUDFLARE_URL),
  },
  base: '/',
});