import { describe, it, expect } from 'vitest'
import {
  extractHtml,
  compressCode,
  codeSkeleton,
  parseRouter,
  buildFixMessages,
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
