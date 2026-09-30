import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Vite proxies /api/* to the backend on :62870, so the React app can use
// same-origin requests and avoid any CORS friction. The base URL is set
// to relative ('') in src/api.js so this works in both dev and a deployed
// build.
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://localhost:62870',
                changeOrigin: true,
                secure: false
            }
        }
    }
})