import { describe, it, expect } from 'vitest'
import {
  splitBlocks,
  blockCatalog,
  blockBody,
  applyOps,
  parsePatch,
  parseLocate,
  tryLocalPatch,
} from '../patcher'

const HTML = `<!doctype html>
<html>
<head>
<style>
:root { --primary: #2563eb; }
.btn { background: #2563eb; color: #fff; }
</style>
</head>
<body>
<header><h1>测试页面</h1></header>
<section id="about"><h2>关于我们</h2><p>我们是一个团队</p></section>
<section id="works"><h2>作品展示</h2><div class="card">卡片一</div></section>
<footer><p>版权所有</p></footer>
<script>
document.querySelector('.btn').addEventListener('click', function () {})
</script>
</body>
</html>`

describe('splitBlocks 切区块', () => {
  it('切出 header/section/footer，且 id 跨版本稳定', () => {
    const blocks = splitBlocks(HTML)
    const tags = blocks.map((b) => b.tag)
    expect(tags).toContain('header')
    expect(tags).toContain('section')
    expect(tags).toContain('footer')
    // 同样内容再切一遍，id 必须一样（补丁要按 id 对得上）
    const again = splitBlocks(HTML)
    expect(again.map((b) => b.id)).toEqual(blocks.map((b) => b.id))
  })

  it('style / script 也能整块切出来', () => {
    const blocks = splitBlocks(HTML)
    expect(blocks.some((b) => b.tag === 'style')).toBe(true)
    expect(blocks.some((b) => b.tag === 'script')).toBe(true)
  })

  it('blockCatalog 给标题不给正文', () => {
    const cat = blockCatalog(splitBlocks(HTML))
    expect(cat).toContain('关于我们')
    expect(cat).not.toContain('我们是一个团队')
  })

  it('blockBody 能取回正文', () => {
    const blocks = splitBlocks(HTML)
    const about = blocks.find((b) => b.title === '关于我们')!
    expect(blockBody(HTML, blocks, about.id)).toContain('我们是一个团队')
  })
})

describe('tryLocalPatch 本地快改（0 次 LLM）', () => {
  it('改主色：CSS 变量里的主色被换掉', () => {
    const r = tryLocalPatch('把主色改成绿色', HTML)
    expect(r).not.toBeNull()
    expect(r!.html).toContain('#16a34a')
    expect(r!.html).not.toContain('#2563eb')
    expect(r!.note).toContain('没调用模型')
  })

  it('「整体风格换成绿色」是换设计不是改色值 → 不本地动手', () => {
    expect(tryLocalPatch('整体风格换成绿色', HTML)).toBeNull()
  })

  it('删区块：标题被提到的区块整块删掉', () => {
    const r = tryLocalPatch('删掉关于我们这个区块', HTML)
    expect(r).not.toBeNull()
    expect(r!.html).not.toContain('关于我们')
    expect(r!.html).toContain('作品展示') // 别的区块没动
  })

  it('改主标题', () => {
    const r = tryLocalPatch('标题改成「我的主页」', HTML)
    expect(r).not.toBeNull()
    expect(r!.html).toContain('我的主页')
  })

  it('拿不准就返回 null，交给 LLM', () => {
    expect(tryLocalPatch('帮我把整体重新设计一下', HTML)).toBeNull()
  })
})

describe('applyOps 补丁执行', () => {
  const blocks = splitBlocks(HTML)
  const about = blocks.find((b) => b.title === '关于我们')!

  it('replace_text 全局替换', () => {
    const r = applyOps(HTML, [{ type: 'replace_text', from: '我们是一个团队', to: '我们很厉害' }], blocks)
    expect(r.ok).toBe(true)
    expect(r.html).toContain('我们很厉害')
  })

  it('from 在原文里不存在 → 整体拒绝，不改坏', () => {
    const r = applyOps(HTML, [{ type: 'replace_text', from: '不存在的文字', to: 'x' }], blocks)
    expect(r.ok).toBe(false)
    expect(r.html).toBe(HTML)
  })

  it('remove_block 删掉整个区块', () => {
    const r = applyOps(HTML, [{ type: 'remove_block', block: about.id }], blocks)
    expect(r.ok).toBe(true)
    expect(r.html).not.toContain('关于我们')
    expect(r.html).toContain('</html>')
  })

  it('区块 id 不存在 → 拒绝', () => {
    const r = applyOps(HTML, [{ type: 'remove_block', block: 'b_不存在' }], blocks)
    expect(r.ok).toBe(false)
  })

  it('多个块操作从后往前应用，下标不错位', () => {
    const works = blocks.find((b) => b.title === '作品展示')!
    const r = applyOps(
      HTML,
      [
        { type: 'remove_block', block: about.id },
        { type: 'replace_block', block: works.id, content: '<section id="works"><h2>新作品</h2></section>' },
      ],
      blocks
    )
    expect(r.ok).toBe(true)
    expect(r.html).not.toContain('关于我们')
    expect(r.html).toContain('新作品')
  })
})

describe('parsePatch / parseLocate 解析容错', () => {
  it('正常补丁 JSON', () => {
    const p = parsePatch('{"summary":"改了标题","ops":[{"type":"replace_text","from":"a","to":"b"}]}')
    expect(p?.ops.length).toBe(1)
    expect(p?.summary).toBe('改了标题')
  })

  it('字符串里有真实换行也能解析', () => {
    const p = parsePatch('{"summary":"改了\n标题","ops":[{"type":"replace_text","from":"a","to":"b"}]}')
    expect(p?.ops.length).toBe(1)
  })

  it('完全不是 JSON → null（由调用方降级，绝不把原文当结果）', () => {
    expect(parsePatch('我不会做')).toBeNull()
  })

  it('字段缺胳膊少腿的 op 被过滤', () => {
    const p = parsePatch('{"ops":[{"type":"replace_text","from":"a"},{"type":"replace_text","from":"x","to":"y"}]}')
    expect(p?.ops.length).toBe(1)
  })

  it('parseLocate 正常 / 全局 / 坏', () => {
    expect(parseLocate('{"ids":["b_1","b_2"]}')).toEqual(['b_1', 'b_2'])
    expect(parseLocate('{"ids":["*"]}')).toEqual(['*'])
    expect(parseLocate('垃圾')).toBeNull()
  })
})
