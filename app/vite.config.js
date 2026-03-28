import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  root: 'src/renderer',
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: '127.0.0.1',  // 强制 IPv4，避免 macOS 上 Vite 绑到 IPv6 导致 Electron ERR_CONNECTION_REFUSED
  },
})
