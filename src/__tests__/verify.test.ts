import { describe, it, expect, beforeAll } from 'vitest'
import { Window } from 'happy-dom'
import { staticCheck } from '../verify'

/**
 * staticCheck 在浏览器里直接用 DOMParser；Node 单测环境没有，
 * 这里用 happy-dom 的 Window 注入一个真的 DOMParser 到全局。
 * （不走 vitest 的 happy-dom environment —— 那个环境在本沙箱会挂住。）
 */
beforeAll(() => {
  const win = new Window()
  ;(globalThis as Record<string, unknown>).DOMParser = win.DOMParser
})

/** 一个"没毛病"的页面：所有检查都该沉默 */
const GOOD = `<!doctype html>
<html>
<head><style>body{color:#333}.btn{background:#2563eb}</style></head>
<body>
  <h1>测试页面</h1>
  <p>这是正文内容，足够长，不会触发空页面告警。</p>
  <button class="btn">点我</button>
  <script>
    document.querySelector('.btn').addEventListener('click', function () {
      document.querySelector('h1').textContent = '点了'
    })
  </script>
</body>
</html>`

describe('staticCheck 静态自检', () => {
  it('正常页面零问题', () => {
    expect(staticCheck(GOOD)).toEqual([])
  })

  it('空代码 → 致命', () => {
    const r = staticCheck('')
    expect(r.length).toBe(1)
    expect(r[0].fatal).toBe(true)
  })

  it('<script> 开合不配对 → 致命（页面 JS 整体报废的那种坏）', () => {
    const bad = GOOD.replace('</script>', '')
    const r = staticCheck(bad)
    expect(r.some((x) => x.fatal && x.message.includes('script'))).toBe(true)
  })

  it('重复 id → 点名（getElementById 只能拿到第一个）', () => {
    const bad = GOOD.replace('<h1>', '<h1 id="t">').replace('<p>', '<p id="t">')
    const r = staticCheck(bad)
    expect(r.some((x) => x.message.includes('重复的 id'))).toBe(true)
  })

  it('空页面 → 致命', () => {
    const r = staticCheck('<!doctype html><html><head></head><body> </body></html>')
    expect(r.some((x) => x.fatal)).toBe(true)
  })

  it('表单直拼 action → 点名（会刷新页面）', () => {
    const bad = GOOD.replace(
      '<button class="btn">点我</button>',
      '<form action="/submit"><input name="a"></form>'
    )
    const r = staticCheck(bad)
    expect(r.some((x) => x.message.includes('action'))).toBe(true)
  })

  it('TODO / lorem ipsum 占位 → 点名', () => {
    const bad = GOOD.replace('这是正文内容', 'TODO 待补充')
    const r = staticCheck(bad)
    expect(r.some((x) => x.message.includes('未完成标记'))).toBe(true)
  })

  it('重复 id 检查不受属性顺序影响', () => {
    const bad = GOOD.replace('<h1>', '<h1 id="a" class="x">').replace('<p>', '<p class="y" id="a">')
    const r = staticCheck(bad)
    expect(r.some((x) => x.message.includes('重复的 id'))).toBe(true)
  })
})

describe('staticCheck 悬空选择器（交互期 null 引用）', () => {
  /** 带一个「JS 引用了但全文没定义」的 id 的页面 */
  const danglingId = `<!doctype html><html><head></head><body>
  <h1>标题</h1><p>正文足够长，不会触发空页面告警。</p>
  <script>
    document.getElementById('modal').addEventListener('click', function(){})
  </script>
</body></html>`

  it('悬空 id 引用 → 点名（点了会报 null）', () => {
    const r = staticCheck(danglingId)
    expect(r.some((x) => x.message.includes('querySelector 会返回 null'))).toBe(true)
    expect(r.some((x) => x.message.includes('id="modal"'))).toBe(true)
  })

  it('悬空 class 引用 → 点名', () => {
    const bad = danglingId.replace("getElementById('modal')", "querySelector('.menu-btn')")
    const r = staticCheck(bad)
    expect(r.some((x) => x.message.includes('class="menu-btn"'))).toBe(true)
  })

  it('HTML 里定义了同名 id → 不报', () => {
    const ok = danglingId.replace('<h1>标题', '<div id="modal"></div><h1>标题')
    const r = staticCheck(ok)
    expect(r.some((x) => x.message.includes('querySelector 会返回 null'))).toBe(false)
  })

  it('JS 动态创建（className 赋值）→ 不报（保守跳过）', () => {
    const dyn = `<!doctype html><html><body><p>正文足够长，不会触发空页面告警。</p>
    <script>
      var t = document.createElement('div')
      t.className = 'toast'
      document.body.appendChild(t)
      document.querySelector('.toast').addEventListener('click', function(){})
    </script></body></html>`
    expect(staticCheck(dyn).some((x) => x.message.includes('querySelector 会返回 null'))).toBe(
      false
    )
  })

  it('CSS 里用了同名选择器 → 不报（宁可漏报）', () => {
    const ok = danglingId.replace('</head>', '<style>#modal{display:none}</style></head>')
    const r = staticCheck(ok)
    expect(r.some((x) => x.message.includes('querySelector 会返回 null'))).toBe(false)
  })

  it('模板字符串里动态生成 → 不报', () => {
    const ok = `<!doctype html><html><body><p>正文足够长，不会触发空页面告警。</p>
    <script>
      list.innerHTML = items.map(function(i){ return '<div id="item-' + i + '">' + i + '</div>' }).join('')
    </script></body></html>`
    expect(staticCheck(ok).some((x) => x.message.includes('querySelector 会返回 null'))).toBe(false)
  })
})

