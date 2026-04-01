import { useEffect, useRef, useState } from 'react'
import { api, streamChat } from '../../api/client'
import type { UserProfile } from '../../api/client'
import { useGraphStore } from '../../stores/graphStore'
import { useOperation } from '../../hooks/useOperation'

function parseReady(text: string): UserProfile | null {
  const match = text.match(/READY::(\{.+\})/s)
  if (!match) return null
  try { return JSON.parse(match[1]) as UserProfile } catch { return null }
}

function stripReady(text: string): string {
  return text.replace(/\nREADY::\{.+\}/s, '').trim()
}

interface Props { compact?: boolean }

export function ChatView({ compact = false }: Props) {
  const {
    chatMessages, chatLoading, userProfile, checkedScope, graphMemory,
    setChatLoading, setUserProfile, setCheckedScope,
    setGraphs, setActiveGraph, setMode,
    clearStream, saveCurrentChat,
  } = useGraphStore()

  const { run } = useOperation()
  const [input, setInput] = useState('')
  const [exploring, setExploring] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, chatLoading])

  useEffect(() => {
    if (chatMessages.length === 0 && !compact) {
      streamAssistant([{ role: 'user', content: '你好，我想开始探索一个知识领域' }])
    }
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
    const scopeRecord = `📋 已选择探索范围：${checkedScope.join('、')}`
    useGraphStore.setState((s) => ({
      chatMessages: [...s.chatMessages,
        { role: 'user' as const, content: scopeRecord },
        { role: 'assistant' as const, content: `开始构建「${userProfile.topic}」知识图谱，涵盖 ${checkedScope.length} 个模块。` },
      ],
    }))
    try {
      const graph = await api.createGraph(userProfile.topic, userProfile.goal)
      const list = await api.listGraphs()
      setGraphs(list)
      const detail = await api.getGraph(graph.id)
      setActiveGraph(graph.id, detail)
      setMode('graph')
      clearStream()
      const { chatMessages } = useGraphStore.getState()
      api.saveGraphChat(graph.id, chatMessages).catch(() => {})
      generateMemory(graph.id, chatMessages, profileToUse)
      await run(() => api.agentExplore(graph.id, profileToUse))
    } catch (err) {
      console.error(err)
      setExploring(false)
    }
  }

  async function generateMemory(graphId: string, _messages: { role: string; content: string }[], profile: UserProfile) {
    useGraphStore.getState().saveMemory({
      summary: `主题: ${profile.topic} | 背景: ${profile.background} | 目标: ${profile.goal}`,
      key_points: profile.scope,
      user_profile: profile as unknown as Record<string, unknown>,
    })
  }

  function toggleScope(s: string) {
    setCheckedScope(checkedScope.includes(s) ? checkedScope.filter((x) => x !== s) : [...checkedScope, s])
  }

  const hasExplorationRecord = chatMessages.some((m) => m.content.startsWith('📋 已选择探索范围'))

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className={`flex-1 overflow-y-auto flex flex-col gap-3 ${
        compact ? 'px-3 py-3' : 'px-5 py-6 max-w-xl mx-auto w-full'
      }`}>
        {graphMemory && !compact && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md text-[11px]"
            style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid rgba(212,165,116,0.15)' }}>
            <span style={{ fontSize: '12px' }}>◇</span>
            <span className="truncate">{graphMemory.summary}</span>
          </div>
        )}

        {chatMessages.map((msg, i) => {
          if (msg.content.startsWith('📋 已选择探索范围')) {
            const scopes = msg.content.replace('📋 已选择探索范围：', '').split('、')
            return <ScopeRecord key={i} scopes={scopes} />
          }
          return <MessageBubble key={i} role={msg.role} content={msg.content} compact={compact} />
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

      {/* Scope Selection */}
      {userProfile && !exploring && !hasExplorationRecord && (
        <div className={`shrink-0 ${compact ? 'px-3 py-2' : 'px-5 py-4 max-w-xl mx-auto w-full'}`}
          style={{ borderTop: '1px solid var(--border)' }}>
          <div className="text-[11px] font-medium mb-2" style={{ color: 'var(--accent)' }}>
            选择探索范围
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {userProfile.scope.map((s) => {
              const checked = checkedScope.includes(s)
              return (
                <div key={s} role="button" tabIndex={0} onClick={() => toggleScope(s)}
                  onKeyDown={(e) => { if (e.key === 'Enter') toggleScope(s) }}
                  className="text-[11px] px-2.5 py-1 rounded cursor-pointer transition-all duration-150"
                  style={checked
                    ? { background: 'var(--accent)', color: 'var(--bg)', border: '1px solid var(--accent)' }
                    : { background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-2)' }
                  }>
                  {checked ? '✓ ' : ''}{s}
                </div>
              )
            })}
          </div>
          <div role="button" tabIndex={0} onClick={startExplore}
            onKeyDown={(e) => { if (e.key === 'Enter') startExplore() }}
            className={`btn-primary w-full py-2 text-center ${checkedScope.length === 0 ? 'opacity-40 pointer-events-none' : ''}`}>
            开始探索{checkedScope.length > 0 ? ` · ${checkedScope.length} 个模块` : ''}
          </div>
        </div>
      )}

      {/* Input */}
      <div className={`shrink-0 pb-3 ${compact ? 'px-3' : 'px-5 max-w-xl mx-auto w-full'}`}>
        <div className="flex items-end gap-2 rounded-lg px-3 py-2"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder={compact ? '补充需求...' : '描述你想探索的知识领域...'}
            rows={1}
            className="flex-1 bg-transparent outline-none resize-none text-[13px] leading-relaxed"
            style={{ color: 'var(--text)', maxHeight: '80px' }}
          />
          <div role="button" tabIndex={0} onClick={send}
            onKeyDown={(e) => { if (e.key === 'Enter') send() }}
            className={`shrink-0 w-7 h-7 rounded flex items-center justify-center cursor-pointer transition-all duration-150 text-[12px] font-bold ${
              !input.trim() || chatLoading ? 'opacity-20 pointer-events-none' : ''
            }`}
            style={{ background: 'var(--accent)', color: 'var(--bg)' }}>
            ↑
          </div>
        </div>
      </div>
    </div>
  )
}

function ScopeRecord({ scopes }: { scopes: string[] }) {
  return (
    <div className="flex justify-end animate-fade-in">
      <div className="max-w-[85%] rounded-lg px-3.5 py-2.5"
        style={{ background: 'var(--surface)', border: '1px solid rgba(212,165,116,0.2)' }}>
        <div className="text-[10px] font-medium mb-1.5" style={{ color: 'var(--accent)' }}>已选择探索范围</div>
        <div className="flex flex-wrap gap-1">
          {scopes.map((s) => (
            <span key={s} className="text-[11px] px-2 py-0.5 rounded"
              style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>{s}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ role, content, compact }: { role: string; content: string; compact: boolean }) {
  const isUser = role === 'user'
  if (content === '你好，我想开始探索一个知识领域') return null
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-fade-in`}>
      <div className={`${compact ? 'max-w-[95%] text-[12px]' : 'max-w-[80%] text-[13px]'} px-3.5 py-2 rounded-lg leading-relaxed whitespace-pre-wrap`}
        style={isUser
          ? { background: 'var(--accent)', color: 'var(--bg)' }
          : { background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' }
        }>
        {content || <span style={{ opacity: 0.3 }}>···</span>}
      </div>
    </div>
  )
}
