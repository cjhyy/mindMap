import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api, streamChat } from '../../api/client'
import type { ChatMsg } from '../../api/client'
import { useGraphStore } from '../../stores/graphStore'
import { useOperation } from '../../hooks/useOperation'
import { NodeTree } from '../nodes/NodeTree'
import { AgentBar } from '../agent/AgentBar'
import { DocumentView } from '../document/DocumentView'
import { ExploreModal } from '../explore/ExploreModal'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import type { GraphMeta } from '../../types'

type SidebarTab = 'outline' | 'docs' | 'explore'

export function AppShell() {
  const {
    graphs, setGraphs,
    activeGraphId, activeGraph, setActiveGraph, setActiveNode,
    exploreModalOpen, setExploreModalOpen,
    isStreaming, progressLog,
    clearChat, setUserProfile,
  } = useGraphStore()

  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('outline')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  useEffect(() => {
    api.listGraphs().then(setGraphs).catch(console.error)
  }, [setGraphs])

  useEffect(() => {
    if (isStreaming) setSidebarTab('explore')
  }, [isStreaming])

  async function selectGraph(id: string) {
    const store = useGraphStore.getState()
    store.switchToGraph(id)
    setActiveNode(null)
    const detail = await api.getGraph(id).catch(() => null)
    setActiveGraph(id, detail ?? undefined)
    store.loadGraphChat(id)
  }

  async function deleteGraph(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    if (!confirm('删除此图谱？')) return
    await api.deleteGraph(id)
    const list = await api.listGraphs()
    setGraphs(list)
    if (useGraphStore.getState().activeGraphId === id) setActiveGraph(null)
  }

  function openNewExplore() {
    clearChat()
    setUserProfile(null)
    setExploreModalOpen(true)
  }

  return (
      <div className="flex h-full overflow-hidden bg-background">
        {/* ── Sidebar ── */}
        {!sidebarCollapsed ? (
          <aside className="w-56 shrink-0 flex flex-col overflow-hidden border-r bg-sidebar">
            {/* Header: graph selector + collapse */}
            <div className="p-3 space-y-2 shrink-0">
              <div className="flex items-center gap-1">
                <Select value={activeGraphId ?? ''} onValueChange={selectGraph}>
                  <SelectTrigger className="h-8 text-xs flex-1 min-w-0">
                    <span className="truncate">
                      {graphs.find((g) => g.id === activeGraphId)?.name ?? '选择图谱...'}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {graphs.map((g) => (
                      <SelectItem key={g.id} value={g.id} className="text-xs">
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {activeGraphId && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => { setActiveNode(null); setActiveGraph(null) }}
                    title="关闭图谱">
                    <span className="text-xs">✕</span>
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => setSidebarCollapsed(true)} title="收起侧边栏">
                  <span className="text-xs">‹‹</span>
                </Button>
              </div>
            </div>

            <Separator />

            {/* Tabs */}
            <div className="flex shrink-0 px-1 border-b">
              <button onClick={() => setSidebarTab('outline')}
                className={`sidebar-tab ${sidebarTab === 'outline' ? 'active' : ''}`}>
                大纲
              </button>
              <button onClick={() => setSidebarTab('docs')}
                className={`sidebar-tab ${sidebarTab === 'docs' ? 'active' : ''}`}>
                文档
              </button>
              <button onClick={() => setSidebarTab('explore')}
                className={`sidebar-tab ${sidebarTab === 'explore' ? 'active' : ''} ${isStreaming && sidebarTab !== 'explore' ? 'animate-subtle-pulse' : ''}`}>
                {isStreaming ? '⚡ 探索' : '探索'}
              </button>
            </div>

            {/* Tab content */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {sidebarTab === 'outline' ? (
                activeGraph ? (
                  <NodeTree graphData={activeGraph.graph_data} />
                ) : (
                  <EmptyOutline graphs={graphs} onSelect={selectGraph} onDelete={deleteGraph} onNewExplore={openNewExplore} />
                )
              ) : sidebarTab === 'docs' ? (
                <DocsPanel />
              ) : (
                <ExplorePanel />
              )}
            </div>

            {/* Agent bar */}
            {activeGraph && (
              <>
                <Separator />
                <AgentBar />
              </>
            )}
          </aside>
        ) : (
          /* Collapsed: small expand button */
          <div className="shrink-0 flex flex-col items-center py-3 px-1 border-r bg-sidebar">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => setSidebarCollapsed(false)} title="展开侧边栏">
              <span className="text-xs">››</span>
            </Button>
          </div>
        )}

        {/* ── Main: Document ── */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden bg-background">
          {activeGraphId ? (
            <DocumentView graphId={activeGraphId} />
          ) : (
            <WelcomeView onNewExplore={openNewExplore} />
          )}
        </main>

        {/* ── Explore Modal ── */}
        {exploreModalOpen && <ExploreModal />}
      </div>
  )
}

/* ── Empty outline ── */
function EmptyOutline({ graphs, onSelect, onDelete, onNewExplore }: {
  graphs: GraphMeta[]; onSelect: (id: string) => void; onDelete: (e: React.MouseEvent, id: string) => void; onNewExplore: () => void
}) {
  if (graphs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 px-4 text-center">
        <p className="text-xs text-muted-foreground mb-3">还没有知识图谱</p>
        <Button size="sm" onClick={onNewExplore} className="text-xs">开始探索</Button>
      </div>
    )
  }
  return (
    <div className="py-1">
      <div className="px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">所有图谱</span>
      </div>
      {graphs.map((g) => (
        <div key={g.id} role="button" tabIndex={0} onClick={() => onSelect(g.id)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSelect(g.id) }}
          className="w-full text-left px-3 py-2 group cursor-pointer hover:bg-sidebar-accent transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium truncate text-foreground">{g.name}</span>
            <span role="button" tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onDelete(e, g.id) }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onDelete(e as unknown as React.MouseEvent, g.id) } }}
              className="opacity-0 group-hover:opacity-100 text-[9px] px-1 rounded cursor-pointer text-muted-foreground hover:text-destructive transition-all">
              ✕
            </span>
          </div>
          <span className="text-[10px] text-muted-foreground mono">{g.node_count} 节点</span>
        </div>
      ))}
    </div>
  )
}

