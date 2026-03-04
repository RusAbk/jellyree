import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const devProxyTarget = env.VITE_DEV_PROXY_TARGET || 'http://localhost:3000'
  const devPort = Number.parseInt(env.VITE_DEV_PORT || '5173', 10)
  const previewPort = Number.parseInt(env.VITE_PREVIEW_PORT || '4173', 10)

  return {
    plugins: [vue()],
    server: {
      port: Number.isFinite(devPort) ? devPort : 5173,
      proxy: {
        '/api': {
          target: devProxyTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
    preview: {
      port: Number.isFinite(previewPort) ? previewPort : 4173,
    },
  }
})
