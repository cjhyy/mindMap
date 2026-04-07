import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api, streamChat } from '../../api/client'
import type { UserProfile } from '../../api/client'
import { useGraphStore } from '../../stores/graphStore'
import { useOperation } from '../../hooks/useOperation'

function parseReady(text: string): UserProfile | null {
  const match = text.match(/READY::(\{[\s\S]+\})\s*$/)
  if (!match) return null
  try { return JSON.parse(match[1]) as UserProfile } catch { return null }
}

function stripReady(text: string): string {
  return text.replace(/\n?READY::(\{[\s\S]+\})\s*$/, '').trim()
}

export function ExploreModal() {
  const {
    chatMessages, chatLoading, userProfile, checkedScope, graphMemory, activeGraph,
    setChatLoading, setUserProfile, setCheckedScope,
    setGraphs, setActiveGraph, setExploreModalOpen,
    clearStream, saveCurrentChat,
  } = useGraphStore()

  const { run } = useOperation()
  const [input, setInput] = useState('')
  const [exploring, setExploring] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const initRef = useRef(false)

  // Already-explored module labels
  const exploredLabels = new Set(
    Object.values(activeGraph?.graph_data?.nodes ?? {})
      .filter((n) => n.status !== 'unexplored')
      .map((n) => n.label)
  )

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, chatLoading])

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true
    if (chatMessages.length > 0) return
    useGraphStore.setState({
      chatMessages: [{
        role: 'assistant',
        content: '你好！我可以帮你探索任何知识领域。\n\n请告诉我：\n1. 你想探索什么主题？\n2. 你的背景和基础如何？\n3. 你的学习目标是什么？\n\n比如："我想系统学习机器学习，有 Python 基础，目标是能独立完成项目"',
      }],
    })
  }, [])

  // Parse [已探索] prefix from scope items
  function isScopeExplored(s: string): boolean {
    return s.startsWith('[已探索]') || exploredLabels.has(s)
  }
  function cleanScopeLabel(s: string): string {
    return s.replace(/^\[已探索\]/, '')
  }

  function applyProfile(profile: UserProfile) {
    setUserProfile(profile)
    const unexplored = profile.scope.filter((s) => !isScopeExplored(s))
    setCheckedScope(unexplored)
  }

  async function streamAssistant(history: { role: 'user' | 'assistant'; content: string }[]) {
    setChatLoading(true)
    useGraphStore.setState((s) => ({
      chatMessages: [...s.chatMessages, { role: 'assistant', content: '' }],
    }))
    // Build context: memory + existing graph nodes for dedup
    const contextMsgs: { role: 'user'; content: string }[] = []
    if (graphMemory?.summary) {
      contextMsgs.push({ role: 'user', content: `[上下文记忆] ${graphMemory.summary}` })
    }
    if (exploredLabels.size > 0) {
      const allNodes = Object.values(activeGraph?.graph_data?.nodes ?? {})
      const nodeList = allNodes
        .filter((n) => n.status !== 'unexplored')
        .map((n) => n.label)
      contextMsgs.push({ role: 'user', content: `[已有图谱节点] ${nodeList.join('、')}` })
    }
    const memoryContext = contextMsgs.length > 0 ? [...contextMsgs, ...history] : history
    let full = ''
    try {
      for await (const chunk of streamChat(memoryContext)) {
        full += chunk
        useGraphStore.setState((s) => {
          const msgs = [...s.chatMessages]
          msgs[msgs.length - 1] = { role: 'assistant', content: full }
          return { chatMessages: msgs }
        })
      }
      const profile = parseReady(full)
      if (profile) {
        applyProfile(profile)
        useGraphStore.setState((s) => {
          const msgs = [...s.chatMessages]
          msgs[msgs.length - 1] = { role: 'assistant', content: stripReady(full) }
          return { chatMessages: msgs }
        })
      }
    } finally {
      setChatLoading(false)
      saveCurrentChat()
    }
  }

  async function send() {
    const text = input.trim()
    if (!text || chatLoading) return
    setInput('')
    const history = useGraphStore.getState().chatMessages
    const newHistory = [...history, { role: 'user' as const, content: text }]
    useGraphStore.setState({ chatMessages: newHistory })
    saveCurrentChat()
    await streamAssistant(newHistory)
  }

  async function startExplore() {
    if (!userProfile || exploring || checkedScope.length === 0) return
    setExploring(true)
    const profileToUse = { ...userProfile, scope: checkedScope.map(cleanScopeLabel) }
    try {
      const graph = await api.createGraph(userProfile.topic, userProfile.goal)
      const list = await api.listGraphs()
      setGraphs(list)
      const detail = await api.getGraph(graph.id)
      setActiveGraph(graph.id, detail)
      clearStream()
      const { chatMessages: msgs } = useGraphStore.getState()
      api.saveGraphChat(graph.id, msgs).catch(() => {})
      useGraphStore.getState().saveMemory({
        summary: `主题: ${profileToUse.topic} | 背景: ${profileToUse.background} | 目标: ${profileToUse.goal}`,
        key_points: profileToUse.scope,
        user_profile: profileToUse as unknown as Record<string, unknown>,
      })
      setExploreModalOpen(false)
      await run(() => api.agentExplore(graph.id, profileToUse))
    } catch (err) {
      console.error(err)
      setExploring(false)
    }
  }

  // Fallback READY detection — scan all assistant messages for last READY
  useEffect(() => {
    if (userProfile) return
    const assistantWithReady = [...chatMessages].reverse().find(
      (m) => m.role === 'assistant' && parseReady(m.content)
    )
    if (!assistantWithReady) return
    const profile = parseReady(assistantWithReady.content)!
    applyProfile(profile)
    // Strip READY from ALL assistant messages that contain it
    useGraphStore.setState((s) => ({
      chatMessages: s.chatMessages.map((m) =>
        m.role === 'assistant' && m.content.match(/READY::/)
          ? { ...m, content: stripReady(m.content) }
          : m
      ),
    }))
  }, [chatMessages, userProfile])

  function toggleScope(s: string) {
    if (isScopeExplored(s)) return
    setCheckedScope(checkedScope.includes(s) ? checkedScope.filter((x) => x !== s) : [...checkedScope, s])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) setExploreModalOpen(false) }}>
      <div className="w-full max-w-[520px] max-h-[82vh] flex flex-col rounded-2xl overflow-hidden animate-fade-in"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--surface-3)',
          boxShadow: '0 24px 48px -12px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.04)',
        }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 shrink-0"
          style={{ borderBottom: '1px solid var(--surface-3)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'var(--accent-dim)' }}>
              <span className="text-xs" style={{ color: 'var(--accent-blue)' }}>◇</span>
            </div>
            <div>
              <h2 className="text-[14px] font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
                {activeGraph ? '继续探索' : '新探索'}
              </h2>
              <p className="text-[11px] leading-tight" style={{ color: 'var(--text-muted)' }}>
                {chatMessages.length > 1 ? `${chatMessages.length} 条对话` : '描述你想探索的知识领域'}
              </p>
            </div>
          </div>
          <button onClick={() => setExploreModalOpen(false)}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-2)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-2.5">
          {chatMessages.map((msg, i) => {
            // Skip empty assistant messages (stale loading placeholders)
            if (msg.role === 'assistant' && !msg.content && !chatLoading) return null
            if (msg.content === '你好，我想开始探索一个知识领域') return null
            if (msg.content.startsWith('📋 已选择探索范围')) {
              const scopes = msg.content.replace('📋 已选择探索范围：', '').split('、')
              return (
                <div key={i} className="flex flex-wrap gap-1 justify-end">
                  {scopes.map((s) => (
                    <span key={s} className="text-[11px] px-2 py-0.5 rounded-md"
                      style={{ background: 'var(--accent-dim)', color: 'var(--accent-blue)' }}>{s}</span>
                  ))}
                </div>
              )
            }
            const isUser = msg.role === 'user'
            // Strip READY:: from display even if not yet cleaned in store
            const displayContent = msg.role === 'assistant' ? stripReady(msg.content) : msg.content
            if (!displayContent && !chatLoading) return null
            return (
              <div key={i} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                {isUser ? (
                  <div className="max-w-[80%] px-3.5 py-2 rounded-2xl rounded-br-md text-[13px] leading-relaxed whitespace-pre-wrap"
                    style={{ background: 'var(--accent-blue)', color: 'white' }}>
                    {displayContent}
                  </div>
                ) : (
                  <div className="max-w-[85%] px-3.5 py-2 rounded-2xl rounded-bl-md chat-markdown text-[13px] leading-relaxed"
                    style={{ background: 'var(--surface-2)', color: 'var(--text)' }}>
                    {displayContent ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayContent}</ReactMarkdown>
                    ) : (
                      <span className="inline-flex gap-1" style={{ color: 'var(--text-muted)' }}>
                        <span className="animate-subtle-pulse">·</span>
                        <span className="animate-subtle-pulse" style={{ animationDelay: '0.15s' }}>·</span>
                        <span className="animate-subtle-pulse" style={{ animationDelay: '0.3s' }}>·</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* Scope card — inline in message flow */}
          {userProfile && !exploring && (
            <div className="flex justify-start">
              <div className="max-w-[90%] rounded-2xl rounded-bl-md overflow-hidden"
                style={{ border: '1px solid var(--surface-3)', background: 'var(--surface)' }}>
                <div className="px-4 py-2.5" style={{ borderBottom: '1px solid var(--surface-3)', background: 'var(--bg)' }}>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px]" style={{ color: 'var(--accent-blue)' }}>◇</span>
                    <span className="text-[12px] font-medium" style={{ color: 'var(--text)' }}>选择探索范围</span>
                  </div>
                  {userProfile.scope.some((s) => isScopeExplored(s)) && (
                    <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      已探索的模块无法再次选择
                    </p>
                  )}
                </div>
                <div className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {userProfile.scope.map((s) => {
                      const explored = isScopeExplored(s)
                      const label = cleanScopeLabel(s)
                      const checked = checkedScope.includes(s)
                      return (
                        <button key={s} onClick={() => toggleScope(s)}
                          disabled={explored}
                          className="text-[11px] px-2.5 py-1 rounded-lg transition-all duration-150"
                          style={
                            explored
                              ? { background: 'var(--surface-2)', color: 'var(--text-muted)', cursor: 'not-allowed', textDecoration: 'line-through', opacity: 0.6 }
                              : checked
                                ? { background: 'var(--accent-blue)', color: 'white', cursor: 'pointer', boxShadow: '0 1px 3px rgba(74,144,217,0.3)' }
                                : { background: 'var(--bg)', color: 'var(--text-secondary)', border: '1px solid var(--surface-3)', cursor: 'pointer' }
                          }>
                          {explored ? '✓ ' : checked ? '✓ ' : ''}{label}
                        </button>
                      )
                    })}
                  </div>
                  <button onClick={startExplore} disabled={checkedScope.length === 0 || exploring}
                    className="w-full py-2 rounded-lg text-[12px] font-medium transition-all duration-150 disabled:opacity-30"
                    style={{
                      background: checkedScope.length > 0 ? 'var(--accent-blue)' : 'var(--surface-3)',
                      color: checkedScope.length > 0 ? 'white' : 'var(--text-muted)',
                      boxShadow: checkedScope.length > 0 ? '0 1px 3px rgba(74,144,217,0.3)' : 'none',
                    }}>
                    {exploring ? '创建中...' : `开始探索${checkedScope.length > 0 ? ` · ${checkedScope.length} 个模块` : ''}`}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-5 py-3 shrink-0" style={{ borderTop: '1px solid var(--surface-3)' }}>
          <div className="flex items-end gap-2 rounded-xl px-3.5 py-2.5 transition-colors"
            style={{ background: 'var(--bg)', border: '1px solid var(--surface-3)' }}
            onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent-blue)'}
            onBlur={(e) => e.currentTarget.style.borderColor = 'var(--surface-3)'}>
            <textarea value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder="描述你想探索的知识领域..."
              rows={1}
              className="flex-1 bg-transparent outline-none resize-none text-[13px] leading-relaxed"
              style={{ color: 'var(--text)', maxHeight: '80px' }}
            />
            <button onClick={send} disabled={!input.trim() || chatLoading}
              className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-150 disabled:opacity-20"
              style={{ background: 'var(--accent-blue)', color: 'white' }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 11V3M7 3L3.5 6.5M7 3L10.5 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
