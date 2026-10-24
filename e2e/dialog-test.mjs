/**
 * 预览区弹框测试。
 *
 * 用户反馈：经常莫名其妙弹出一个 "localhost:5173 says" 的空对话框。
 * 根因：探针脚本里有一行 origAlert('')，真的调了一次空 alert，
 * 而 iframe 又开了 allow-modals —— 浏览器就弹了原生框。
 *
 * 目标：
 *   1. 任何情况下都不出现浏览器原生对话框（Playwright 的 dialog 事件）
 *   2. 页面自己调 alert() 时，改成页面内提示条（data-atoms-toast）
 */
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })

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

// 抓所有浏览器原生弹框
const nativeDialogs = []
page.on('dialog', async (d) => {
  nativeDialogs.push(`${d.type()}: ${d.message()}`)
  await d.dismiss().catch(() => {})
})

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })

console.log('=== 1) 探针自己不该调 alert ===')
// 直接把探针注入一段含 alert 的 HTML，看会不会弹原生框
const probeResult = await page.evaluate(async () => {
  const mod = await import('/src/iframeProbe.ts')
  const html = mod.withProbe('<!DOCTYPE html><html><head><title>t</title></head><body><p>hi</p></body></html>')
  // 探针里如果还有空 alert 的探测代码，这里执行一次就会弹框
  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups')
  iframe.srcdoc = html
  document.body.appendChild(iframe)
  await new Promise((r) => setTimeout(r, 800))
  return { hasDoctypeFirst: html.trimStart().startsWith('<!DOCTYPE') }
})
await page.waitForTimeout(1200)
ok('注入后 doctype 仍在最前（没触发怪异模式）', probeResult.hasDoctypeFirst)
ok('加载带探针的页面不弹原生框', nativeDialogs.length === 0, nativeDialogs.join(' | '))

console.log('\n=== 2) 页面自己调 alert 时，改成页面内提示条 ===')
await page.evaluate(async () => {
  const mod = await import('/src/iframeProbe.ts')
  const html = mod.withProbe(
    `<!DOCTYPE html><html><head><title>t</title></head><body>
     <button id="b">点我</button>
     <script>
       document.getElementById('b').addEventListener('click', function(){
         alert('已收到你的留言');
       });
     <\/script></body></html>`
  )
  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups')
  iframe.srcdoc = html
  iframe.id = 'alert-probe'
  document.body.appendChild(iframe)
})
await page.waitForTimeout(800)
// 点 iframe 里的按钮
const fr = page.frameLocator('#alert-probe')
await fr.locator('#b').click()
await page.waitForTimeout(600)

ok('点 alert 按钮没有原生弹框', nativeDialogs.length === 0, nativeDialogs.join(' | '))
const toastCount = await fr.locator('[data-atoms-toast]').count()
ok('页面里出现了提示条', toastCount > 0, `toast 数量 ${toastCount}`)
const toastText = toastCount ? await fr.locator('[data-atoms-toast]').first().textContent() : ''
ok('提示条内容是原始消息', toastText === '已收到你的留言', `实际 "${toastText}"`)

console.log('\n=== 3) confirm / prompt 也不弹原生框 ===')
await page.evaluate(async () => {
  const mod = await import('/src/iframeProbe.ts')
  const html = mod.withProbe(
    `<!DOCTYPE html><html><head><title>t</title></head><body>
     <button id="c">confirm</button>
     <button id="p">prompt</button>
     <script>
       document.getElementById('c').addEventListener('click', function(){ window.confirm('确定吗'); });
       document.getElementById('p').addEventListener('click', function(){ window.prompt('你的名字'); });
     <\/script></body></html>`
  )
  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups')
  iframe.srcdoc = html
  iframe.id = 'modal-probe'
  document.body.appendChild(iframe)
})
await page.waitForTimeout(800)
const fr2 = page.frameLocator('#modal-probe')
await fr2.locator('#c').click()
await page.waitForTimeout(400)
await fr2.locator('#p').click()
await page.waitForTimeout(600)
ok('confirm/prompt 也没有原生弹框', nativeDialogs.length === 0, nativeDialogs.join(' | '))

console.log('\n=== 4) 真的错误还是要能报出来 ===')
// 注意：监听器必须【先注册】再注入 iframe —— 错误在页面加载时就抛了，
// 后注册会错过（这是测试写法问题，不是代码问题）
const errPromise = page.evaluate(
  () =>
    new Promise((resolve) => {
      const onMsg = (e) => {
        if (e.data?.__atomsProbe === 1 && e.data.kind === 'error') {
          window.removeEventListener('message', onMsg)
          resolve(e.data.message)
        }
      }
      window.addEventListener('message', onMsg)
      setTimeout(() => resolve(null), 5000)
    })
)
await page.evaluate(async () => {
  const mod = await import('/src/iframeProbe.ts')
  const html = mod.withProbe(
    `<!DOCTYPE html><html><head><title>t</title></head><body>
     <script>window.addEventListener('DOMContentLoaded', function(){ null.foo; });<\/script>
     </body></html>`
  )
  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups')
  iframe.srcdoc = html
  iframe.id = 'err-probe'
  document.body.appendChild(iframe)
})
const errSeen = await errPromise
ok('JS 报错还是能传回主应用', !!errSeen, `收到 "${errSeen}"`)

await browser.close()
console.log(`\n原生弹框总计：${nativeDialogs.length} 个`)
console.log(`结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
