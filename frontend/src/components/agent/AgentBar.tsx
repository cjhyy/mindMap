import { useGraphStore } from '../../stores/graphStore'
import { useOperation } from '../../hooks/useOperation'
import { api } from '../../api/client'

export function AgentBar() {
  const {
    activeGraphId, activeGraph, isStreaming, currentOpId,
    pendingContinue, autoRoundsLeft, setAutoRoundsLeft, setPendingContinue,
  } = useGraphStore()
  const { run, cancel } = useOperation()

  if (!activeGraphId || !activeGraph) return null

  const nodes = Object.values(activeGraph.graph_data?.nodes ?? {})
  const nodeCount = nodes.length
  const unexplored = nodes.filter((n) => n.status === 'unexplored').length
  const noDocs = nodes.filter((n) => !n.has_doc && n.level >= 1).length
  const hasWork = unexplored > 0 || noDocs > 0

  async function continueExplore() {
    if (!activeGraphId || isStreaming) return
    setPendingContinue(null)
    await run(() => api.agentAuto(activeGraphId))
  }

  async function fillDocs() {
    if (!activeGraphId || isStreaming) return
    setPendingContinue(null)
    await run(() => api.agentFillDocs(activeGraphId))
  }

  function startAutoContinue(rounds: number) {
    setAutoRoundsLeft(rounds - 1)
    continueExplore()
  }

  // Nothing to show
  if (!isStreaming && !pendingContinue && !hasWork && nodeCount === 0) return null

  return (
    <div className="shrink-0 px-3 py-2" style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
      {/* Streaming state */}
      {isStreaming && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="animate-subtle-pulse text-[8px]" style={{ color: 'var(--accent)' }}>●</span>
            <span className="text-[11px] font-medium truncate" style={{ color: 'var(--accent)' }}>
              运行中
              {autoRoundsLeft > 0 && <span className="text-[10px] ml-1" style={{ color: 'var(--text-muted)' }}>· 剩余 {autoRoundsLeft} 轮</span>}
            </span>
          </div>
          {currentOpId && (
            <button onClick={() => cancel(currentOpId)}
              className="text-[10px] px-2 py-0.5 rounded border border-[var(--error)] text-[var(--error)] hover:bg-[var(--error-dim)] transition-colors">
              停止
            </button>
          )}
        </div>
      )}

      {/* Pending continue */}
      {!isStreaming && pendingContinue && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] flex items-center gap-1" style={{ color: 'var(--warn)' }}>
            <span>⚠</span>
            <span>
              {pendingContinue.unexplored > 0 && `${pendingContinue.unexplored} 未探索`}
              {pendingContinue.unexplored > 0 && pendingContinue.noDocs > 0 && ' · '}
              {pendingContinue.noDocs > 0 && `${pendingContinue.noDocs} 缺文档`}
            </span>
          </div>
          <div className="flex gap-1.5">
            {pendingContinue.noDocs > 0 && (
              <button onClick={fillDocs} className="flex-1 text-[10px] py-1 rounded border transition-colors"
                style={{ borderColor: 'var(--info)', color: 'var(--info)' }}>填充文档</button>
            )}
            <button onClick={continueExplore} className="flex-1 text-[10px] py-1 rounded border border-[var(--border-2)] text-[var(--text-muted)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors">
              续跑
            </button>
            <button onClick={() => startAutoContinue(3)} className="flex-1 text-[10px] py-1 rounded font-medium transition-colors"
              style={{ background: 'var(--accent)', color: 'var(--bg)' }}>
              自动 3 轮
            </button>
          </div>
        </div>
      )}

      {/* Idle with remaining work */}
      {!isStreaming && !pendingContinue && hasWork && (
        <div className="flex items-center justify-between">
          <span className="text-[10px] mono" style={{ color: 'var(--text-muted)' }}>
            {unexplored > 0 && `${unexplored} 未探索`}
            {unexplored > 0 && noDocs > 0 && ' · '}
            {noDocs > 0 && `${noDocs} 缺文档`}
          </span>
          <div className="flex gap-1.5">
            {noDocs > 0 && (
              <button onClick={fillDocs} className="text-[10px] px-2 py-0.5 rounded border transition-colors"
                style={{ borderColor: 'var(--info)', color: 'var(--info)' }}>文档</button>
            )}
            <button onClick={continueExplore} className="text-[10px] px-2 py-0.5 rounded border border-[var(--border-2)] text-[var(--text-muted)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors">
              续跑
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
