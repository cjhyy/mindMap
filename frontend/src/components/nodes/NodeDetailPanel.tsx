import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../../api/client'
import { useGraphStore } from '../../stores/graphStore'
import { useOperation } from '../../hooks/useOperation'
import { StatusBadge } from '../shared/StatusBadge'
import type { NodeDetail, NodeDocResponse, GraphData } from '../../types'

interface Props { graphId: string }

export function NodeDetailPanel({ graphId }: Props) {
  const { activeNodeId, isStreaming, activeGraph, setActiveNode } = useGraphStore()
  const [node, setNode] = useState<NodeDetail | null>(null)
  const [doc, setDoc] = useState<NodeDocResponse | null>(null)
  const [loadingDoc, setLoadingDoc] = useState(false)
  const [tab, setTab] = useState<'info' | 'doc'>('info')

  useEffect(() => {
    if (!activeNodeId) { setNode(null); setDoc(null); return }
    api.getNode(graphId, activeNodeId).then(setNode).catch(console.error)
    setDoc(null)
  }, [activeNodeId, graphId, isStreaming])

  useEffect(() => {
    if (tab === 'doc' && activeNodeId && !doc) {
      setLoadingDoc(true)
      api.getNodeDoc(graphId, activeNodeId)
        .then(setDoc)
        .catch(() => setDoc({ node_id: activeNodeId, label: node?.label ?? '', content: '', sections: [] }))
        .finally(() => setLoadingDoc(false))
    }
  }, [tab, activeNodeId, graphId, node, doc])

  // Build label → nodeId lookup from graph data
  const labelToNodeId = useMemo(() => {
    const map: Record<string, string> = {}
    const nodes = activeGraph?.graph_data?.nodes ?? {}
    for (const n of Object.values(nodes)) {
      map[n.label] = n.id
      // also index without spaces for fuzzy match
      map[n.label.replace(/\s+/g, '')] = n.id
    }
    return map
  }, [activeGraph])

  const handleDocSaved = useCallback((content: string) => {
    if (!activeNodeId) return
    setDoc((d) => d ? { ...d, content } : d)
    api.getNode(graphId, activeNodeId).then(setNode).catch(() => {})
  }, [graphId, activeNodeId])

  const [editingLabel, setEditingLabel] = useState(false)
  const [labelDraft, setLabelDraft] = useState('')

  if (!activeNodeId || !node) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>← 从左侧选择一个节点</p>
      </div>
    )
  }

  async function saveLabel() {
    const trimmed = labelDraft.trim()
    if (!trimmed || trimmed === node.label) { setEditingLabel(false); return }
    try {
      await api.updateNode(graphId, activeNodeId, { label: trimmed })
      setNode((n) => n ? { ...n, label: trimmed } : n)
      // Refresh graph to update tree
      const detail = await api.getGraph(graphId)
      useGraphStore.getState().setActiveGraph(graphId, detail)
    } catch (err) {
      console.error('Failed to update label:', err)
    }
    setEditingLabel(false)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Node header */}
      <div className="px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {editingLabel ? (
              <input autoFocus value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                onBlur={saveLabel}
                onKeyDown={(e) => { if (e.key === 'Enter') saveLabel(); if (e.key === 'Escape') setEditingLabel(false) }}
                className="display text-[16px] font-semibold w-full outline-none rounded px-1 -ml-1"
                style={{ color: 'var(--text)', border: '1px solid var(--accent)', background: 'var(--surface-2)' }}
              />
            ) : (
              <h2 className="display text-[16px] font-semibold cursor-text rounded px-1 -ml-1 transition-colors"
                style={{ color: 'var(--text)' }}
                onClick={() => { setLabelDraft(node.label); setEditingLabel(true) }}
                title="点击编辑"
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = '' }}>
                {node.label}
              </h2>
            )}
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <StatusBadge status={node.status} />
              {node.domain && (
                <span className="text-[10px] px-1.5 py-px rounded mono"
                  style={{ color: 'var(--info)', background: 'var(--info-dim)', border: '1px solid rgba(126,184,218,0.15)' }}>
                  {node.domain}
                </span>
              )}
              {node.tags.map((t) => (
                <span key={t} className="text-[10px] px-1.5 py-px rounded mono"
                  style={{ color: 'var(--text-muted)', border: '1px solid var(--border-2)' }}>{t}</span>
              ))}
            </div>
          </div>
          <span className="text-[10px] mono shrink-0 px-1.5 py-0.5 rounded"
            style={{ color: 'var(--text-muted)', background: 'var(--surface-2)' }}>L{node.level}</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        {(['info', 'doc'] as const).map((t) => (
          <div key={t} role="button" tabIndex={0} onClick={() => setTab(t)}
            onKeyDown={(e) => { if (e.key === 'Enter') setTab(t) }}
            className="px-4 py-2 text-[12px] font-medium cursor-pointer transition-all duration-100"
            style={tab === t
              ? { color: 'var(--accent)', borderBottom: '2px solid var(--accent)' }
              : { color: 'var(--text-muted)', borderBottom: '2px solid transparent' }
            }>
            {t === 'info' ? '信息' : `文档${node.has_doc ? ' 📄' : ''}`}
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {tab === 'info' ? (
          <InfoTab node={node} onNavigate={setActiveNode} labelToNodeId={labelToNodeId} />
        ) : (
          <DocTab
            graphId={graphId}
            nodeId={activeNodeId}
            doc={doc}
            loading={loadingDoc}
            hasDoc={node.has_doc}
            onSaved={handleDocSaved}
            onNavigate={setActiveNode}
            labelToNodeId={labelToNodeId}
            nodeLabel={node.label}
          />
        )}
      </div>
    </div>
  )
}

/* ── Info Tab ── */

function InfoTab({ node, onNavigate, labelToNodeId }: {
  node: NodeDetail
  onNavigate: (id: string) => void
  labelToNodeId: Record<string, string>
}) {
  return (
    <div className="flex flex-col gap-4">
      {node.description && (
        <Section title="描述">
          <p className="text-sm text-[var(--text)] leading-relaxed">{node.description}</p>
        </Section>
      )}

      {node.children.length > 0 && (
        <Section title={`子节点 (${node.children.length})`}>
          <div className="flex flex-col gap-1">
            {node.children.map((c) => (
              <button
                key={c.id}
                onClick={() => onNavigate(c.id)}
                className="flex items-center gap-2 px-2 py-1 rounded text-left hover:bg-[var(--surface-2)] transition-colors"
              >
                <span className="text-[var(--text-muted)] text-xs mono">
                  {c.status === 'expanded' ? '✓' : c.status === 'explored' ? '○' : '·'}
                </span>
                <span className="text-sm text-[var(--text)]">{c.label}</span>
                {c.domain && <span className="text-[11px] text-[var(--text-muted)] mono ml-auto">{c.domain}</span>}
              </button>
            ))}
          </div>
        </Section>
      )}

      {node.cross_connections.length > 0 && (
        <Section title={`跨域连接 (${node.cross_connections.length})`}>
          <div className="flex flex-col gap-1">
            {node.cross_connections.map((c) => (
              <button
                key={c.edge_id}
                onClick={() => onNavigate(c.node_id)}
                className="flex items-center gap-2 text-sm text-left hover:bg-[var(--surface-2)] px-2 py-1 rounded transition-colors"
              >
                <span className="text-[var(--text-muted)] text-[11px] mono border border-[var(--border-2)] px-1 rounded">
                  {c.edge_type}
                </span>
                <span className="text-[var(--text)]">{c.label}</span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {node.source_urls.length > 0 && (
        <Section title="参考资料">
          <div className="flex flex-col gap-1">
            {node.source_urls.map((url, i) => (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-[var(--info)] hover:text-[var(--info-text)] truncate mono"
              >
                {url}
              </a>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

/* ── Doc Tab ── */

function DocTab({ graphId, nodeId, doc, loading, hasDoc, onSaved, onNavigate, labelToNodeId, nodeLabel }: {
  graphId: string
  nodeId: string
  doc: NodeDocResponse | null
  loading: boolean
  hasDoc: boolean
  onSaved: (content: string) => void
  onNavigate: (id: string) => void
  labelToNodeId: Record<string, string>
  nodeLabel: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const { isStreaming } = useGraphStore()
  const { run } = useOperation()

  // Reset edit state when node changes
  useEffect(() => { setEditing(false); setGenerating(false) }, [nodeId])

  function startEdit() {
    setDraft(doc?.content ?? '')
    setEditing(true)
  }

  async function save() {
    setSaving(true)
    try {
      await api.updateNodeDoc(graphId, nodeId, draft)
      onSaved(draft)
      setEditing(false)
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  async function generateWithAgent() {
    if (generating || isStreaming) return
    setGenerating(true)
    try {
      await run(
        () => api.agentQuery(graphId, `为节点「${nodeLabel}」(node_id: ${nodeId}) 生成一篇**详细深入**的知识文档。要求：1. 先用 search_knowledge 搜索相关资料 2. 再调用 generate_node_doc 生成文档。文档要包含：概述、核心原理（详细解释）、关键概念（每个3-5句）、代码示例或实践指南、与其他知识点的关系、推荐学习资源。篇幅 800-1500 字。`),
        () => {
          // Agent done — reload doc
          api.getNodeDoc(graphId, nodeId)
            .then((d) => onSaved(d.content))
            .catch(() => {})
          setGenerating(false)
        },
      )
    } catch {
      setGenerating(false)
    }
  }

  const editorRef = useRef<HTMLTextAreaElement>(null)

  function insertFormat(prefix: string, suffix: string = '', placeholder: string = '') {
    const ta = editorRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const selected = draft.substring(start, end)
    const text = selected || placeholder
    const newText = draft.substring(0, start) + prefix + text + suffix + draft.substring(end)
    setDraft(newText)
    // Restore cursor position
    setTimeout(() => {
      ta.focus()
      const cursorPos = start + prefix.length + text.length + suffix.length
      ta.setSelectionRange(
        selected ? cursorPos : start + prefix.length,
        selected ? cursorPos : start + prefix.length + text.length,
      )
    }, 0)
  }

  if (loading) return <div className="text-[var(--text-muted)] text-sm">加载文档...</div>

  // Editing mode — side by side with toolbar
  if (editing) {
    return (
      <div className="flex flex-col gap-0 h-full -m-5">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b shrink-0"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div className="flex items-center gap-0.5">
            {[
              { label: 'B', title: '粗体', fn: () => insertFormat('**', '**', '粗体') },
              { label: 'I', title: '斜体', fn: () => insertFormat('*', '*', '斜体') },
              { label: 'H2', title: '二级标题', fn: () => insertFormat('\n## ', '\n', '标题') },
              { label: 'H3', title: '三级标题', fn: () => insertFormat('\n### ', '\n', '标题') },
              { label: '—', title: '分割线', fn: () => insertFormat('\n---\n') },
              { label: '•', title: '无序列表', fn: () => insertFormat('\n- ', '', '列表项') },
              { label: '1.', title: '有序列表', fn: () => insertFormat('\n1. ', '', '列表项') },
              { label: '> ', title: '引用', fn: () => insertFormat('\n> ', '\n', '引用文字') },
              { label: '`', title: '行内代码', fn: () => insertFormat('`', '`', 'code') },
              { label: '```', title: '代码块', fn: () => insertFormat('\n```\n', '\n```\n', '代码') },
              { label: '🔗', title: '链接', fn: () => insertFormat('[', '](url)', '链接文字') },
            ].map((btn) => (
              <button
                key={btn.label}
                onClick={btn.fn}
                title={btn.title}
                className="px-1.5 py-1 text-[11px] mono rounded hover:bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
              >
                {btn.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setEditing(false)}
              className="text-[11px] px-2 py-1 rounded border border-[var(--border-2)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            >
              取消
            </button>
            <button onClick={save} disabled={saving} className="btn-primary text-[11px]">
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>

        {/* Side-by-side editor + preview */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Editor */}
          <div className="flex-1 min-w-0 border-r overflow-hidden flex flex-col" style={{ borderColor: 'var(--border)' }}>
            <textarea
              ref={editorRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="flex-1 w-full px-4 py-3 text-sm bg-transparent outline-none resize-none mono leading-relaxed"
              style={{ color: 'var(--text)' }}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 's' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save() }
                // Tab inserts 2 spaces
                if (e.key === 'Tab') {
                  e.preventDefault()
                  const ta = e.currentTarget
                  const start = ta.selectionStart
                  setDraft(draft.substring(0, start) + '  ' + draft.substring(ta.selectionEnd))
                  setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + 2 }, 0)
                }
              }}
            />
          </div>
          {/* Preview */}
          <div className="flex-1 min-w-0 overflow-y-auto px-4 py-3">
            <div className="doc-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={makeComponents(labelToNodeId, onNavigate)}>
                {draft}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Generating state
  if (generating) {
    return (
      <div className="flex flex-col items-center gap-3 pt-8 text-center">
        <span className="animate-spin text-[var(--accent)] text-lg">◎</span>
        <p className="text-[var(--text-muted)] text-sm">Agent 正在生成文档...</p>
        <p className="text-[var(--text-muted)] text-[11px]">切换到「进度」标签查看详情</p>
      </div>
    )
  }

  // No doc yet — show create prompt
  if (!hasDoc && (!doc || !doc.content)) {
    return (
      <div className="flex flex-col items-center gap-4 pt-8 text-center">
        <p className="text-[var(--text-muted)] text-sm">该节点尚无文档</p>
        <div className="flex gap-2">
          <button
            onClick={startEdit}
            className="text-[11px] px-4 py-1.5 rounded border border-[var(--border-2)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
          >
            手动撰写
          </button>
          <button
            onClick={generateWithAgent}
            disabled={isStreaming}
            className="text-[11px] px-4 py-1.5 rounded font-medium transition-colors disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--bg)' }}
          >
            {isStreaming ? 'Agent 忙碌中' : 'AI 生成'}
          </button>
        </div>
      </div>
    )
  }

  // Read mode — render markdown with node links
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end gap-2">
        <button
          onClick={generateWithAgent}
          disabled={isStreaming}
          className="text-[11px] px-2 py-1 rounded border border-[var(--accent-dim)] text-[var(--accent)] hover:bg-[var(--accent-dim)] transition-colors disabled:opacity-40"
        >
          {isStreaming ? 'Agent 忙碌中' : 'AI 重写'}
        </button>
        <button
          onClick={startEdit}
          className="text-[11px] px-2 py-1 rounded border border-[var(--border-2)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
        >
          编辑
        </button>
      </div>
      <div className="doc-markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={makeComponents(labelToNodeId, onNavigate)}
        >
          {doc?.content ?? ''}
        </ReactMarkdown>
      </div>
    </div>
  )
}

/* ── Markdown custom components: heading → node link ── */

function makeComponents(
  labelToNodeId: Record<string, string>,
  onNavigate: (id: string) => void,
) {
  function HeadingWithLink(
    Tag: 'h1' | 'h2' | 'h3' | 'h4',
    props: React.HTMLAttributes<HTMLHeadingElement>,
  ) {
    const text = extractText(props.children)
    const matchedId = findNodeId(text, labelToNodeId)

    return (
      <Tag {...props} className={`${props.className ?? ''} group flex items-center gap-2`}>
        <span>{props.children}</span>
        {matchedId && (
          <button
            onClick={() => onNavigate(matchedId)}
            className="opacity-0 group-hover:opacity-100 text-[11px] px-1.5 py-0.5 rounded border border-[var(--accent-dim)] text-[var(--accent)] hover:bg-[var(--accent-dim)] transition-all shrink-0"
            title="跳转到该节点"
          >
            →
          </button>
        )}
      </Tag>
    )
  }

  return {
    h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => HeadingWithLink('h1', props),
    h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => HeadingWithLink('h2', props),
    h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => HeadingWithLink('h3', props),
    h4: (props: React.HTMLAttributes<HTMLHeadingElement>) => HeadingWithLink('h4', props),
  }
}

/** Extract plain text from React children */
function extractText(children: React.ReactNode): string {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(extractText).join('')
  if (children && typeof children === 'object' && 'props' in children) {
    return extractText((children as React.ReactElement).props.children)
  }
  return ''
}

/** Try to match heading text to a node label */
function findNodeId(text: string, labelToNodeId: Record<string, string>): string | null {
  const clean = text.trim()
  // Exact match
  if (labelToNodeId[clean]) return labelToNodeId[clean]
  // Without spaces
  const noSpace = clean.replace(/\s+/g, '')
  if (labelToNodeId[noSpace]) return labelToNodeId[noSpace]
  // Substring match: heading contains a node label
  for (const [label, id] of Object.entries(labelToNodeId)) {
    if (label.length >= 2 && clean.includes(label)) return id
  }
  // Node label contains heading text
  for (const [label, id] of Object.entries(labelToNodeId)) {
    if (label.length >= 2 && label.includes(clean) && clean.length >= 2) return id
  }
  return null
}

/* ── Shared ── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[11px] uppercase tracking-[0.1em] font-semibold mono mb-2"
        style={{ color: 'var(--text-muted)' }}>{title}</h3>
      {children}
    </div>
  )
}
