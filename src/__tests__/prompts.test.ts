import { describe, it, expect } from 'vitest'
import {
  extractHtml,
  compressCode,
  codeSkeleton,
  parseRouter,
  buildFixMessages,
  buildCodeMessages,
  buildRouterMessages,
  SYSTEM_FIX,
} from '../prompts'

describe('extractHtml 从模型输出里抠 HTML', () => {
  it('优先吃代码围栏', () => {
    const raw = '好的，这是结果：\n```html\n<!doctype html><html><body>x</body></html>\n```\n完'
    expect(extractHtml(raw)).toBe('<!doctype html><html><body>x</body></html>')
  })

  it('没有围栏时从 <html> 开始吃', () => {
    const raw = '前言前言\n<!doctype html><html><body>x</body></html>'
    expect(extractHtml(raw)).toBe('<!doctype html><html><body>x</body></html>')
  })

  it('啥都没有就原样返回（交给调用方判长度）', () => {
    expect(extractHtml('  hello  ')).toBe('hello')
  })
})

describe('compressCode 压缩', () => {
  it('去注释和多余空行', () => {
    const code = '<style>\n/* 注释 */\n.a{color:red}\n\n\n\n.b{color:blue}\n</style>'
    const out = compressCode(code)
    expect(out).not.toContain('注释')
    expect(out).not.toContain('\n\n\n')
    expect(out).toContain('.a{color:red}')
  })
})

describe('codeSkeleton 骨架', () => {
  it('列出区块标题和体量', () => {
    const html =
      '<!doctype html><html><head><style>.a{}</style></head><body><section><h2>关于</h2><p>x</p></section></body></html>'
    const sk = codeSkeleton(html)
    expect(sk).toContain('关于')
    expect(sk).toContain('字符')
  })
})

describe('buildFixMessages 自检修复消息', () => {
  it('带上问题清单和完整代码', () => {
    const [sys, user] = buildFixMessages('<html><body>x</body></html>', [
      { message: '重复的 id：a' },
      { message: 'x is not defined', line: 12 },
    ])
    expect(sys.content).toBe(SYSTEM_FIX)
    expect(user.content).toContain('重复的 id：a')
    expect(user.content).toContain('第 12 行')
    expect(user.content).toContain('<html><body>x</body></html>')
  })
})

describe('parseRouter 路由 JSON 三层容错', () => {
  it('正常 JSON', () => {
    const r = parseRouter('{"intent":"build","plan":"- a\\n- b"}')
    expect(r.intent).toBe('build')
    expect(r.plan).toBe('- a\n- b')
  })

  it('字符串里有真实换行 → 修复后能解析', () => {
    const r = parseRouter('{"intent":"build","plan":"- 第一行\n- 第二行"}')
    expect(r.intent).toBe('build')
    expect(r.plan).toContain('第一行')
  })

  it('整体坏了但字段还在 → 逐字段抠', () => {
    const r = parseRouter('{"intent":"chat","reply":"你好呀", oops}')
    expect(r.intent).toBe('chat')
    expect(r.reply).toBe('你好呀')
  })

  it('彻底坏 → 绝不给 build 以外的猜测，也不漏原文', () => {
    const r = parseRouter('完全不是 JSON 的一段话')
    expect(r.intent).toBe('build')
    expect(r.reply).toBe('')
  })

  it('未知 intent → 兜底 build', () => {
    const r = parseRouter('{"intent":"something_else"}')
    expect(r.intent).toBe('build')
  })
})

describe('buildCodeMessages 最初的需求（推倒重做专用）', () => {
  it('传了 originalPrompt → 用户消息里带「最初的需求」', () => {
    const msgs = buildCodeMessages('推倒重做，出一个全新的第三版', '- 按最初需求重做', null, '写个最简单的hello world')
    const user = msgs[1].content
    expect(user).toContain('推倒重做')
    expect(user).toContain('按最初需求重做')
    expect(user).toContain('最初的需求（这一版的出发点）')
    expect(user).toContain('写个最简单的hello world')
  })

  it('不传 originalPrompt → 不出现这段（普通修改流程零影响）', () => {
    const msgs = buildCodeMessages('改成绿色', '- 主色改绿', '<html>旧页面</html>')
    expect(msgs[1].content).not.toContain('最初的需求')
    expect(msgs[1].content).toContain('旧页面') // 普通流程照旧喂上一版
  })

  it('rebuild 场景 prevCode 传 null → 不喂上一版代码', () => {
    const msgs = buildCodeMessages('推倒重做', '- 重做', null, 'hello world')
    expect(msgs[1].content).not.toContain('上一版')
    expect(msgs[1].content).not.toContain('增量修改')
  })
})

describe('buildRouterMessages 推倒重做的锚点规则', () => {
  it('有版本时，提示词包含「锚点是最初的需求」', () => {
    const msgs = buildRouterMessages('推倒重做，出一个全新的第三版', true, [], '版本历史（共 2 版）')
    expect(msgs[0].content).toContain('推倒重做的锚点是最初的需求')
    expect(msgs[0].content).toContain('中间轮次改过的样式')
    expect(msgs[0].content).toContain('【不要】带进新版本')
  })

  it('不满且说清了偏差 → 引导判 build 而不是 probe', () => {
    const msgs = buildRouterMessages('完全不是hello world了', true)
    expect(msgs[0].content).toContain('不满【且说清了偏差】')
    expect(msgs[0].content).toContain('回到最初的需求')
  })

  it('指代不存在的版本 → 引导把选项框成"基于最初需求重做"', () => {
    const msgs = buildRouterMessages('算了第三版', true, [], '版本历史（共 2 版）')
    expect(msgs[0].content).toContain('基于最初需求重做一版新的')
  })
})
