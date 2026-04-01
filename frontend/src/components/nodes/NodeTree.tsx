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
    if (isNew && rowRef.current) rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [isNew])

  if (!node) return null

  const isActive = activeNodeId === nodeId
  const statusColor = node.status === 'expanded' ? 'var(--accent)'
    : node.status === 'explored' ? 'var(--info)' : 'var(--text-muted)'
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
        className={`flex items-center py-1 px-1.5 mx-0.5 rounded transition-all duration-100 ${isNew ? 'node-new-highlight' : ''}`}
        style={{
          paddingLeft: `${8 + depth * 16}px`,
          background: isActive ? 'var(--accent-dim)' : undefined,
          borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
        }}
        onMouseEnter={(e) => { setHovered(true); if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)' }}
        onMouseLeave={(e) => { setHovered(false); if (!isActive) (e.currentTarget as HTMLElement).style.background = '' }}
      >
        <div role="button" tabIndex={0}
          onClick={() => { onSelect(nodeId); if (children.length) setOpen((o) => !o) }}
          onKeyDown={(e) => { if (e.key === 'Enter') { onSelect(nodeId); if (children.length) setOpen((o) => !o) } }}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left cursor-pointer"
        >
          {children.length > 0 ? (
            <span className="text-[9px] w-2.5 shrink-0 transition-transform duration-100"
              style={{ color: 'var(--text-muted)', transform: open ? 'rotate(0)' : 'rotate(-90deg)', display: 'inline-block' }}>▾</span>
          ) : <span className="w-2.5 shrink-0" />}
          <span className="text-[10px] mono shrink-0" style={{ color: statusColor }}>{mark}</span>
          <span className="text-[12px] truncate" style={{ color: isActive ? 'var(--accent)' : 'var(--text)', fontWeight: isActive ? 500 : 400 }}>
            {node.label}
          </span>
          {node.has_doc && <span className="text-[9px] shrink-0" style={{ opacity: 0.4 }}>📄</span>}
        </div>

        {!isRoot && (
          <div role="button" tabIndex={0} onClick={handleDelete}
            onKeyDown={(e) => { if (e.key === 'Enter') handleDelete(e as unknown as React.MouseEvent) }}
            className="shrink-0 rounded cursor-pointer transition-all duration-100"
            style={{
              color: deleting ? 'var(--warn)' : 'var(--text-muted)',
              opacity: hovered || deleting ? 1 : 0,
              pointerEvents: hovered || deleting ? 'auto' : 'none',
              padding: '1px 4px', fontSize: '10px', marginLeft: '2px',
            }}
            onMouseEnter={(e) => { if (!deleting) (e.currentTarget as HTMLElement).style.color = 'var(--error)' }}
            onMouseLeave={(e) => { if (!deleting) (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)' }}
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
