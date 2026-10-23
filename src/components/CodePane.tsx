interface Props {
  code: string
}

/** 代码视图。Step 1 只做等宽 + 行号，Step 7 再考虑引入高亮。 */
export default function CodePane({ code }: Props) {
  if (!code) return <div className="empty">暂无代码</div>

  return (
    <pre className="code">
      {code.split('\n').map((line, i) => (
        <div key={i}>
          <span className="ln">{i + 1}</span>
          {line}
        </div>
      ))}
    </pre>
  )
}
