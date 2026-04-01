import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import { useGraphStore } from '../../stores/graphStore'
import { useOperation } from '../../hooks/useOperation'
import type { StreamEvent } from '../../types'

interface Props { onClose: () => void }

type Mode = 'auto' | 'create' | 'expand' | 'query' | 'connect'

const MODE_LABELS: Record<Mode, string> = {
  auto: '自动完善',
  create: '创建图谱',
  expand: '展开节点',
  query: '自由查询',
  connect: '发现连接',
}

export function AgentPanel({ onClose }: Props) {
  const { activeGraphId, streamEvents, isStreaming, activeGraph } = useGraphStore()
  const { run } = useOperation()
  const [mode, setMode] = useState<Mode>('auto')
  const [input, setInput] = useState('')
  const [currentOpId, setCurrentOpId] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [streamEvents])

  if (!activeGraphId) return null

  const nodeLabels = Object.values(activeGraph?.graph_data?.nodes ?? {}).map((n) => n.label)

  async function handleRun() {
    if (!activeGraphId || isStreaming) return
    setCurrentOpId(null)
    await run(async () => {
      let op: { operation_id: string }
      if (mode === 'auto') op = await api.agentAuto(activeGraphId)
      else if (mode === 'create') op = await api.agentCreate(activeGraphId, input || '构建知识图谱')
      else if (mode === 'expand') op = await api.agentExpand(activeGraphId, input)
      else if (mode === 'query') op = await api.agentQuery(activeGraphId, input)
      else op = await api.agentConnect(activeGraphId)
      setCurrentOpId(op.operation_id)
      return op
    })
  }

  async function handleCancel() {
    if (currentOpId) {
      await api.cancelOperation(currentOpId)
    }
  }

  const needsInput = mode === 'create' || mode === 'expand' || mode === 'query'

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between shrink-0" style={{ borderColor: 'var(--border)' }}>
        <span className="text-sm font-semibold text-[var(--text)]">⚡ Agent</span>
        <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-sm">✕</button>
      </div>

      {/* Mode selector */}
      <div className="px-3 py-2 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
        <div className="flex flex-wrap gap-1">
          {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2 py-1 text-[11px] rounded border transition-colors ${
                mode === m
                  ? 'bg-[var(--accent-dim)] border-[var(--accent-dim)] text-[var(--accent)]'
                  : 'border-[var(--border-2)] text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {/* Input */}
      {needsInput && (
        <div className="px-3 py-2 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
          {mode === 'expand' ? (
            <select
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="w-full px-2 py-1.5 text-xs rounded border bg-transparent outline-none focus:border-[var(--accent)]"
              style={{ borderColor: 'var(--border-2)', color: 'var(--text)', background: 'var(--surface-2)' }}
            >
              <option value="">选择节点...</option>
              {nodeLabels.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          ) : (
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={mode === 'create' ? '描述要构建的知识领域...' : '输入查询内容...'}
              rows={3}
              className="w-full px-2 py-1.5 text-xs rounded border bg-transparent outline-none resize-none focus:border-[var(--accent)]"
              style={{ borderColor: 'var(--border-2)', color: 'var(--text)' }}
            />
          )}
        </div>
      )}

      {/* Stream log */}
      <div ref={logRef} className="flex-1 overflow-y-auto p-3 flex flex-col gap-1 min-h-0">
        {streamEvents.length === 0 && !isStreaming && (
          <p className="text-[var(--text-muted)] text-xs text-center mt-4">
            选择模式后点击运行
          </p>
        )}
        {streamEvents.map((e, i) => <LogLine key={i} event={e} />)}
        {isStreaming && (
          <div className="flex items-center gap-2 text-[var(--warn)] text-xs mono mt-1">
            <span className="animate-spin">◎</span>
            <span>Agent 运行中...</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-3 py-3 border-t shrink-0 flex gap-2" style={{ borderColor: 'var(--border)' }}>
        {isStreaming ? (
          <button
            onClick={handleCancel}
            className="flex-1 py-2 text-xs rounded border border-[var(--error)] text-[var(--error)] hover:bg-[var(--error-dim)] transition-colors"
          >
            停止
          </button>
        ) : (
          <button
            onClick={handleRun}
            className="flex-1 py-2 text-xs rounded border border-[var(--accent-dim)] text-[var(--accent)] hover:bg-[var(--accent-dim)] transition-colors font-medium"
          >
            运行 {MODE_LABELS[mode]}
          </button>
        )}
      </div>
    </div>
  )
}

function LogLine({ event }: { event: StreamEvent }) {
  if (event.type === 'heartbeat') return null

  if (event.type === 'started') {
    return <div className="text-[var(--text-muted)] text-[11px] mono">── 开始 ──</div>
  }
  if (event.type === 'tool_call') {
    return (
      <div className="text-[11px] mono flex items-center gap-2">
        <span className="text-[var(--text-muted)]">T{event.turn}</span>
        <span className="text-[var(--info)]">{event.tool}</span>
        {event.duration_ms && <span className="text-[var(--text-muted)]">{event.duration_ms}ms</span>}
      </div>
    )
  }
  if (event.type === 'turn_end') {
    return (
      <div className="text-[11px] mono text-[var(--text-muted)]">
        turn {event.turn} · {event.tool_calls} tools
      </div>
    )
  }
  if (event.type === 'done') {
    return (
      <div className="mt-1">
        <div className="text-[var(--accent)] text-[11px] mono">── 完成 {event.duration?.toFixed(1)}s ──</div>
        {event.result && (
          <div className="mt-1 text-xs text-[var(--text)] leading-relaxed whitespace-pre-wrap border-l-2 border-[var(--accent-dim)] pl-2">
            {event.result}
          </div>
        )}
      </div>
    )
  }
  if (event.type === 'cancelled') {
    return <div className="text-[var(--warn)] text-[11px] mono">── 已取消 ──</div>
  }
  if (event.content) {
    return <div className="text-xs text-[var(--text-muted)]">{event.content}</div>
  }
  return null
}