/* ── Docs panel: list docs across ALL graphs ── */
function DocsPanel() {
  const { graphs, activeGraph, activeGraphId, activeNodeId, setActiveNode, setActiveGraph } = useGraphStore()
  const [allDocs, setAllDocs] = useState<{ graphId: string; graphName: string; nodeId: string; label: string; domain: string }[]>([])
  const [loading, setLoading] = useState(false)

  // Load docs from all graphs
  useEffect(() => {
    setLoading(true)
    Promise.all(
      graphs.map(async (g) => {
        try {
          const detail = await api.getGraph(g.id)
          const nodes = Object.values(detail.graph_data?.nodes ?? {})
          return nodes
            .filter((n) => n.has_doc)
            .map((n) => ({ graphId: g.id, graphName: g.name, nodeId: n.id, label: n.label, domain: n.domain }))
        } catch { return [] }
      })
    ).then((results) => {
      setAllDocs(results.flat())
      setLoading(false)
    })
  }, [graphs, activeGraph]) // re-fetch when activeGraph changes (new docs may have been added)

  async function selectDoc(graphId: string, nodeId: string) {
    if (activeGraphId !== graphId) {
      const store = useGraphStore.getState()
      store.switchToGraph(graphId)
      const detail = await api.getGraph(graphId).catch(() => null)
      setActiveGraph(graphId, detail ?? undefined)
      store.loadGraphChat(graphId)
    }
    setActiveNode(nodeId)
  }

  if (loading && allDocs.length === 0) {
    return <p className="text-xs text-center py-6 text-muted-foreground">加载中...</p>
  }

  if (allDocs.length === 0) {
    return <p className="text-xs text-center py-6 text-muted-foreground">暂无文档</p>
  }

  // Group by graph
  const grouped: Record<string, typeof allDocs> = {}
  for (const doc of allDocs) {
    if (!grouped[doc.graphId]) grouped[doc.graphId] = []
    grouped[doc.graphId].push(doc)
  }

  return (
    <div className="py-1">
      {Object.entries(grouped).map(([graphId, docs]) => (
        <div key={graphId}>
          <div className="px-3 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {docs[0].graphName} ({docs.length})
            </span>
          </div>
          {docs.map((d) => (
            <button key={d.nodeId} onClick={() => selectDoc(d.graphId, d.nodeId)}
              className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-xs transition-colors ${
                activeNodeId === d.nodeId && activeGraphId === d.graphId ? 'bg-accent text-accent-foreground' : 'hover:bg-sidebar-accent'
              }`}>
              <span className="text-[10px] shrink-0" style={{ color: 'var(--accent-blue)' }}>📄</span>
              <span className="truncate">{d.label}</span>
              {d.domain && <span className="text-[9px] text-muted-foreground ml-auto shrink-0">{d.domain}</span>}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

/* ── Explore panel: progress on top, chat collapsed/expandable ── */
function ExplorePanel() {
  const {
    activeGraphId, activeGraph, chatMessages, chatLoading, isStreaming, progressLog,
    setChatLoading, saveCurrentChat, graphMemory,
  } = useGraphStore()
  const { run } = useOperation()
  const [input, setInput] = useState('')
  const [chatPopup, setChatPopup] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const popupBottomRef = useRef<HTMLDivElement>(null)

  const nodes = activeGraph?.graph_data?.nodes ?? {}
  const nodeCount = Object.keys(nodes).length
  const exploredCount = Object.values(nodes).filter((n) => n.status !== 'unexplored').length
  const docCount = Object.values(nodes).filter((n) => n.has_doc).length
  const lastPhase = [...progressLog].reverse().find((e) => e.type === 'phase')

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    popupBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, chatLoading])

  async function sendChat() {
    const text = input.trim()
    if (!text || chatLoading || !activeGraphId) return
    setInput('')

    useGraphStore.setState((s) => ({
      chatMessages: [...s.chatMessages, { role: 'user' as const, content: text }],
    }))

    const isAgentCommand = /展开|添加|删除|生成|补充|调整|修改|增加|移除|重写|细化|扩展/.test(text)

    if (isAgentCommand && activeGraphId) {
      useGraphStore.setState((s) => ({
        chatMessages: [...s.chatMessages, { role: 'assistant' as const, content: '正在执行...' }],
      }))
      saveCurrentChat()
      await run(() => api.agentQuery(activeGraphId, text), () => {
        useGraphStore.setState((s) => {
          const msgs = [...s.chatMessages]
          const lastIdx = msgs.findLastIndex((m) => m.content === '正在执行...')
          if (lastIdx >= 0) msgs[lastIdx] = { role: 'assistant', content: '已完成操作。' }
          return { chatMessages: msgs }
        })
        saveCurrentChat()
      })
    } else {
      setChatLoading(true)
      useGraphStore.setState((s) => ({
        chatMessages: [...s.chatMessages, { role: 'assistant' as const, content: '' }],
      }))
      const contextParts: string[] = []
      if (graphMemory?.summary) contextParts.push(graphMemory.summary)
      if (graphMemory?.key_points?.length) contextParts.push(`模块: ${graphMemory.key_points.join('、')}`)
      const profile = graphMemory?.user_profile as Record<string, unknown> | undefined
      if (profile?.scope) contextParts.push(`探索范围: ${(profile.scope as string[]).join('、')}`)
      const memoryCtx: ChatMsg[] = contextParts.length > 0
        ? [{ role: 'user' as const, content: `[图谱上下文] ${contextParts.join(' | ')}` }]
        : []
      const history: ChatMsg[] = [...memoryCtx, ...useGraphStore.getState().chatMessages.slice(-10)]
      let full = ''
      try {
        for await (const chunk of streamChat(history)) {
          full += chunk
          useGraphStore.setState((s) => {
            const msgs = [...s.chatMessages]
            msgs[msgs.length - 1] = { role: 'assistant', content: full }
            return { chatMessages: msgs }
          })
        }
      } catch (err) { console.error(err) }
      finally { setChatLoading(false); saveCurrentChat() }
    }
  }

  const chatInput = (
    <div className="flex items-end gap-1.5 rounded-md px-2 py-1.5"
      style={{ border: '1px solid var(--border)', background: 'var(--bg)' }}>
      <textarea value={input} onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat() } }}
        placeholder={isStreaming ? 'Agent 运行中...' : '调整图谱...'} disabled={isStreaming} rows={1}
        className="flex-1 bg-transparent outline-none resize-none text-[11px] leading-relaxed disabled:opacity-40"
        style={{ color: 'var(--text)', maxHeight: '60px' }} />
      <button onClick={sendChat} disabled={!input.trim() || chatLoading || isStreaming}
        className="shrink-0 w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold disabled:opacity-20 text-white"
        style={{ background: 'var(--accent-blue)' }}>↑</button>
    </div>
  )

  const chatMessageList = (ref: React.RefObject<HTMLDivElement | null>) => (
    <>
      {chatMessages.map((msg, i) => (
        <div key={`msg-${i}`} className={`mb-2.5 ${msg.role === 'user' ? 'text-right' : ''}`}>
          {msg.role === 'user' ? (
            <div className="inline-block max-w-[90%] px-2.5 py-1.5 rounded-lg text-[11px] leading-relaxed whitespace-pre-wrap bg-primary text-primary-foreground">
              {msg.content}
            </div>
          ) : (
            <div className="chat-markdown text-[11px] leading-relaxed">
              {msg.content ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
              ) : (
                <span className="opacity-40">···</span>
              )}
            </div>
          )}
        </div>
      ))}
      {chatLoading && <div className="text-[11px] text-muted-foreground animate-subtle-pulse">思考中...</div>}
      <div ref={ref} />
    </>
  )

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Stats */}
        {nodeCount > 0 && (
          <div className="px-3 py-2 border-b space-y-1.5 shrink-0">
            {isStreaming && lastPhase && (
              <div className="flex items-center gap-1.5">
                <span className="animate-subtle-pulse text-[7px] text-primary">●</span>
                <span className="text-[11px] font-medium text-primary">{lastPhase.text}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px] h-5">{nodeCount} 节点</Badge>
              <Badge variant="secondary" className="text-[10px] h-5">{exploredCount} 探索</Badge>
              <Badge variant="secondary" className="text-[10px] h-5">{docCount} 文档</Badge>
            </div>
            {isStreaming && (
              <div className="w-full h-1 rounded-full overflow-hidden bg-secondary">
                <div className="h-full rounded-full transition-all duration-700 bg-primary"
                  style={{ width: `${Math.min(100, (exploredCount / Math.max(nodeCount, 1)) * 100)}%` }} />
              </div>
            )}
          </div>
        )}

        {/* Progress log */}
        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
          {progressLog.length === 0 && !isStreaming && chatMessages.length === 0 && (
            <p className="text-xs text-center py-6 text-muted-foreground">
              {nodeCount === 0 ? '开始探索后显示进度' : '暂无进度'}
            </p>
          )}
          {progressLog.map((entry, i) => (
            <div key={i} className={`text-[10px] mono flex items-start gap-1.5 ${
              entry.type === 'status' || entry.type === 'phase' ? 'text-primary'
              : entry.type === 'nodes' ? 'text-foreground'
              : entry.type === 'turn' ? 'text-muted-foreground'
              : 'text-chart-1'
            }`}>
              <span className="shrink-0 opacity-50">
                {entry.type === 'tool' ? '⚙' : entry.type === 'turn' ? '↩' : entry.type === 'phase' ? '▸' : entry.type === 'nodes' ? '+' : '✓'}
              </span>
              <span className={entry.type === 'phase' ? 'font-semibold' : ''}>{entry.text}</span>
            </div>
          ))}
          {isStreaming && (
            <div className="flex items-center gap-1.5 text-[10px] mono mt-1 text-orange-500">
              <span className="animate-spin-slow">◎</span><span>运行中...</span>
            </div>
          )}

          {/* Inline chat preview (last 2 messages) */}
          {chatMessages.length > 0 && !isStreaming && (
            <div className="mt-3 pt-2 border-t">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-medium text-muted-foreground">对话</span>
                <button onClick={() => setChatPopup(true)}
                  className="text-[10px] px-1.5 py-0.5 rounded transition-colors hover:bg-secondary"
                  style={{ color: 'var(--accent-blue)' }}>
                  展开 ↗
                </button>
              </div>
              {chatMessages.slice(-2).map((msg, i) => (
                <div key={i} className={`mb-1.5 ${msg.role === 'user' ? 'text-right' : ''}`}>
                  {msg.role === 'user' ? (
                    <div className="inline-block max-w-[90%] px-2 py-1 rounded text-[10px] leading-relaxed whitespace-pre-wrap bg-primary text-primary-foreground truncate">
                      {msg.content.slice(0, 60)}{msg.content.length > 60 ? '...' : ''}
                    </div>
                  ) : (
                    <div className="chat-markdown text-[10px] leading-relaxed line-clamp-3">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content.slice(0, 200)}</ReactMarkdown>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Chat input */}
        {activeGraphId && (
          <div className="px-3 py-2 border-t shrink-0">
            {chatInput}
          </div>
        )}
      </div>

      {/* ── Chat popup dialog ── */}
      {chatPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="w-full max-w-lg h-[70vh] flex flex-col rounded-xl overflow-hidden animate-fade-in"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0" style={{ background: 'var(--bg)' }}>
              <span className="text-xs font-medium" style={{ color: 'var(--text)' }}>
                对话历史
                <span className="text-muted-foreground ml-1">({chatMessages.length} 条)</span>
              </span>
              <button onClick={() => setChatPopup(false)}
                className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground text-xs">✕</button>
            </div>
            {/* Messages */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
              {chatMessageList(popupBottomRef)}
            </div>
            {/* Input */}
            <div className="px-4 py-2.5 border-t shrink-0">
              {chatInput}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/* ── Welcome ── */
function WelcomeView({ onNewExplore }: { onNewExplore: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <div className="w-14 h-14 rounded-xl flex items-center justify-center mb-5 bg-accent">
        <span className="text-2xl text-accent-foreground">◇</span>
      </div>
      <h1 className="display text-xl font-semibold mb-2 text-foreground">知识图谱</h1>
      <p className="text-sm max-w-sm mb-6 text-muted-foreground">
        探索知识领域，构建结构化的思维导图
      </p>
      <Button onClick={onNewExplore} className="px-6">开始新探索</Button>
    </div>
  )
}
