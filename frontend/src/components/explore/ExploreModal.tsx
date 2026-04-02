import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api, streamChat } from '../../api/client'
import type { UserProfile } from '../../api/client'
import { useGraphStore } from '../../stores/graphStore'
import { useOperation } from '../../hooks/useOperation'

function parseReady(text: string): UserProfile | null {
  // Match READY:: at start of line or after newline, with JSON object
  const match = text.match(/READY::(\{[\s\S]+\})\s*$/)
  if (!match) return null
  try { return JSON.parse(match[1]) as UserProfile } catch { return null }
}

function stripReady(text: string): string {
  return text.replace(/\n?READY::(\{[\s\S]+\})\s*$/, '').trim()
}

export function ExploreModal() {
  const {
    chatMessages, chatLoading, userProfile, checkedScope, graphMemory,
    setChatLoading, setUserProfile, setCheckedScope,
    setGraphs, setActiveGraph, setExploreModalOpen,
    clearStream, clearChat, saveCurrentChat,
  } = useGraphStore()

  const { run } = useOperation()
  const [input, setInput] = useState('')
  const [exploring, setExploring] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const initRef = useRef(false)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, chatLoading])

  // Init conversation with static welcome message
  useEffect(() => {
    if (initRef.current) return
    initRef.current = true
    clearChat()
    setUserProfile(null)
    useGraphStore.setState({
      chatMessages: [{
        role: 'assistant',
        content: '你好！我可以帮你探索任何知识领域。\n\n请告诉我：\n1. 你想探索什么主题？\n2. 你的背景和基础如何？\n3. 你的学习目标是什么？\n\n比如："我想系统学习机器学习，有 Python 基础，目标是能独立完成项目"',
      }],
    })
  }, [])

  async function streamAssistant(history: { role: 'user' | 'assistant'; content: string }[]) {
    setChatLoading(true)
    useGraphStore.setState((s) => ({
      chatMessages: [...s.chatMessages, { role: 'assistant', content: '' }],
    }))
    const memoryContext = graphMemory?.summary
      ? [{ role: 'user' as const, content: `[上下文记忆] ${graphMemory.summary}` }, ...history]
      : history
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
        setUserProfile(profile)
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
    const profileToUse = { ...userProfile, scope: checkedScope }
    try {
      const graph = await api.createGraph(userProfile.topic, userProfile.goal)
      const list = await api.listGraphs()
      setGraphs(list)
      const detail = await api.getGraph(graph.id)
      setActiveGraph(graph.id, detail)
      clearStream()
      const { chatMessages: msgs } = useGraphStore.getState()
      api.saveGraphChat(graph.id, msgs).catch(() => {})
      // Save memory
      useGraphStore.getState().saveMemory({
        summary: `主题: ${profileToUse.topic} | 背景: ${profileToUse.background} | 目标: ${profileToUse.goal}`,
        key_points: profileToUse.scope,
        user_profile: profileToUse as unknown as Record<string, unknown>,
      })
      // Close modal
      setExploreModalOpen(false)
      // Start exploration
      await run(() => api.agentExplore(graph.id, profileToUse))
    } catch (err) {
      console.error(err)
      setExploring(false)
    }
  }

  function toggleScope(s: string) {
    setCheckedScope(checkedScope.includes(s) ? checkedScope.filter((x) => x !== s) : [...checkedScope, s])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-xl overflow-hidden animate-fade-in"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}>

        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-3 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <h2 className="display text-[15px] font-semibold" style={{ color: 'var(--text)' }}>新探索</h2>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>描述你想探索的知识领域</p>
          </div>
          <button onClick={() => setExploreModalOpen(false)}
            className="text-[14px] w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--surface-2)] transition-colors"
            style={{ color: 'var(--text-muted)' }}>
            ✕
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
          {chatMessages.map((msg, i) => {
            if (msg.content === '你好，我想开始探索一个知识领域') return null
            if (msg.content.startsWith('📋 已选择探索范围')) {
              const scopes = msg.content.replace('📋 已选择探索范围：', '').split('、')
              return (
                <div key={i} className="flex flex-wrap gap-1 justify-end">
                  {scopes.map((s) => (
                    <span key={s} className="text-[11px] px-2 py-0.5 rounded"
                      style={{ background: 'var(--accent-dim)', color: 'var(--accent-blue)' }}>{s}</span>
                  ))}
                </div>
              )
            }
            const isUser = msg.role === 'user'
            return (
              <div key={i} className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-fade-in`}>
                {isUser ? (
                  <div className="max-w-[85%] px-3.5 py-2 rounded-lg text-[13px] leading-relaxed whitespace-pre-wrap"
                    style={{ background: 'var(--accent-blue)', color: 'white' }}>
                    {msg.content}
                  </div>
                ) : (
                  <div className="max-w-[85%] px-3.5 py-2 rounded-lg chat-markdown text-[13px] leading-relaxed"
                    style={{ background: 'var(--surface-2)', color: 'var(--text)' }}>
                    {msg.content ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    ) : (
                      <span style={{ opacity: 0.3 }}>···</span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {chatLoading && (
            <div className="flex justify-start">
              <div className="px-3.5 py-2 rounded-lg text-sm"
                style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                <span className="animate-subtle-pulse mono text-[11px]">···</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Scope selection */}
        {userProfile && !exploring && (
          <div className="px-5 py-3 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
            <div className="text-[11px] font-medium mb-2" style={{ color: 'var(--accent-blue)' }}>选择探索范围</div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {userProfile.scope.map((s) => {
                const checked = checkedScope.includes(s)
                return (
                  <button key={s} onClick={() => toggleScope(s)}
                    className="text-[11px] px-2.5 py-1 rounded cursor-pointer transition-all duration-150"
                    style={checked
                      ? { background: 'var(--accent-blue)', color: 'white', border: '1px solid var(--accent-blue)' }
                      : { background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-2)' }
                    }>
                    {checked ? '✓ ' : ''}{s}
                  </button>
                )
              })}
            </div>
            <button onClick={startExplore} disabled={checkedScope.length === 0 || exploring}
              className={`btn-primary w-full py-2 text-center ${checkedScope.length === 0 ? 'opacity-40' : ''}`}>
              {exploring ? '创建中...' : `开始探索${checkedScope.length > 0 ? ` · ${checkedScope.length} 个模块` : ''}`}
            </button>
          </div>
        )}

        {/* Input */}
        {!userProfile && (
          <div className="px-5 py-3 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
            <div className="flex items-end gap-2 rounded-lg px-3 py-2"
              style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
              <textarea value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                placeholder="描述你想探索的知识领域..."
                rows={1}
                className="flex-1 bg-transparent outline-none resize-none text-[13px] leading-relaxed"
                style={{ color: 'var(--text)', maxHeight: '80px' }}
              />
              <button onClick={send} disabled={!input.trim() || chatLoading}
                className="shrink-0 w-7 h-7 rounded flex items-center justify-center transition-all duration-150 text-[12px] font-bold disabled:opacity-20"
                style={{ background: 'var(--accent-blue)', color: 'white' }}>
                ↑
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
