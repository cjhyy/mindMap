import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { useGraphStore } from '../../stores/graphStore'
import type { GraphMeta } from '../../types'

export function GraphSidebar() {
  const { graphs, setGraphs, activeGraphId, setActiveGraph, setActiveNode } = useGraphStore()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.listGraphs().then(setGraphs).catch(console.error)
  }, [setGraphs])

  async function selectGraph(id: string) {
    setActiveNode(null)
    const detail = await api.getGraph(id).catch(() => null)
    setActiveGraph(id, detail ?? undefined)
  }

  async function createGraph() {
    if (!newName.trim()) return
    setLoading(true)
    try {
      await api.createGraph(newName.trim(), '')
      const list = await api.listGraphs()
      setGraphs(list)
      setCreating(false)
      setNewName('')
      if (list[0]) selectGraph(list[0].id)
    } finally {
      setLoading(false)
    }
  }

  async function deleteGraph(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    if (!confirm('删除此图谱？')) return
    await api.deleteGraph(id)
    const list = await api.listGraphs()
    setGraphs(list)
    if (activeGraphId === id) setActiveGraph(null)
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex-1 overflow-y-auto py-1">
        {graphs.length === 0 && (
          <p className="px-4 py-3 text-[var(--text-muted)] text-xs">暂无图谱</p>
        )}
        {graphs.map((g) => (
          <GraphItem
            key={g.id}
            graph={g}
            active={activeGraphId === g.id}
            onClick={() => selectGraph(g.id)}
            onDelete={(e) => deleteGraph(e, g.id)}
          />
        ))}
      </div>

      {/* Create graph */}
      <div className="border-t p-3 shrink-0" style={{ borderColor: 'var(--border)' }}>
        {creating ? (
          <div className="flex flex-col gap-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') createGraph(); if (e.key === 'Escape') setCreating(false) }}
              placeholder="图谱名称"
              className="w-full px-2 py-1 text-xs rounded border bg-transparent outline-none focus:border-[var(--accent)]"
              style={{ borderColor: 'var(--border-2)', color: 'var(--text)' }}
            />
            <div className="flex gap-1">
              <button
                onClick={createGraph}
                disabled={loading}
                className="flex-1 py-1 text-xs rounded text-[var(--accent)] border border-[var(--accent-dim)] hover:bg-[var(--accent-dim)] transition-colors"
              >
                {loading ? '...' : '创建'}
              </button>
              <button
                onClick={() => setCreating(false)}
                className="flex-1 py-1 text-xs rounded text-[var(--text-muted)] border border-[var(--border-2)] hover:bg-[var(--surface-2)] transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="w-full py-1.5 text-xs rounded border border-dashed text-[var(--text-muted)] hover:text-[var(--accent)] hover:border-[var(--accent-dim)] transition-colors"
            style={{ borderColor: 'var(--border-2)' }}
          >
            + 新建图谱
          </button>
        )}
      </div>
    </div>
  )
}

function GraphItem({ graph, active, onClick, onDelete }: {
  graph: GraphMeta
  active: boolean
  onClick: () => void
  onDelete: (e: React.MouseEvent) => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-2.5 flex flex-col gap-0.5 group transition-colors ${
        active
          ? 'bg-[var(--accent-dim)] border-l-2 border-[var(--accent)]'
          : 'border-l-2 border-transparent hover:bg-[var(--surface-2)]'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className={`text-sm font-medium truncate ${active ? 'text-[var(--accent)]' : 'text-[var(--text)]'}`}>
          {graph.name}
        </span>
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--error)] ml-1 text-xs px-1"
        >
          ✕
        </button>
      </div>
      <span className="text-[var(--text-muted)] text-[11px] mono">
        {graph.node_count}节点 · {graph.edge_count}边
      </span>
    </button>
  )
}
