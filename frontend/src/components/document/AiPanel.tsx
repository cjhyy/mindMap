import { useEffect, useRef, useState } from 'react'
import { streamChat } from '../../api/client'
import type { ChatMsg } from '../../api/client'

export interface AiComment {
  id: string
  context: string
  content: string
  ts: number
}

interface Props {
  context: string
  fullDoc: string
  position: { x: number; y: number }
  onMerge: (newContent: string) => void
  onComment: (comment: AiComment) => void
  onClose: () => void
}

const PRESETS = [
  { label: '续写', icon: '→', prompt: (ctx: string) => `请根据以下内容继续往下写，保持风格一致，只输出续写部分：\n\n${ctx}` },
  { label: '改写', icon: '↻', prompt: (ctx: string) => `请改写以下内容，更清晰专业，保持原意：\n\n${ctx}` },
  { label: '精简', icon: '↓', prompt: (ctx: string) => `请精简以下内容，去除冗余：\n\n${ctx}` },
  { label: '扩展', icon: '↗', prompt: (ctx: string) => `请扩展以下内容，补充细节和示例：\n\n${ctx}` },
  { label: '英文', icon: 'EN', prompt: (ctx: string) => `翻译为英文，保持 markdown 格式：\n\n${ctx}` },
]

export function AiPanel({ context, fullDoc, position, onMerge, onComment, onClose }: Props) {
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [result, setResult] = useState('')
  const resultRef = useRef('')
  const abortRef = useRef(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const resultEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { resultEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [result])
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { abortRef.current = true; onClose() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Click outside to close
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose()
    }
    setTimeout(() => document.addEventListener('mousedown', handleClick), 100)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  async function runAi(prompt: string) {
    setStreaming(true)
    setResult('')
    resultRef.current = ''
    abortRef.current = false
    const messages: ChatMsg[] = [
      { role: 'user', content: `[文档上下文]\n${fullDoc.slice(0, 2000)}` },
      { role: 'user', content: prompt },
    ]
    try {
      for await (const chunk of streamChat(messages)) {
        if (abortRef.current) break
        resultRef.current += chunk
        setResult(resultRef.current)
      }
    } catch (err) {
      console.error('AI stream error:', err)
      resultRef.current += '\n\n[出错了，请重试]'
      setResult(resultRef.current)
    }
    setStreaming(false)
  }

  function handlePreset(p: typeof PRESETS[number]) {
    runAi(p.prompt(context || fullDoc))
  }

  function handleCustom() {
    if (!input.trim()) return
    runAi(`${input.trim()}\n\n以下是需要处理的内容：\n\n${context || fullDoc}`)
    setInput('')
  }

  function handleMerge() {
    if (!result) return
    if (context) {
      onMerge(fullDoc.replace(context, result.trim()))
    } else {
      onMerge(result.trim())
    }
  }

  function handleComment() {
    if (!result) return
    onComment({
      id: Date.now().toString(36),
      context: context || '(全文)',
      content: result.trim(),
      ts: Date.now(),
    })
    onClose()
  }

  // Clamp position within viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(position.x, window.innerWidth - 360),
    top: Math.min(position.y + 8, window.innerHeight - 320),
    zIndex: 100,
    width: 340,
  }

  return (
    <div ref={panelRef} style={style}
      className="rounded-lg overflow-hidden animate-fade-in border"
      style={{ ...style, background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)' }}>

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5"
        style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium" style={{ color: 'var(--accent-blue)' }}>✦ AI</span>
          {context && (
            <span className="text-[10px] px-1.5 py-0.5 rounded mono truncate max-w-32"
              style={{ background: 'var(--accent-dim)', color: 'var(--accent-blue)' }}>
              {context.length} 字
            </span>
          )}
        </div>
        <button onClick={onClose}
          className="text-[11px] w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--surface-2)] transition-colors"
          style={{ color: 'var(--text-muted)' }}>✕</button>
      </div>

      {/* Presets + input */}
      {!streaming && !result && (
        <>
          <div className="px-3 py-2 flex flex-wrap gap-1" style={{ borderBottom: '1px solid var(--border)' }}>
            {PRESETS.map((p) => (
              <button key={p.label} onClick={() => handlePreset(p)}
                className="text-[10px] px-2 py-0.5 rounded border transition-colors hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]"
                style={{ borderColor: 'var(--border-2)', color: 'var(--text-secondary)' }}>
                <span className="mono mr-0.5">{p.icon}</span>{p.label}
              </button>
            ))}
          </div>
          <div className="px-3 py-2">
            <div className="flex items-end gap-1.5">
              <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleCustom() } }}
                placeholder="告诉 AI 你想怎么改..."
                rows={1} className="flex-1 bg-transparent outline-none resize-none text-[11px] leading-relaxed"
                style={{ color: 'var(--text)', maxHeight: '48px' }} />
              <button onClick={handleCustom} disabled={!input.trim()}
                className="shrink-0 text-[10px] px-2 py-1 rounded font-medium transition-colors disabled:opacity-30 text-white"
                style={{ background: 'var(--accent-blue)' }}>发送</button>
            </div>
          </div>
        </>
      )}

      {/* Result */}
      {(streaming || result) && (
        <div className="max-h-40 overflow-y-auto px-3 py-2">
          <div className="text-[11px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text)' }}>
            {result || <span className="animate-subtle-pulse" style={{ color: 'var(--text-muted)' }}>思考中...</span>}
          </div>
          <div ref={resultEndRef} />
        </div>
      )}

      {/* Actions */}
      {result && !streaming && (
        <div className="flex items-center justify-between px-3 py-1.5" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={() => { setResult(''); resultRef.current = '' }}
            className="text-[10px] px-2 py-0.5 rounded transition-colors"
            style={{ color: 'var(--text-muted)' }}>重试</button>
          <div className="flex items-center gap-1.5">
            <button onClick={onClose} className="text-[10px] px-2 py-0.5 rounded border transition-colors"
              style={{ borderColor: 'var(--border-2)', color: 'var(--text-muted)' }}>放弃</button>
            <button onClick={handleComment} className="text-[10px] px-2 py-0.5 rounded border transition-colors"
              style={{ borderColor: 'var(--accent-dim)', color: 'var(--accent-blue)' }}>批注</button>
            <button onClick={handleMerge} className="text-[10px] px-2.5 py-0.5 rounded font-medium text-white transition-colors"
              style={{ background: 'var(--accent-blue)' }}>融合</button>
          </div>
        </div>
      )}

      {streaming && (
        <div className="flex items-center justify-end px-3 py-1.5" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={() => { abortRef.current = true }}
            className="text-[10px] px-2 py-0.5 rounded border transition-colors"
            style={{ borderColor: 'var(--error)', color: 'var(--error)' }}>停止</button>
        </div>
      )}
    </div>
  )
}
