import { useCallback, useRef } from 'react'
import { api, subscribeToOperation } from '../api/client'
import { useGraphStore } from '../stores/graphStore'
import type { StreamEvent } from '../types'

/* Infer the current agent phase from tool names */
function inferPhase(tool: string): string | null {
  if (tool === 'create_mindmap') return '创建图谱骨架'
  if (tool === 'add_nodes_batch' || tool === 'add_node') return '展开子节点'
  if (tool === 'generate_node_doc' || tool === 'update_node_doc') return '生成文档'
  if (tool === 'find_cross_connections' || tool === 'add_edge') return '发现关联'
  if (tool === 'assess_node_depth') return '评估节点深度'
  if (tool === 'update_node') return '更新节点'
  if (tool === 'query_graph' || tool === 'get_node_doc') return '分析图谱'
  if (tool.includes('search') || tool.includes('serper')) return '搜索资料'
  return null
}

export function useOperation() {
  const {
    pushStreamEvent, clearStream, setStreaming,
    setActiveGraph, activeGraphId,
    pushProgress, setCurrentOpId,
    setPendingContinue,
  } = useGraphStore()

  const unsubRef = useRef<(() => void) | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastPhaseRef = useRef<string | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  const run = useCallback(async (
    starter: () => Promise<{ operation_id: string }>,
    onDone?: () => void,
  ) => {
    unsubRef.current?.()
    stopPolling()
    clearStream()
    setStreaming(true)
    lastPhaseRef.current = null

    try {
      const op = await starter()
      setCurrentOpId(op.operation_id)

      let done = false
      const handleDone = () => {
        if (done) return
        done = true
        stopPolling()
        setStreaming(false)
        setCurrentOpId(null)
        pushProgress({ type: 'status', text: '完成', ts: Date.now() })
        // Read activeGraphId from store at completion time, not from closure
        // (the closure may hold a stale value if the graph was created mid-run)
        const doneGraphId = useGraphStore.getState().activeGraphId
        if (doneGraphId) {
          api.getGraph(doneGraphId).then((g) => {
            // Only update UI if user is still viewing this graph
            if (useGraphStore.getState().activeGraphId !== doneGraphId) return
            setActiveGraph(doneGraphId, g)
            // Check if graph still has pending work
            const nodes = g.graph_data?.nodes ?? {}
            const unexplored = Object.values(nodes).filter((n) => n.status === 'unexplored').length
            const noDocs = Object.values(nodes).filter(
              (n) => !n.has_doc && n.level >= 1,
            ).length
            if (unexplored > 0 || noDocs > 0) {
              setPendingContinue({ unexplored, noDocs })
              pushProgress({
                type: 'status',
                text: `未完成: ${unexplored} 未探索, ${noDocs} 缺文档`,
                ts: Date.now(),
              })
            } else {
              setPendingContinue(null)
            }
          }).catch(() => {})
        }
        onDone?.()
      }

      unsubRef.current = subscribeToOperation(
        op.operation_id,
        (e: StreamEvent) => {
          pushStreamEvent(e)
          if (e.type === 'tool_call' && e.tool) {
            pushProgress({ type: 'tool', text: e.tool, ts: Date.now() })
            // Push phase change if tool implies a new phase
            const phase = inferPhase(e.tool)
            if (phase && phase !== lastPhaseRef.current) {
              lastPhaseRef.current = phase
              pushProgress({ type: 'phase', text: phase, ts: Date.now() })
            }
          }
          if (e.type === 'turn_end') {
            pushProgress({ type: 'turn', text: `Turn ${e.turn} · ${e.tool_calls} tools`, ts: Date.now() })
          }
        },
        handleDone,
      )

      // Poll graph every 2s for live node updates + push node count changes
      // Read from store to get the latest value (closure may be stale)
      const pollGraphId = useGraphStore.getState().activeGraphId
      if (pollGraphId) {
        const gid = pollGraphId
        let lastNodeCount = Object.keys(
          useGraphStore.getState().activeGraph?.graph_data?.nodes ?? {},
        ).length

        pollRef.current = setInterval(() => {
          if (done) { stopPolling(); return }
          // Stop polling if user switched to a different graph
          const currentGid = useGraphStore.getState().activeGraphId
          if (currentGid !== gid) { stopPolling(); return }
          api.getGraph(gid).then((g) => {
            // Double-check after async fetch — user may have switched during the request
            if (useGraphStore.getState().activeGraphId !== gid) return
            setActiveGraph(gid, g)
            const newCount = Object.keys(g.graph_data?.nodes ?? {}).length
            if (newCount !== lastNodeCount) {
              pushProgress({
                type: 'nodes',
                text: `${lastNodeCount} → ${newCount} 节点`,
                ts: Date.now(),
              })
              lastNodeCount = newCount
            }
          }).catch(() => {})
        }, 2000)
      }

      // Fallback: poll op status every 10s in case SSE drops
      const opPoll = setInterval(async () => {
        if (done) { clearInterval(opPoll); return }
        try {
          const status = await api.getOperation(op.operation_id)
          if (['completed', 'failed', 'cancelled'].includes(status.status)) {
            clearInterval(opPoll)
            handleDone()
          }
        } catch { clearInterval(opPoll); handleDone() }
      }, 10000)

      const origUnsub = unsubRef.current
      unsubRef.current = () => {
        origUnsub()
        stopPolling()
        clearInterval(opPoll)
      }
    } catch (err) {
      stopPolling()
      setStreaming(false)
      setCurrentOpId(null)
      pushStreamEvent({ type: 'message', content: `Error: ${err}` })
    }
  }, [pushStreamEvent, clearStream, setStreaming, setActiveGraph, activeGraphId,
      pushProgress, setCurrentOpId, stopPolling, setPendingContinue])

  const cancel = useCallback(async (opId: string) => {
    unsubRef.current?.()
    stopPolling()
    setStreaming(false)
    setCurrentOpId(null)
    await api.cancelOperation(opId).catch(() => {})
  }, [setStreaming, setCurrentOpId, stopPolling])

  return { run, cancel }
}
