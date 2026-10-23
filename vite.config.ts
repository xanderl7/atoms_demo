import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * /zhipu 代理：绕开浏览器跨域。
 * 智谱实际请求会回 ACAO 头，但 preflight(OPTIONS) 没回，
 * 浏览器带 Authorization 头时会先发 OPTIONS —— 大概率被拦。
 * 走本地代理一劳永逸，且换后端只改这里的 target。
 */
const proxy = {
  '/zhipu': {
    target: 'https://open.bigmodel.cn',
    changeOrigin: true,
    secure: true,
    rewrite: (p: string) => p.replace(/^\/zhipu/, '/api/paas/v4'),
  },
}

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true, proxy },
  preview: { port: 4173, proxy },
})
