/**
 * 内置体验 Key 下发端点（Vercel Edge Function）。
 *
 * 与 dev 下 vite.config.ts 的 builtinKeyPlugin 同一语义：
 * Key 放 Vercel 项目环境变量 ZHIPU_API_KEY（dashboard → Settings →
 * Environment Variables，或 `vercel env add`），【不进前端 bundle】，
 * 只经这个服务端函数下发。静态部署没有这个函数时前端静默降级
 * 为「填自己的 Key」。
 *
 * 7 天有效期只做前端文案提示，不硬拦截；回收 = 改/删环境变量后重新部署。
 */
export const config = { runtime: 'edge' }

export default function handler(): Response {
  return Response.json({
    apiKey: process.env.ZHIPU_API_KEY || '',
    model: process.env.ZHIPU_MODEL || 'glm-4.5-air',
  })
}
