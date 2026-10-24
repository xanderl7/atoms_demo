import { useEffect, useState } from 'react'

/**
 * iframe 里的错误捕获桥。
 *
 * 问题背景：生成的页面在 iframe 沙箱里跑，出了错（比如表单没绑事件、
 * JS 抛异常）用户在预览里完全看不到 —— 表现就是"点了没反应"，
 * 但主应用这边一声不吭，根本不知道该修什么。
 *
 * 做法：在 iframe 里注入一段脚本，捕获 error / unhandledrejection，
 * 通过 postMessage 把错误传回主应用。
 */

export interface IframeError {
  message: string
  source?: string
  line?: number
  stack?: string
  at: number
  /** error = 真错误（显示红色报错条）；info = 只是提示（比如页面调了 alert） */
  kind?: 'error' | 'info'
}

/**
 * 把一段 <script> 安全地塞进 HTML。
 *
 * 关键：绝不能插到 <!DOCTYPE html> 前面 —— 那样浏览器会进入怪异模式，
 * 盒模型和百分比宽度全乱，页面样式直接崩。所以按优先级找插入点：
 *   <head> 内 → <html> 后 → </body> 前 → 文档末尾
 */
export function injectScript(html: string, script: string): string {
  const head = html.match(/<head[^>]*>/i)
  if (head && head.index !== undefined) {
    const at = head.index + head[0].length
    return html.slice(0, at) + script + html.slice(at)
  }
  const htmlTag = html.match(/<html[^>]*>/i)
  if (htmlTag && htmlTag.index !== undefined) {
    const at = htmlTag.index + htmlTag[0].length
    return html.slice(0, at) + script + html.slice(at)
  }
  const bodyEnd = html.match(/<\/body>/i)
  if (bodyEnd && bodyEnd.index !== undefined) {
    return html.slice(0, bodyEnd.index) + script + html.slice(bodyEnd.index)
  }
  return html + script
}

/**
 * 注入到 iframe 里的探针（纯 JS 源码，不带 <script> 包裹）。
 * 单独导出是为了单测：测试里可以用桩对象 eval 这段代码，
 * 验证"JS 错误报、script 解析失败报、图片加载失败不报"的分类逻辑。
 *
 * 注意：这段代码本身不能有语法错误，否则会把整个页面搞挂。
 */
export const ERROR_PROBE_SOURCE = `(function(){
var send=function(kind,msg,extra){
  try{
    parent.postMessage({__atomsProbe:1,kind:kind,message:String(msg),extra:extra||null},'*');
  }catch(e){}
};
window.addEventListener('error',function(e){
  if (!e) return;
  // target 不是 window 的情况分两种，必须区别对待：
  //
  // ① target 是 <script> 元素 = 【JS 解析失败】（语法错误）。
  //    这种错误的 message 是空的，以前被当成"资源错误"一刀切滤掉 ——
  //    结果页面脚本整体报废、交互全死，预览区却一声不吭，
  //    用户只看到"点了没反应"，我们这边也不知道该修什么。
  //    它是真 bug，必须报。
  //
  // ② target 是 <img>/<link> 等 = 资源加载失败（图片挂了、CDN 被墙）。
  //    那不是 JS 错误，报上去只会显示成"未知错误"，纯误导用户，滤掉。
  var t=e.target;
  if(t&&t!==window){
    if(t.tagName==='SCRIPT'){
      send('error','页面内的 <script> 解析失败（JS 有语法错误，整个脚本都不会执行）',{source:t.src||'（内联脚本）'});
    }
    return;
  }
  if (!e.message) return;
  send('error',e.message,{source:e.filename,line:e.lineno,stack:e.error&&e.error.stack});
},true);
window.addEventListener('unhandledrejection',function(e){
  var r=e.reason;
  send('error',(r&&r.message)?r.message:('Promise 未捕获异常: '+r),{stack:r&&r.stack});
});

// ── 把 alert / confirm / prompt 换成「页面内提示条」 ──────────────
// 为什么：原生弹窗会盖到浏览器最上层。沙箱里没有 allow-modals 时浏览器
// 会拦掉它，用户就什么都收不到；而开着 allow-modals 又会弹出一个
// 空白对话框（"localhost:5173 says"），用户完全不知道是什么、关不掉。
// 所以这里自己接住，改成页面顶部飘一条小提示。
function toast(text){
  try{
    var host=document.body||document.documentElement;
    if(!host) return;
    var el=document.createElement('div');
    el.setAttribute('data-atoms-toast','1');
    el.textContent=String(text==null?'':text);
    el.style.cssText='position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483647;max-width:80vw;padding:10px 16px;border-radius:10px;background:rgba(17,24,39,.94);color:#fff;font:14px/1.5 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35);pointer-events:none;';
    host.appendChild(el);
    setTimeout(function(){ if(el.parentNode) el.parentNode.removeChild(el); },3200);
  }catch(e){}
}
window.alert=function(msg){ toast(msg); };
window.confirm=function(msg){ toast(msg==null?'':msg+'（已自动确认）'); return true; };
window.prompt=function(msg,def){ toast(msg==null?'':msg); return def==null?'':def; };
})();`

/** 把探针包成 <script> 注入页面 */
export const ERROR_PROBE = `<script>${ERROR_PROBE_SOURCE}</script>`

/**
 * 把探针插进 HTML（位置安全，不会触发怪异模式）
 */
export function withProbe(html: string): string {
  return injectScript(html, ERROR_PROBE)
}

/**
 * 在主应用里监听 iframe 传来的错误。
 *
 * resetKey：换版本 / 刷新预览时变化的值。变化就清空旧错误 ——
 * 否则上一页的错误会一直挂在预览区，用户看到的是不存在的"运行时问题"。
 *
 * 清空用「渲染期派生」而不是 useEffect 里 setState：resetKey 变了，
 * 本次渲染直接算出空列表，旧错误自然消失，不触发二次渲染。
 */
export function useIframeErrors(resetKey?: number | string): IframeError[] {
  const [state, setState] = useState<{ key: number | string | undefined; items: IframeError[] }>(
    { key: resetKey, items: [] }
  )
  // resetKey 变了 → 旧作废，直接当空列表用
  const errors = state.key === resetKey ? state.items : []

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data
      if (!d || d.__atomsProbe !== 1) return
      const item: IframeError = {
        message: d.message || '未知错误',
        source: d.extra?.source,
        line: d.extra?.line,
        stack: d.extra?.stack,
        at: Date.now(),
        kind: d.kind === 'info' ? 'info' : 'error',
      }
      // 同一个错误只报一次，避免刷屏
      setState((prev) => {
        const base = prev.key === resetKey ? prev.items : []
        if (base.some((x) => x.message === item.message && Math.abs(x.at - item.at) < 3000)) {
          return { key: resetKey, items: base }
        }
        return { key: resetKey, items: [...base, item].slice(-10) }
      })
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [resetKey])

  return errors
}
