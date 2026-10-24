#!/usr/bin/env node
/**
 * e2e 全量 runner。
 *
 * 按顺序跑 e2e/ 下所有测试脚本，每个脚本一个独立进程（互不影响，
 * 一个挂了不影响后面的），全部跑完出汇总表；有失败退出码非 0。
 *
 * 用法：
 *   ZHIPU_API_KEY=xxx npm run test:e2e                # 全量
 *   npm run test:e2e -- smoke route-test              # 只跑指定的几个
 *
 * 前置：npm run dev 已在跑（脚本默认打 http://localhost:5173）。
 */
import { readdirSync, mkdirSync, appendFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const KEY = process.env.ZHIPU_API_KEY
if (!KEY) {
  console.error('缺少 ZHIPU_API_KEY 环境变量（智谱开放平台的 Key）')
  process.exit(2)
}

// 命令行给了文件名就跑那几个，否则全量。名字可以不带 .mjs
const wanted = process.argv.slice(2).map((a) => (a.endsWith('.mjs') ? a : `${a}.mjs`))
const all = readdirSync(dir)
  .filter((f) => f.endsWith('.mjs') && f !== 'run-all.mjs')
  .sort()
const files = wanted.length ? all.filter((f) => wanted.includes(f)) : all

if (wanted.length && !files.length) {
  console.error(`没找到匹配的测试文件：${wanted.join(', ')}\n可用的：${all.join(', ')}`)
  process.exit(2)
}

console.log(`将跑 ${files.length} 个测试：${files.join(' ')}`)

// 每个脚本的完整输出落盘到 e2e/logs/ —— 批量挂掉时靠汇总表的几行字
// 定位不了是哪个检查项炸的（模型波动/时序竞态），必须能回看原文
const logDir = path.join(dir, 'logs')
mkdirSync(logDir, { recursive: true })
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')

const results = []
for (const f of files) {
  console.log(`\n${'━'.repeat(64)}\n▶ ${f}\n${'━'.repeat(64)}`)
  const r = spawnSync(process.execPath, [path.join(dir, f)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ZHIPU_API_KEY: KEY },
  })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  process.stdout.write(out)
  appendFileSync(path.join(logDir, `${stamp}-${f}.log`), out)
  results.push({ file: f, code: r.status ?? 1 })
}

console.log(`\n${'═'.repeat(64)}\n汇总\n${'═'.repeat(64)}`)
let failed = 0
for (const r of results) {
  const ok = r.code === 0
  if (!ok) failed++
  console.log(`${ok ? '✅' : '❌'} ${r.file}${ok ? '' : `（退出码 ${r.code}）`}`)
}
console.log(`\n${results.length - failed}/${results.length} 个测试通过`)
console.log(`完整输出已存至 e2e/logs/${stamp}-*.log`)
process.exit(failed ? 1 : 0)
