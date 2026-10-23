interface Props {
  code: string
  /** 变化时强制重建 iframe（刷新预览 / 重新挂载） */
  reloadKey: number
}

/**
 * 预览区。iframe 的 key = reloadKey，改 key 就是最干净的「刷新」：
 * 不用手动清 DOM、不用 reload()。Step 3 会在这里加错误捕获。
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
        srcDoc={code}
      />
    </div>
  )
}
