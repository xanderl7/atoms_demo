interface Props {
  code: string
  /** 变化时强制重建 iframe（刷新预览 / 重新挂载） */
  reloadKey: number
}

/**
 * 沙箱里没有 allow-same-origin，页面一碰 localStorage 就会抛错。
 * 模型写的代码又很喜欢用 localStorage 存状态 —— 所以先塞一段兜底：
 * 访问真 localStorage 失败时，换成内存版假实现，页面照常跑。
 */
const STORAGE_SHIM = `<script>(function(){try{window.localStorage.getItem('__x')}catch(e){var m={};var s={getItem:function(k){return k in m?m[k]:null},setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}},key:function(i){return Object.keys(m)[i]||null}};Object.defineProperty(window,'localStorage',{value:s,configurable:true});Object.defineProperty(window,'sessionStorage',{value:s,configurable:true})}})();<\/script>`

/** 把兜底脚本插到 <head> 后面。放最前面会触发怪异模式，绝对不行。 */
function withShim(html: string): string {
  const m = html.match(/<head[^>]*>/i)
  if (m && m.index !== undefined) {
    const at = m.index + m[0].length
    return html.slice(0, at) + STORAGE_SHIM + html.slice(at)
  }
  return STORAGE_SHIM + html
}

/**
 * 预览区。iframe 的 key = reloadKey，改 key 就是最干净的「刷新」：
 * 不用手动清 DOM、不用 reload()。
 */
export default function PreviewPane({ code, reloadKey }: Props) {
  if (!code) {
    return <div className="empty">左侧描述你想要的应用<br />生成结果会实时显示在这里</div>
  }

  return (
    <div className="stage">
      <iframe
        key={reloadKey}
        title="preview"
        sandbox="allow-scripts allow-modals allow-forms allow-popups"
        srcDoc={withShim(code)}
      />
    </div>
  )
}
