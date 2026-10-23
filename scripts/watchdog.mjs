#!/usr/bin/env node
/**
 * 看门狗（watchdog）—— 每分钟检查一次「agent 是否还在响应」。
 *
 * 背景：agent 是长流程任务（生成 + 自检 + 修复 + 回归测试），跑几个小时内
 * 偶发卡死/无响应。没有看门狗时，只能靠人回来发现"它不动了"，
 * 而且无法判断是什么时候开始不动的。
 *
 * 检查两项：
 *   1. .heartbeat 文件的新鲜度 —— agent 每完成一步就 `date +%s > .heartbeat`。
 *      超过 3 分钟没更新 = 卡了，写 STALL_ALERT 并记日志。
 *   2. dev server（e2e 测试依赖它）是否还能响应。
 *
 * 输出：
 *   - scripts/watchdog.log   追加式日志，每次检查一行
 *   - scripts/STALL_ALERT    只在检测到卡死时创建；恢复后自动删除
 *
 * 跑法：node scripts/watchdog.mjs （建议后台常驻）
 */
import { appendFileSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HEARTBEAT = path.join(root, '.heartbeat')
const LOG = path.join(root, 'scripts', 'watchdog.log')
const ALERT = path.join(root, 'scripts', 'STALL_ALERT')

const INTERVAL_MS = 60_000 // 每分钟一次
const STALL_AFTER_MS = 180_000 // 超过 3 分钟没心跳视为卡死
const DEV_URL = process.env.WATCHDOG_DEV_URL || 'http://127.0.0.1:5173/'

const stamp = () => new Date().toISOString()
const log = (line) => {
  appendFileSync(LOG, `[${stamp()}] ${line}\n`)
  console.log(`[${stamp()}] ${line}`)
}

const ping = async (url) => {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(timer)
    return res.status
  } catch {
    return null
  }
}

let lastAlertAt = 0

for (;;) {
  const now = Date.now()
  const hbAgeMs = existsSync(HEARTBEAT) ? now - statSync(HEARTBEAT).mtimeMs : Infinity
  const stalled = hbAgeMs > STALL_AFTER_MS
  const devStatus = await ping(DEV_URL)

  const hbText = Number.isFinite(hbAgeMs) ? `${Math.round(hbAgeMs / 1000)}s` : '从未写入'
  log(
    `heartbeat=${stalled ? 'STALL' : 'OK'} (age=${hbText}) ` +
      `dev_server=${devStatus ?? 'DOWN'} ` +
      `pid=${process.pid}`
  )

  if (stalled) {
    if (now - lastAlertAt > 10 * 60_000) {
      lastAlertAt = now
      writeFileSync(
        ALERT,
        [
          `STALL detected at ${stamp()}`,
          `last heartbeat age: ${hbText}`,
          `dev server: ${devStatus ?? 'DOWN'}`,
          '',
          'agent 可能已卡死。恢复后请查看当日 memory 日志与 git log 确认断点，',
          '从未完成的步骤继续。',
          '',
        ].join('\n')
      )
      log('!!! STALL ALERT written to scripts/STALL_ALERT')
    }
  } else if (existsSync(ALERT)) {
    rmSync(ALERT)
    log('agent 已恢复，清除 STALL_ALERT')
  }

  await new Promise((r) => setTimeout(r, INTERVAL_MS))
}
