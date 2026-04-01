import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import { useGraphStore } from '../../stores/graphStore'
import { useOperation } from '../../hooks/useOperation'
import { StatusBadge } from '../shared/StatusBadge'
import { MilkdownEditor } from './MilkdownEditor'
import { AiPanel, type AiComment } from './AiPanel'
import type { NodeDetail, NodeDocResponse } from '../../types'

/** Strip YAML frontmatter (--- ... ---) from markdown content */
function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n*/, '')
}

export function DocumentView({ graphId }: { graphId: string }) {
  const { activeNodeId, isStreaming, activeGraph, setActiveNode } = useGraphStore()
  const [node, setNode] = useState<NodeDetail | null>(null)
  const [doc, setDoc] = useState<NodeDocResponse | null>(null)
  const [loadingDoc, setLoadingDoc] = useState(false)
  const [metaOpen, setMetaOpen] = useState(false)

  useEffect(() => {
    if (!activeNodeId) { setNode(null); setDoc(null); return }
    api.getNode(graphId, activeNodeId).then(setNode).catch(console.error)
    setLoadingDoc(true)
    api.getNodeDoc(graphId, activeNodeId)
      .then(setDoc)
      .catch(() => setDoc(null))
      .finally(() => setLoadingDoc(false))
  }, [activeNodeId, graphId, isStreaming])

  const labelToNodeId = useMemo(() => {
    const map: Record<string, string> = {}
    const nodes = activeGraph?.graph_data?.nodes ?? {}
    for (const n of Object.values(nodes)) {
      map[n.label] = n.id
      map[n.label.replace(/\s+/g, '')] = n.id
    }
    return map
  }, [activeGraph])

  const handleDocSaved = useCallback((content: string) => {
    if (!activeNodeId) return
    setDoc((d) => d ? { ...d, content } : { node_id: activeNodeId, label: node?.label ?? '', content, sections: [] })
    api.getNode(graphId, activeNodeId).then(setNode).catch(() => {})
  }, [graphId, activeNodeId, node?.label])

  const [editingLabel, setEditingLabel] = useState(false)
  const [labelDraft, setLabelDraft] = useState('')

  if (!activeNodeId || !node) {
    return <GraphOverview />
  }

  async function saveLabel() {
    const trimmed = labelDraft.trim()
    if (!trimmed || trimmed === node!.label) { setEditingLabel(false); return }
    try {
      await api.updateNode(graphId, activeNodeId!, { label: trimmed })
      setNode((n) => n ? { ...n, label: trimmed } : n)
      const detail = await api.getGraph(graphId)
      useGraphStore.getState().setActiveGraph(graphId, detail)
    } catch (err) { console.error('Failed to update label:', err) }
    setEditingLabel(false)
  }

  const hasChildren = node.children.length > 0
  const hasCross = node.cross_connections.length > 0
  const hasUrls = node.source_urls.length > 0
  const hasMeta = hasChildren || hasCross || hasUrls || !!node.description

  return (
    <div className="flex flex-col h-full">
      {/* Title bar */}
      <div className="px-6 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {editingLabel ? (
              <input autoFocus value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                onBlur={saveLabel}
                onKeyDown={(e) => { if (e.key === 'Enter') saveLabel(); if (e.key === 'Escape') setEditingLabel(false) }}
                className="display text-[18px] font-semibold w-full outline-none rounded px-1 -ml-1"
                style={{ color: 'var(--text)', border: '1px solid var(--accent)', background: 'var(--surface-2)' }}
              />
            ) : (
              <h1 className="display text-[18px] font-semibold cursor-text rounded px-1 -ml-1 transition-colors"
                style={{ color: 'var(--text)' }}
                onClick={() => { setLabelDraft(node.label); setEditingLabel(true) }}
                title="点击编辑"
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = '' }}>
                {node.label}
              </h1>
            )}
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <StatusBadge status={node.status} />
              {node.domain && (
                <span className="text-[10px] px-1.5 py-px rounded mono"
                  style={{ color: 'var(--info)', background: 'var(--info-dim)', border: '1px solid rgba(126,184,218,0.15)' }}>
                  {node.domain}
                </span>
              )}
              <span className="text-[10px] mono px-1.5 py-px rounded"
                style={{ color: 'var(--text-muted)', background: 'var(--surface-2)' }}>L{node.level}</span>
              {node.tags.map((t) => (
                <span key={t} className="text-[10px] px-1.5 py-px rounded mono"
                  style={{ color: 'var(--text-muted)', border: '1px solid var(--border-2)' }}>{t}</span>
              ))}
            </div>
          </div>
        </div>

        {hasMeta && (
          <div className="mt-2">
            <button onClick={() => setMetaOpen(!metaOpen)}
              className="text-[11px] flex items-center gap-1 transition-colors"
              style={{ color: 'var(--text-muted)' }}>
              <span style={{ transform: metaOpen ? 'rotate(0)' : 'rotate(-90deg)', display: 'inline-block', transition: 'transform 0.15s' }}>▾</span>
              {node.description ? node.description.slice(0, 60) + (node.description.length > 60 ? '...' : '') : '详细信息'}
            </button>
            {metaOpen && (
              <div className="mt-2 flex flex-col gap-3 pl-3 animate-fade-in" style={{ borderLeft: '2px solid var(--border)' }}>
                {node.description && (
                  <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{node.description}</p>
                )}
                {hasChildren && (
                  <MetaSection title={`子节点 (${node.children.length})`}>
                    <div className="flex flex-wrap gap-1">
                      {node.children.map((c) => (
                        <button key={c.id} onClick={() => setActiveNode(c.id)}
                          className="text-[11px] px-2 py-0.5 rounded transition-colors hover:bg-[var(--surface-2)]"
                          style={{ color: 'var(--text)', border: '1px solid var(--border-2)' }}>
                          <span className="mono text-[9px] mr-1" style={{ color: c.status === 'expanded' ? 'var(--accent)' : c.status === 'explored' ? 'var(--info)' : 'var(--text-muted)' }}>
                            {c.status === 'expanded' ? '✓' : c.status === 'explored' ? '○' : '·'}
                          </span>
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </MetaSection>
                )}
                {hasCross && (
                  <MetaSection title={`关联 (${node.cross_connections.length})`}>
                    <div className="flex flex-wrap gap-1">
                      {node.cross_connections.map((c) => (
                        <button key={c.edge_id} onClick={() => setActiveNode(c.node_id)}
                          className="text-[11px] px-2 py-0.5 rounded transition-colors hover:bg-[var(--surface-2)]"
                          style={{ color: 'var(--info)', border: '1px solid var(--info-dim)' }}>
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </MetaSection>
                )}
                {hasUrls && (
                  <MetaSection title="参考资料">
                    {node.source_urls.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noreferrer"
                        className="text-[11px] mono truncate block hover:underline" style={{ color: 'var(--info)' }}>{url}</a>
                    ))}
                  </MetaSection>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Document body */}
      <div className="flex-1 overflow-y-auto">
        <DocArea
          graphId={graphId} nodeId={activeNodeId} node={node}
          doc={doc} loading={loadingDoc}
          onSaved={handleDocSaved} onNavigate={setActiveNode}
          labelToNodeId={labelToNodeId}
        />
      </div>
    </div>
  )
}

/* ── Graph Overview ── */

function GraphOverview() {
  const { activeGraph } = useGraphStore()
  if (!activeGraph) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8">
        <div className="w-12 h-12 rounded-lg flex items-center justify-center mb-4"
          style={{ background: 'var(--accent-dim)', border: '1px solid rgba(212,165,116,0.15)' }}>
          <span style={{ color: 'var(--accent)', fontSize: '20px' }}>◇</span>
        </div>
        <h2 className="display text-lg font-semibold mb-2" style={{ color: 'var(--text)' }}>知识图谱</h2>
        <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          从左侧选择一个图谱开始，或点击「新探索」创建知识图谱
        </p>
      </div>
    )
  }

  const g = activeGraph
  const nodes = Object.values(g.graph_data?.nodes ?? {})
  const nodeCount = nodes.length
  const docCount = nodes.filter((n) => n.has_doc).length
  const domains = [...new Set(nodes.map((n) => n.domain).filter(Boolean))]

  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <h2 className="display text-xl font-semibold mb-1" style={{ color: 'var(--text)' }}>{g.name}</h2>
      {g.description && (
        <p className="text-[12px] mb-4 max-w-md" style={{ color: 'var(--text-secondary)' }}>{g.description}</p>
      )}
      <div className="flex items-center gap-4 text-[11px] mono mb-4" style={{ color: 'var(--text-muted)' }}>
        <span>{nodeCount} 节点</span>
        <span>{docCount} 文档</span>
        <span>{g.edge_count} 连接</span>
      </div>
      {domains.length > 0 && (
        <div className="flex flex-wrap gap-1.5 justify-center max-w-md">
          {domains.map((d) => (
            <span key={d} className="text-[10px] px-2 py-0.5 rounded mono"
              style={{ color: 'var(--info)', background: 'var(--info-dim)' }}>{d}</span>
          ))}
        </div>
      )}
      <p className="text-[11px] mt-6" style={{ color: 'var(--text-muted)' }}>← 从节点树中选择一个节点查看文档</p>
    </div>
  )
}

/* ── Doc Area: Milkdown WYSIWYG editor + floating AI + comments ── */

function DocArea({ graphId, nodeId, node, doc, loading, onSaved }: {
  graphId: string; nodeId: string; node: NodeDetail
  doc: NodeDocResponse | null; loading: boolean
  onSaved: (content: string) => void
  onNavigate: (id: string) => void; labelToNodeId: Record<string, string>
}) {
  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiSelection, setAiSelection] = useState('')
  const [aiPos, setAiPos] = useState({ x: 0, y: 0 })
  const [comments, setComments] = useState<AiComment[]>([])
  const { isStreaming } = useGraphStore()
  const { run } = useOperation()

  useEffect(() => { setDirty(false); setGenerating(false); setAiOpen(false); setComments([]) }, [nodeId])
  useEffect(() => { if (doc?.content != null) setDraft(doc.content) }, [doc?.content])

  function openAi() {
    const sel = window.getSelection()
    const text = sel?.toString() ?? ''
    let x = 200, y = 200
    if (sel && sel.rangeCount > 0) {
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      x = rect.left
      y = rect.bottom
    }
    setAiSelection(text)
    setAiPos({ x, y })
    setAiOpen(true)
  }

  // Cmd+J to open AI panel at cursor
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault()
        openAi()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  function onEditorChange(md: string) {
    setDraft(md)
    setDirty(true)
  }

  async function save() {
    if (!dirty) return
    setSaving(true)
    try {
      await api.updateNodeDoc(graphId, nodeId, draft)
      onSaved(draft)
      setDirty(false)
    } catch (err) { console.error(err) }
    finally { setSaving(false) }
  }

  async function generateWithAgent() {
    if (generating || isStreaming) return
    setGenerating(true)
    try {
      await run(
        () => api.agentQuery(graphId, `为节点「${node.label}」(node_id: ${nodeId}) 生成一篇**详细深入**的知识文档。要求：1. 先用 search_knowledge 搜索相关资料 2. 再调用 generate_node_doc 生成文档。文档要包含：概述、核心原理（详细解释）、关键概念（每个3-5句）、代码示例或实践指南、与其他知识点的关系、推荐学习资源。篇幅 800-1500 字。`),
        () => {
          api.getNodeDoc(graphId, nodeId).then((d) => { onSaved(d.content); setDraft(d.content) }).catch(() => {})
          setGenerating(false)
        },
      )
    } catch { setGenerating(false) }
  }

  if (loading) {
    return <div className="px-6 py-8 text-muted-foreground text-sm text-center">加载文档...</div>
  }

  if (generating) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <span className="animate-spin-slow text-lg" style={{ color: 'var(--accent-blue)' }}>◎</span>
        <p className="text-muted-foreground text-sm">Agent 正在生成文档...</p>
      </div>
    )
  }

  // No doc yet
  const hasDoc = node.has_doc || (doc && doc.content)
  if (!hasDoc) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <p className="text-muted-foreground text-sm">该节点尚无文档</p>
        <div className="flex gap-2">
          <button onClick={() => { setDraft('# ' + node.label + '\n\n'); onEditorChange('# ' + node.label + '\n\n') }}
            className="text-[11px] px-4 py-1.5 rounded border text-muted-foreground hover:text-foreground transition-colors"
            style={{ borderColor: 'var(--border-2)' }}>
            手动撰写
          </button>
          <button onClick={generateWithAgent} disabled={isStreaming}
            className="text-[11px] px-4 py-1.5 rounded font-medium transition-colors disabled:opacity-40"
            style={{ background: 'var(--accent-blue)', color: 'white' }}>
            {isStreaming ? 'Agent 忙碌中' : 'AI 生成'}
          </button>
        </div>
      </div>
    )
  }

  const content = stripFrontmatter(draft || doc?.content || '')
  const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac')

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-1.5 shrink-0 gap-1.5"
        style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-1.5">
          <button onClick={openAi}
            className="text-[11px] px-2 py-1 rounded flex items-center gap-1 transition-colors"
            style={{ color: 'var(--text-muted)', border: '1px solid transparent' }}
            title={`AI 助手 (${isMac ? '⌘' : 'Ctrl'}+J)`}>
            <span className="text-[10px]">✦</span>
            <span>AI</span>
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          {dirty && (
            <button onClick={save} disabled={saving}
              className="text-[11px] px-2.5 py-1 rounded font-medium transition-colors text-white"
              style={{ background: 'var(--accent-blue)' }}>
              {saving ? '保存中...' : `保存 ${isMac ? '⌘S' : 'Ctrl+S'}`}
            </button>
          )}
          {dirty && (
            <button onClick={() => { setDraft(doc?.content ?? ''); setDirty(false) }}
              className="text-[11px] px-2 py-1 rounded border text-muted-foreground hover:text-foreground transition-colors"
              style={{ borderColor: 'var(--border-2)' }}>
              撤销
            </button>
          )}
          <button onClick={generateWithAgent} disabled={isStreaming}
            className="text-[11px] px-2 py-1 rounded border transition-colors disabled:opacity-40"
            style={{ borderColor: 'var(--accent-dim)', color: 'var(--accent-blue)' }}>
            {isStreaming ? 'Agent 忙碌中' : 'AI 重写'}
          </button>
          {comments.length > 0 && (
            <span className="text-[10px] mono px-1.5 py-0.5 rounded"
              style={{ background: 'var(--accent-dim)', color: 'var(--accent-blue)' }}>
              {comments.length} 批注
            </span>
          )}
        </div>
      </div>

      {/* Editor + Comments side by side */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Editor */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          <MilkdownEditor
            key={nodeId}
            value={content}
            onChange={onEditorChange}
            onSave={save}
          />
        </div>

        {/* Right-side comments panel */}
        {comments.length > 0 && (
          <div className="w-56 shrink-0 overflow-y-auto border-l py-2 px-2"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-2 px-1"
              style={{ color: 'var(--text-muted)' }}>AI 批注</div>
            <div className="flex flex-col gap-2">
              {comments.map((c) => (
                <div key={c.id} className="rounded border p-2 animate-fade-in"
                  style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                  {c.context !== '(全文)' && (
                    <div className="text-[10px] mono truncate mb-1 px-1 py-0.5 rounded"
                      style={{ background: 'var(--accent-dim)', color: 'var(--accent-blue)' }}>
                      "{c.context.slice(0, 30)}{c.context.length > 30 ? '...' : ''}"
                    </div>
                  )}
                  <div className="text-[11px] leading-relaxed whitespace-pre-wrap"
                    style={{ color: 'var(--text)' }}>{c.content}</div>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[9px] mono" style={{ color: 'var(--text-muted)' }}>
                      {new Date(c.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <div className="flex gap-1">
                      <button onClick={() => {
                        if (c.context !== '(全文)') {
                          const merged = draft.replace(c.context, c.content)
                          onEditorChange(merged)
                          setDraft(merged)
                          setDirty(true)
                        } else {
                          onEditorChange(c.content)
                          setDraft(c.content)
                          setDirty(true)
                        }
                        setComments((prev) => prev.filter((x) => x.id !== c.id))
                      }}
                        className="text-[9px] px-1.5 py-0.5 rounded transition-colors"
                        style={{ color: 'var(--accent-blue)' }}>
                        融合
                      </button>
                      <button onClick={() => setComments((prev) => prev.filter((x) => x.id !== c.id))}
                        className="text-[9px] px-1 py-0.5 rounded transition-colors"
                        style={{ color: 'var(--text-muted)' }}>
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Floating AI Panel */}
      {aiOpen && (
        <AiPanel
          context={aiSelection}
          fullDoc={draft}
          position={aiPos}
          onMerge={(newContent) => {
            onEditorChange(newContent)
            setDraft(newContent)
            setDirty(true)
            setAiOpen(false)
          }}
          onComment={(comment) => {
            setComments((prev) => [...prev, comment])
          }}
          onClose={() => setAiOpen(false)}
        />
      )}
    </div>
  )
}

/* ── Helpers ── */

function MetaSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-[10px] uppercase tracking-[0.1em] font-semibold mono" style={{ color: 'var(--text-muted)' }}>{title}</span>
      <div className="mt-1">{children}</div>
    </div>
  )
}
