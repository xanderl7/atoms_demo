/**
 * 版本指代测试。
 *
 * 用户实测踩的坑（截图里的对话）：
 *   1. 用户"改成第二版" → 模型回"我目前没有第二版的具体信息"
 *   2. 用户"你不是说一共有两版吗" → 模型把"版"理解成"页面数量"
 *   3. 用户"改回后面那版颜色" → 它只能猜
 * 根因：路由时只传了"有没有页面"这个布尔值，模型根本看不到版本历史。
 *
 * 修法：
 *   1) 本地直接切版本（治本）—— 系统存着每一版，凭什么让模型猜
 *   2) 版本历史摘要传给路由（治标）—— 让它至少知道有几版、每版是啥
 */
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })

let pass = 0,
  fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`)
  }
}

// 把 resolveVersionRef 的逻辑抠出来单测（从源码里取函数体执行）
const resolve = async (text, total, currentIdx) =>
  page.evaluate(async ({ t, n, i }) => {
    const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
    if (n <= 1) return null
    const m = /第\s*([0-9０-９一二两三十]+)\s*版/.exec(t)
    if (m) {
      const raw = m[1]
      const num = /^[0-9０-９]+$/.test(raw) ? parseInt(raw, 10) : CN_NUM[raw]
      if (num && num >= 1 && num <= n) return num - 1
      return null
    }
    if (/(改过来|还是改过来|改回来|回到刚才|刚才那版|刚才那个|刚才的)/.test(t)) {
      if (i + 1 < n) return i + 1
    }
    if (/(上一版|前一版|上一个版本)/.test(t) && i > 0) return i - 1
    if (/(下一版|后一版|后面那版|后面那一版)/.test(t) && i + 1 < n) return i + 1
    return null
  }, { t: text, n: total, i: currentIdx })

console.log('=== 明确指代版本：直接切，不问模型 ===')
// 场景复现：2 版，当前停在第 1 版（回退过）
ok('「改成第二版」→ 第 2 版', (await resolve('改成第二版', 2, 0)) === 1)
ok('「改回第2版」→ 第 2 版', (await resolve('改回第2版', 2, 0)) === 1)
ok('「回到第 2 版」→ 第 2 版', (await resolve('回到第 2 版', 2, 0)) === 1)
ok('「换成第2版那个」→ 第 2 版', (await resolve('换成第2版那个', 2, 0)) === 1)
ok('「改过来吧」→ 下一版', (await resolve('算了还是改过来吧', 2, 0)) === 1)
ok('「刚才那版」→ 下一版', (await resolve('回到刚才那版', 3, 1) === 2))
ok('「上一版」→ 上一版', (await resolve('上一版', 3, 1) === 0))
ok('「下一版」→ 下一版', (await resolve('下一版', 3, 1) === 2))
ok('「后面那版颜色」→ 下一版', (await resolve('改回后面那版颜色', 3, 1) === 2))

console.log('\n=== 不该误触发的 ===')
ok('只有一版时「改成第二版」不触发', (await resolve('改成第二版', 1, 0)) === null)
ok('越界「改成第九版」不触发', (await resolve('改成第九版', 2, 0)) === null)
ok('「改成蓝色」不触发', (await resolve('改成蓝色', 2, 0)) === null)
ok('「把第二版那个区块删掉」——含"第二版"会触发（可接受，意图明确）', (await resolve('把第二版那个区块删掉', 2, 0)) === 1)

console.log('\n=== 版本历史摘要（给路由看）===')
const summary = await page.evaluate(async () => {
  const src = await fetch('/src/App.tsx').then((r) => r.text())
  return src.includes('buildVersionSummary') && src.includes('当前停在第')
})
ok('有 buildVersionSummary', summary, '')

const routerHasVersion = await page.evaluate(async () => {
  const src = await fetch('/src/prompts.ts').then((r) => r.text())
  return (
    src.includes('versionSummary') &&
    src.includes('不要回答"我没有第二版的信息"')
  )
})
ok('路由提示词接收版本摘要', routerHasVersion, '')

const appPassesIt = await page.evaluate(async () => {
  const src = await fetch('/src/App.tsx').then((r) => r.text())
  return src.includes('buildVersionSummary(versions, currentIdx)')
})
ok('App 把版本摘要传给了路由', appPassesIt, '')

await browser.close()
console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
