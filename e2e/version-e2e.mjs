/**
 * 端到端复现用户截图里的"笨"对话。
 *
 * 截图流程：
 *   改成白底蓝字 → 改回去吧 → 算了还是改过来吧 → 改成第二版
 *   → 你不是说一共有两版吗 → 改回后面那版颜色
 *
 * 之前模型的表现：问"你想把哪里改成什么样"、回"我没有第二版的具体信息"、
 * 把"版"理解成"页面数量"。
 *
 * 现在期望：指代版本的话直接切版本，不问模型、不重新生成。
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

const KEY = fs.readFileSync(new URL('./zhipu-key.txt', import.meta.url), 'utf8').trim()

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.evaluate((k) => {
  localStorage.setItem(
    'atoms-demo.llm-config',
    JSON.stringify({ apiKey: k, baseURL: '/zhipu', model: 'glm-4.5-air' }),
  )
}, KEY)
await page.reload({ waitUntil: 'networkidle' })

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

const say = async (t) => {
  await page.fill('textarea', t)
  await page.click('.send')
  // 必须等生成真正结束（停止按钮变回"发送"）再发下一条。
  // 用固定 sleep 会把上一条的流式生成中断掉，整个流程全乱。
  await page
    .waitForSelector('button.send:not(.stop)', { timeout: 300000 })
    .catch(() => console.log('  （等待超时）'))
  await page.waitForTimeout(1500)
}
const lastReply = async () =>
  page.evaluate(() => {
    const b = [...document.querySelectorAll('.bubble.assistant')]
    return b[b.length - 1]?.textContent || ''
  })
const versionCount = async () =>
  page.evaluate(() => document.querySelectorAll('.bubble.assistant').length)

console.log('=== 第 1 步：生成第 1 版 ===')
await say('做一个咖啡店单页落地页，深色背景配亮色文字，含导航、3 个区块和页脚')
const v1 = await page.evaluate(() => document.querySelector('.stage iframe')?.srcdoc ?? '')
ok('第 1 版生成成功', v1.length > 1000, `${v1.length} 字符`)
const v1IsDark = /background[^;]*#0|background[^;]*#1|background[^;]*#2|background:\s*(#0|#1|#2|rgb\(1[0-9]|rgb\(2[0-9]|rgb\(3[0-9])/i.test(v1)
console.log(`  第 1 版是深色底：${v1IsDark}`)

console.log('\n=== 第 2 步：改成白底蓝字（造出第 2 版）===')
await say('改成白底蓝字')
await page.waitForTimeout(3000)
const v2 = await page.evaluate(() => document.querySelector('.stage iframe')?.srcdoc ?? '')
ok('第 2 版和白底蓝字不同', v2 !== v1, `${v2.length} 字符`)

console.log('\n=== 第 3 步：「改回去吧」→ 回第 1 版 ===')
await say('改回去吧')
const back = await page.evaluate(() => document.querySelector('.stage iframe')?.srcdoc ?? '')
ok('回到了第 1 版（深色）', back === v1, back === v1 ? '字节级相同' : '不一致')
ok('回复说明是版本切换、没重新生成', /没有重新生成|直接切/.test(await lastReply()), '')

console.log('\n=== 第 4 步：「算了还是改过来吧」→ 回第 2 版 ===')
await say('算了还是改过来吧')
const fwd = await page.evaluate(() => document.querySelector('.stage iframe')?.srcdoc ?? '')
ok('回到了第 2 版（白底蓝字）', fwd === v2, fwd === v2 ? '字节级相同' : '不一致')
const r4 = await lastReply()
ok('没有反问"你想改哪里"', !/你想把哪里|要改成什么样/.test(r4), r4.slice(0, 80))
ok('没有说"没有第二版"', !/没有第二版|没有.*具体信息/.test(r4), '')

console.log('\n=== 第 5 步：「改成第二版」→ 当前已是第 2 版，应被告知而非重新生成 ===')
await say('改成第二版')
const r5 = await lastReply()
console.log('  回复：' + r5.slice(0, 120))
ok('没有说"我没有第二版的具体信息"', !/没有第二版|没有.*具体信息/.test(r5), '')
ok('没有把"版"当成页面数量', !/只输出一个页面|一个页面/.test(r5), '')
ok('明确告知当前就在第 2 版', /已经在第 2 版/.test(r5), '')
ok('没有重新生成', !/已生成|正在生成代码/.test(r5), '')

console.log('\n=== 第 6 步：全程只在第 2 步真正生成过一次 ===')
const replies = await page.evaluate(() =>
  [...document.querySelectorAll('.bubble.assistant')].map((b) => b.textContent || '')
)
const regenCount = replies.filter((r) => /正在生成代码|已生成/.test(r)).length
console.log(`  触发生成的次数：${regenCount}`)
ok('指代版本没有再触发生成', regenCount === 1, `${regenCount} 次`)

await browser.close()
console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
