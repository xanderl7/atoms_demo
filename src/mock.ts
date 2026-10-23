// Step 1 用的假数据：模拟「模型生成的自包含 HTML」
// Step 2 接入真 LLM 之后，这个文件只保留 DEMO_HTML 作为空状态占位

export const DEMO_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<script src="https://cdn.tailwindcss.com"><\/script>
</head>
<body class="min-h-screen bg-slate-950 text-slate-100 grid place-items-center p-8">
  <div class="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
    <h1 class="text-xl font-semibold mb-1">番茄钟</h1>
    <p class="text-sm text-slate-400 mb-6">专注 25 分钟，休息 5 分钟。</p>
    <div class="text-6xl font-mono tabular-nums text-center mb-6" id="time">25:00</div>
    <div class="flex gap-3">
      <button id="start" class="flex-1 rounded-lg bg-indigo-500 hover:bg-indigo-400 py-2.5 font-medium">开始</button>
      <button id="reset" class="rounded-lg border border-slate-700 px-4 py-2.5 text-slate-300 hover:bg-slate-800">重置</button>
    </div>
  </div>
<script>
  let left = 25 * 60, timer = null;
  const el = document.getElementById('time');
  const render = () => el.textContent =
    String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0');
  document.getElementById('start').onclick = () => {
    if (timer) { clearInterval(timer); timer = null; return; }
    timer = setInterval(() => { if (--left <= 0) { clearInterval(timer); timer = null; } render(); }, 1000);
  };
  document.getElementById('reset').onclick = () => { clearInterval(timer); timer = null; left = 25 * 60; render(); };
<\/script>
</body>
</html>`

/** 模拟一次「生成」，Step 2 会被真实 LLM 调用替换 */
export function fakeGenerate(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(
        DEMO_HTML.replace('番茄钟', prompt.slice(0, 12) || '番茄钟')
      )
    }, 900)
  })
}
