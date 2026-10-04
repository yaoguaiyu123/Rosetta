import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'

export default defineConfig({
  base: './',
  plugins: [
    vue(),
    {
      name: 'pdf-reader-local-api',
      async configureServer(viteServer) {
        // 动态导入源码，避免 Vite 把 server.mjs 打进临时配置文件后改变其 .env 基准目录。
        const url = pathToFileURL(resolve(process.cwd(), 'server.mjs')).href
        const local = await import(/* @vite-ignore */ url) as {
          handleRequest: (req: IncomingMessage, res: ServerResponse) => void
        }
        viteServer.middlewares.use((req, res, next) => {
          const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
          if (['/__config', '/__translation', '/__pdf_reader_ping'].includes(path) || path.startsWith('/__full-translation')) {
            local.handleRequest(req, res)
          } else next()
        })
      }
    }
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2048
  },
  server: {
    host: '127.0.0.1',
    port: 5178,
    open: true
  }
})
