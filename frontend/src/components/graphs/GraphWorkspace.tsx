import { useEffect } from 'react'
import { api } from '../../api/client'
import { useGraphStore } from '../../stores/graphStore'
import { useOperation } from '../../hooks/useOperation'
import { NodeTree } from '../nodes/NodeTree'
import { AgentBar } from '../agent/AgentBar'

export function GraphWorkspace() {
  const { activeGraph, activeGraphId, isStreaming,
    pendingContinue, autoRoundsLeft, setAutoRoundsLeft, setPendingContinue } = useGraphStore()
  const { run } = useOperation()

  // Auto-continue logic
  useEffect(() => {
    if (pendingContinue && autoRoundsLeft > 0 && !isStreaming && activeGraphId) {
      const timer = setTimeout(() => {
        setAutoRoundsLeft(autoRoundsLeft - 1)
        setPendingContinue(null)
        run(() => api.agentAuto(activeGraphId))
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [pendingContinue, autoRoundsLeft, isStreaming, activeGraphId])

  if (!activeGraph || !activeGraphId) return null

  const g = activeGraph
  const nodes = Object.values(g.graph_data?.nodes ?? {})
  const nodeCount = nodes.length
  const exploredCount = nodes.filter((n) => n.status !== 'unexplored').length

  return (
    <div className="w-64 shrink-0 flex flex-col overflow-hidden"
      style={{ borderRight: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>

      {/* Graph header */}
      <div className="px-3 py-2.5 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <h2 className="display text-[13px] font-semibold truncate" style={{ color: 'var(--text)' }}>
          {g.name}
        </h2>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] mono" style={{ color: 'var(--text-muted)' }}>{nodeCount} 节点</span>
          {isStreaming && (
            <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--accent)' }}>
              <span className="animate-subtle-pulse" style={{ fontSize: '6px' }}>●</span>
              <span className="mono">{exploredCount}/{nodeCount}</span>
            </span>
          )}
        </div>
      </div>

      {/* Node tree */}
      <div className="flex-1 overflow-y-auto">
        <NodeTree graphData={g.graph_data} />
      </div>

      {/* Agent controls bar */}
      <AgentBar />
    </div>
  )
}