describe('staticCheck jQuery 伪类混进原生 querySelector', () => {
  const page = (js: string) =>
    `<!doctype html><html><head></head><body><p>正文足够长，不会触发空页面告警。</p>
    <script>${js}</script></body></html>`

  it(':contains() → 点名（variety 实测抓到的真 bug）', () => {
    const r = staticCheck(page(`document.querySelector('button:contains("预约拍摄")').click()`))
    expect(r.some((x) => x.message.includes('jQuery 专有的伪类'))).toBe(true)
    expect(r.some((x) => x.message.includes(':contains'))).toBe(true)
  })

  it(':first / :eq() 等 jQuery 位置伪类 → 点名', () => {
    expect(
      staticCheck(page(`document.querySelector('.item:first').style.color = 'red'`)).some((x) =>
        x.message.includes('jQuery 专有的伪类')
      )
    ).toBe(true)
    expect(
      staticCheck(page(`document.querySelectorAll('.item:eq(0)')`)).some((x) =>
        x.message.includes('jQuery 专有的伪类')
      )
    ).toBe(true)
  })

  it(':first-child / :last-child 是合法 CSS → 不报', () => {
    const r = staticCheck(page(`document.querySelector('.item:first-child').remove()`))
    expect(r.some((x) => x.message.includes('jQuery 专有的伪类'))).toBe(false)
  })

  it(':hover/:focus/:nth-child 等合法伪类 → 不报', () => {
    const r = staticCheck(
      page(`document.querySelector('button:hover, li:nth-child(2), a:not(.x)')`)
    )
    expect(r.some((x) => x.message.includes('jQuery 专有的伪类'))).toBe(false)
  })

  it('正文文案里的"类型:input"（非选择器调用）→ 不报', () => {
    const r = staticCheck(
      `<!doctype html><html><body><p>填写说明：类型:input 为单行，类型:text 为多行，正文足够长。</p>
      <script>document.querySelector('#real').textContent = 'x'</script></body></html>`
    )
    expect(r.some((x) => x.message.includes('jQuery 专有的伪类'))).toBe(false)
  })
})

describe('staticCheck 表单提交会刷新页面', () => {
  const formPage = (form: string) =>
    `<!doctype html><html><head></head><body><h1>报名</h1><p>正文足够长，不会触发空页面告警。</p>
    ${form}</body></html>`

  it('form 没 action 没拦截 + 有输入框 → 点名（回车即提交）', () => {
    const r = staticCheck(formPage(`<form><input name="email"><button>提交</button></form>`))
    expect(r.some((x) => x.message.includes('阻止默认提交'))).toBe(true)
  })

  it('form 有 onsubmit 属性 → 不报', () => {
    const r = staticCheck(
      formPage(`<form onsubmit="event.preventDefault()"><input name="email"><button>提交</button></form>`)
    )
    expect(r.some((x) => x.message.includes('阻止默认提交'))).toBe(false)
  })

  it('JS 里 addEventListener("submit") + preventDefault → 不报', () => {
    const r = staticCheck(
      formPage(
        `<form><input name="email"><button>提交</button></form>
         <script>document.querySelector('form').addEventListener('submit', function(e){ e.preventDefault() })</script>`
      )
    )
    expect(r.some((x) => x.message.includes('阻止默认提交'))).toBe(false)
  })

  it('form 写了 action="#"（片段导航，不打没状态）→ 不报', () => {
    const r = staticCheck(formPage(`<form action="#"><input name="email"><button>提交</button></form>`))
    expect(r.some((x) => x.message.includes('阻止默认提交'))).toBe(false)
  })

  it('form 里只有 type="button" 的按钮、没有输入框 → 不报', () => {
    const r = staticCheck(formPage(`<form><button type="button">只是开关</button></form>`))
    expect(r.some((x) => x.message.includes('阻止默认提交'))).toBe(false)
  })
})

describe('staticCheck 问题带行号', () => {
  it('悬空选择器报出引用所在行', () => {
    const html = `<!doctype html>
<html>
<body>
  <p>正文足够长，不会触发空页面告警。</p>
  <script>
    document.getElementById('modal').addEventListener('click', function () {})
  </script>
</body>
</html>`
    const issue = staticCheck(html).find((x) => x.message.includes('querySelector 会返回 null'))
    expect(issue).toBeDefined()
    expect(issue!.line).toBe(6)
  })

  it('jQuery 伪类报出选择器所在行', () => {
    const html = `<!doctype html>
<html>
<body>
  <p>正文足够长，不会触发空页面告警。</p>
  <script>
    document.querySelector('button:contains("x")').click()
  </script>
</body>
</html>`
    const issue = staticCheck(html).find((x) => x.message.includes('jQuery 专有的伪类'))
    expect(issue).toBeDefined()
    expect(issue!.line).toBe(6)
  })

  it('表单问题报出 form 所在行', () => {
    const html = `<!doctype html>
<html>
<body>
  <h1>报名</h1>
  <form><input name="e"><button>提交</button></form>
</body>
</html>`
    const issue = staticCheck(html).find((x) => x.message.includes('阻止默认提交'))
    expect(issue).toBeDefined()
    expect(issue!.line).toBe(5)
  })
})
