import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import { useGraphStore } from '../../stores/graphStore'
import type { GraphData, NodeData } from '../../types'

interface Props { graphData: GraphData }

export function NodeTree({ graphData }: Props) {
  const { activeNodeId, setActiveNode, activeGraphId, setActiveGraph, newNodeIds } = useGraphStore()
  const { nodes, edges, root_node_id } = graphData

  const childrenOf: Record<string, string[]> = {}
  Object.values(edges).forEach((e) => {
    if (e.edge_type === 'parent_child') {
      if (!childrenOf[e.source_id]) childrenOf[e.source_id] = []
      childrenOf[e.source_id].push(e.target_id)
    }
  })

  const forceExpandIds = new Set<string>()
  if (newNodeIds.size > 0) {
    for (const nid of newNodeIds) {
      const node = nodes[nid]
      if (node?.parent_id) forceExpandIds.add(node.parent_id)
    }
  }

  const roots = root_node_id
    ? [root_node_id]
    : Object.values(nodes).filter((n) => !n.parent_id).map((n) => n.id)

  if (roots.length === 0) {
    return (
      <div className="p-4 text-center">
        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>等待 Agent 构建...</p>
      </div>
    )
  }

  async function deleteNode(nodeId: string) {
    if (!activeGraphId) return
    try {
      await api.deleteNodeFromGraph(activeGraphId, nodeId)
      const detail = await api.getGraph(activeGraphId)
      setActiveGraph(activeGraphId, detail)
      if (activeNodeId === nodeId) setActiveNode(null)
    } catch (err) {
      console.error('Failed to delete node:', err)
      alert(`删除失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className="py-1">
      {roots.map((id) => (
        <TreeNode key={id} nodeId={id} nodes={nodes} childrenOf={childrenOf}
          activeNodeId={activeNodeId} onSelect={setActiveNode} onDelete={deleteNode}
          depth={0} isRoot={true} newNodeIds={newNodeIds} forceExpandIds={forceExpandIds} />
      ))}
    </div>
  )
}

function TreeNode({ nodeId, nodes, childrenOf, activeNodeId, onSelect, onDelete, depth, isRoot, newNodeIds, forceExpandIds }: {
  nodeId: string; nodes: Record<string, NodeData>; childrenOf: Record<string, string[]>
  activeNodeId: string | null; onSelect: (id: string) => void; onDelete: (id: string) => void
  depth: number; isRoot?: boolean; newNodeIds: Set<string>; forceExpandIds: Set<string>
}) {
  const node = nodes[nodeId]
  const children = childrenOf[nodeId] ?? []
  const [open, setOpen] = useState(depth < 2)
  const [deleting, setDeleting] = useState(false)
  const isNew = newNodeIds.has(nodeId)
  const rowRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    if (forceExpandIds.has(nodeId) && children.length > 0) setOpen(true)
  }, [forceExpandIds, nodeId, children.length])

  useEffect(() => {
    if (isNew && rowRef.current) {
      // Delay to avoid interfering with user's current scroll position
      const timer = setTimeout(() => {
        rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [isNew])

  if (!node) return null

  const isActive = activeNodeId === nodeId
  const statusColor = node.status === 'expanded' ? '#3B7DD8'
    : node.status === 'explored' ? '#7EB8DA' : '#999'
  const mark = node.status === 'expanded' ? '✓' : node.status === 'explored' ? '○' : '·'

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    if (!confirm(`删除「${node.label}」及其所有子节点？`)) return
    setDeleting(true)
    try { await onDelete(nodeId) } catch { setDeleting(false) }
  }

  return (
    <div>
      <div ref={rowRef}
        className={`flex items-center h-7 px-1.5 mx-0.5 rounded transition-all duration-100 overflow-hidden ${isNew ? 'node-new-highlight' : ''}`}
        style={{
          paddingLeft: `${8 + depth * 14}px`,
          background: isActive ? 'var(--accent-dim)' : undefined,
          borderLeft: isActive ? '2px solid var(--accent-blue)' : '2px solid transparent',
        }}
        onMouseEnter={(e) => { setHovered(true); if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)' }}
        onMouseLeave={(e) => { setHovered(false); if (!isActive) (e.currentTarget as HTMLElement).style.background = '' }}
      >
        <div role="button" tabIndex={0}
          onClick={() => { onSelect(nodeId); if (children.length) setOpen((o) => !o) }}
          onKeyDown={(e) => { if (e.key === 'Enter') { onSelect(nodeId); if (children.length) setOpen((o) => !o) } }}
          className="flex items-center gap-1 flex-1 min-w-0 text-left cursor-pointer overflow-hidden"
        >
          {children.length > 0 ? (
            <span className="text-[9px] w-3 shrink-0 text-center transition-transform duration-100"
              style={{ color: '#999', transform: open ? 'rotate(0)' : 'rotate(-90deg)', display: 'inline-block' }}>▾</span>
          ) : <span className="w-3 shrink-0" />}
          <span className="text-[10px] mono shrink-0" style={{ color: statusColor }}>{mark}</span>
          <span className="text-[12px] truncate block" style={{ color: isActive ? 'var(--accent-blue)' : 'var(--text)', fontWeight: isActive ? 500 : 400 }}>
            {node.label}
          </span>
          {node.has_doc && <span className="text-[9px] shrink-0 opacity-40">📄</span>}
        </div>

        {!isRoot && hovered && (
          <div role="button" tabIndex={0} onClick={handleDelete}
            onKeyDown={(e) => { if (e.key === 'Enter') handleDelete(e as unknown as React.MouseEvent) }}
            className="shrink-0 rounded cursor-pointer text-[10px] px-1 ml-0.5 transition-colors"
            style={{ color: deleting ? 'var(--warn)' : '#999' }}
            onMouseEnter={(e) => { if (!deleting) (e.currentTarget as HTMLElement).style.color = 'var(--error)' }}
            onMouseLeave={(e) => { if (!deleting) (e.currentTarget as HTMLElement).style.color = '#999' }}
          >{deleting ? '…' : '✕'}</div>
        )}
      </div>

      {open && children.map((cid) => (
        <TreeNode key={cid} nodeId={cid} nodes={nodes} childrenOf={childrenOf}
          activeNodeId={activeNodeId} onSelect={onSelect} onDelete={onDelete}
          depth={depth + 1} newNodeIds={newNodeIds} forceExpandIds={forceExpandIds} />
      ))}
    </div>
  )
}
