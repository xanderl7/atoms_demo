/**
 * 预览区报错条测试。
 *
 * 用户反馈：预览区报"7 个运行时报错"，全是"未知错误"，但页面本身是好的。
 * 根因：探针用 capture 阶段监听 error，把【资源加载失败】（图片挂了、
 * CDN 被墙）也当成了 JS 错误。这类事件 target 是 <img> 元素、message 是空的，
 * 报上去就变成"未知错误"。
 *
 * 目标：
 *   1. 图片加载失败 → 不报错
 *   2. 真的 JS 错误 → 照常报，消息是真实的
 *   3. 换版本（resetKey 变化）→ 旧错误被清空
 *   4. 报错条默认折叠，不遮挡预览区
 */
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

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

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
// 必须等应用 hydrate 完再制造错误 —— useIframeErrors 的 message 监听器
// 挂在 React 挂载之后，早于此的错误消息直接丢，报错条就永远不出现
// （批量跑时 dev server 冷启动慢，这里等不到就会时好时坏）
await page.waitForSelector('.composer textarea')

/** 在页面里建一个 iframe 并收集它报回来的错误 */
const probeIframe = async (html) =>
  page.evaluate(async (h) => {
    const mod = await import('/src/iframeProbe.ts')
    const iframe = document.createElement('iframe')
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups')
    iframe.srcdoc = mod.withProbe(h)
    iframe.id = 'probe-' + Math.random().toString(36).slice(2, 7)
    document.body.appendChild(iframe)
    return iframe.id
  }, html)

/** 等一段时间收集 probe 消息 */
const collect = async (ms) =>
  page.evaluate(
    (t) =>
      new Promise((resolve) => {
        const seen = []
        const onMsg = (e) => {
          if (e.data?.__atomsProbe === 1) seen.push({ kind: e.data.kind, message: e.data.message })
        }
        window.addEventListener('message', onMsg)
        setTimeout(() => {
          window.removeEventListener('message', onMsg)
          resolve(seen)
        }, t)
      }),
    ms
  )

console.log('=== 1) 图片加载失败不该报成"未知错误" ===')
// 构造 7 张必定挂掉的图 —— 复现用户截图里的"7 个错误"
let brokenImgs = ''
for (let i = 0; i < 7; i++) {
  brokenImgs += `<img src="https://picsum.photos/seed/x${i}/800/600" data-placeholder="img">`
}
const id1 = await probeIframe(
  `<!DOCTYPE html><html><head><title>t</title></head><body>${brokenImgs}</body></html>`
)
await page.waitForTimeout(800)
const r1 = await collect(3000)
const unknown = r1.filter((x) => x.kind === 'error' && x.message === '未知错误')
ok('资源加载失败 0 个误报', unknown.length === 0, `误报 ${unknown.length} 个`)

console.log('\n=== 2) 真的 JS 错误还是要报 ===')
const id2 = await probeIframe(
  `<!DOCTYPE html><html><head><title>t</title></head><body>
   <script>window.addEventListener('DOMContentLoaded', function(){ null.foo; });<\/script>
   </body></html>`
)
const r2 = await collect(2000)
const realErr = r2.find((x) => x.kind === 'error')
ok('JS 错误被报出来', !!realErr, realErr ? `"${realErr.message}"` : '没收到')
ok('错误消息是真实的（不是"未知错误"）', realErr && realErr.message !== '未知错误')
ok('错误消息含具体内容', !!realErr && realErr.message.includes('null'), '')

console.log('\n=== 3) 换版本要清空旧错误 ===')
// 直接调 hook 不方便，改用源码契约验证：resetKey 变化必须让旧错误作废。
// 实现从「effect 里 setErrors([])」改成了「渲染期按 key 派生」——
// 行为契约不变（resetKey 一变，旧错误立刻不算数），所以这里断言新契约。
const cleared = await page.evaluate(() => {
  return import('/src/iframeProbe.ts').then((m) => {
    const src = m.useIframeErrors.toString()
    return /resetKey/.test(src) && /state\.key === resetKey/.test(src)
  })
})
ok('useIframeErrors 支持 resetKey 清空', cleared, '')

console.log('\n=== 4) 报错条默认折叠 ===')
// 往主应用塞一条假错误，看报错条是不是只显示标题行
await page.evaluate(() => {
  window.postMessage(
    { __atomsProbe: 1, kind: 'error', message: 'Uncaught TypeError: test', extra: { line: 12 } },
    '*'
  )
})
await page.waitForTimeout(600)
const bar = await page.evaluate(() => {
  const el = document.querySelector('.frame-errors')
  if (!el) return null
  const items = el.querySelectorAll('.fe-item')
  const toggle = el.querySelector('.fe-toggle')
  const r = el.getBoundingClientRect()
  return { count: items.length, hasToggle: !!toggle, h: Math.round(r.height) }
})
ok('报错条出现了', !!bar)
ok('默认折叠（看不到错误详情）', bar && bar.count === 0, `可见条目 ${bar?.count}`)
ok('高度很小，不遮挡预览', bar && bar.h < 60, `高度 ${bar?.h}px`)
ok('有"详情"按钮', bar && bar.hasToggle)

// 点开详情
await page.click('.fe-toggle').catch(() => {})
await page.waitForTimeout(300)
const expanded = await page.evaluate(() => {
  const items = document.querySelectorAll('.frame-errors .fe-item')
  const toggle = document.querySelector('.fe-toggle')
  return { count: items.length, text: toggle?.textContent }
})
ok('点"详情"能展开', expanded.count > 0, `条目 ${expanded.count}`)
ok('展开后按钮变"收起"', expanded.text === '收起', `实际"${expanded.text}"`)

await browser.close()
console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
