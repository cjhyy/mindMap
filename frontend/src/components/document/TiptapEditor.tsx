import { useEffect, useRef, useCallback, useMemo, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Highlight from '@tiptap/extension-highlight'
import Typography from '@tiptap/extension-typography'
import Link from '@tiptap/extension-link'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Image from '@tiptap/extension-image'
import Mathematics, { migrateMathStrings } from '@tiptap/extension-mathematics'
import { common, createLowlight } from 'lowlight'
import { marked } from 'marked'
import 'katex/dist/katex.min.css'
import TurndownService from 'turndown'
import { streamChat, AI_MODELS } from '../../api/client'
import type { ChatMsg } from '../../api/client'
import type { AiComment } from './AiPanel'

const lowlight = createLowlight(common)
marked.use({ async: false })

interface Props {
  value: string
  onChange: (md: string) => void
  onSave?: () => void
  onComment?: (comment: AiComment) => void
}

function mdToHtml(md: string): string {
  return marked.parse(md, { async: false }) as string
}

const AI_PRESETS = [
  { label: '续写', icon: '→', prompt: (ctx: string) => `请根据以下内容继续往下写，保持风格一致，只输出续写部分：\n\n${ctx}` },
  { label: '改写', icon: '↻', prompt: (ctx: string) => `请改写以下内容，更清晰专业，保持原意：\n\n${ctx}` },
  { label: '精简', icon: '↓', prompt: (ctx: string) => `请精简以下内容，去除冗余：\n\n${ctx}` },
  { label: '扩展', icon: '↗', prompt: (ctx: string) => `请扩展以下内容，补充细节和示例：\n\n${ctx}` },
  { label: '翻译', icon: 'EN', prompt: (ctx: string) => `翻译为英文，保持 markdown 格式：\n\n${ctx}` },
  { label: '解释', icon: '?', prompt: (ctx: string) => `请用通俗易懂的语言解释以下内容，必要时举例说明：\n\n${ctx}` },
]

export function TiptapEditor({ value, onChange, onSave, onComment }: Props) {
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const onCommentRef = useRef(onComment)
  const suppressRef = useRef(false)
  const internalMdRef = useRef(value)

  // Comment state
  const [commentOpen, setCommentOpen] = useState(false)
  const [commentInput, setCommentInput] = useState('')
  const commentInputRef = useRef<HTMLInputElement>(null)
  const commentSelectionRef = useRef('')

  // AI state
  const [aiOpen, setAiOpen] = useState(false)
  const [aiStreaming, setAiStreaming] = useState(false)
  const [aiResult, setAiResult] = useState('')
  const [aiInput, setAiInput] = useState('')
  const [aiModel, setAiModel] = useState(AI_MODELS[0].id)
  const aiResultRef = useRef('')
  const abortRef = useRef(false)
  const aiInputRef = useRef<HTMLInputElement>(null)
  const selectedTextRef = useRef('')

  const turndown = useMemo(() => {
    const td = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
    })
    td.addRule('taskListItem', {
      filter: (node) => node.nodeName === 'LI' && node.getAttribute('data-type') === 'taskItem',
      replacement: (content, node) => {
        const checked = (node as HTMLElement).getAttribute('data-checked') === 'true'
        return `${checked ? '- [x]' : '- [ ]'} ${content.trim()}\n`
      },
    })
    td.addRule('highlight', {
      filter: 'mark',
      replacement: (content) => `==${content}==`,
    })
    return td
  }, [])

  onChangeRef.current = onChange
  onSaveRef.current = onSave
  onCommentRef.current = onComment

  const initialHtml = useMemo(() => mdToHtml(value), [])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        heading: { levels: [1, 2, 3, 4] },
        dropcursor: { color: 'var(--accent-blue)', width: 2 },
      }),
      Placeholder.configure({
        placeholder: "输入 '/' 打开命令菜单...",
      }),
      Underline,
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: true }),
      Typography,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'tiptap-link' },
      }),
      CodeBlockLowlight.configure({ lowlight }),
      Mathematics,
      Image.configure({ allowBase64: true, inline: false }),
    ],
    content: initialHtml,
    editorProps: {
      attributes: { class: 'tiptap-editor' },
      handleDrop: (view, event) => {
        const files = event.dataTransfer?.files
        if (!files?.length) return false
        const file = files[0]
        if (!file.type.startsWith('image/')) return false
        event.preventDefault()
        const reader = new FileReader()
        reader.onload = () => {
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
          if (pos == null) return
          const node = view.state.schema.nodes.image.create({ src: reader.result as string })
          view.dispatch(view.state.tr.insert(pos, node))
        }
        reader.readAsDataURL(file)
        return true
      },
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items
        if (!items) return false
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            event.preventDefault()
            const file = item.getAsFile()
            if (!file) return false
            const reader = new FileReader()
            reader.onload = () => {
              const node = view.state.schema.nodes.image.create({ src: reader.result as string })
              const pos = view.state.selection.from
              view.dispatch(view.state.tr.insert(pos, node))
            }
            reader.readAsDataURL(file)
            return true
          }
        }
        return false
      },
    },
    onCreate: ({ editor: e }) => {
      // Convert $...$ text into proper math nodes
      migrateMathStrings(e)
    },
    onUpdate: ({ editor: e }) => {
      if (suppressRef.current) return
      const html = e.getHTML()
      const md = turndown.turndown(html)
      internalMdRef.current = md
      onChangeRef.current(md)
    },
  })

  // Sync external value
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (value === internalMdRef.current) return
    suppressRef.current = true
    editor.commands.setContent(mdToHtml(value), { emitUpdate: false })
    migrateMathStrings(editor)
    internalMdRef.current = value
    suppressRef.current = false
  }, [value, editor])

  // Cmd+S
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        onSaveRef.current?.()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const setLink = useCallback(() => {
    if (!editor) return
    const prev = editor.getAttributes('link').href
    const url = window.prompt('链接地址', prev)
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    }
  }, [editor])

  const insertImage = useCallback(() => {
    if (!editor) return
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        const src = reader.result as string
        editor.chain().focus().setImage({ src }).run()
      }
      reader.readAsDataURL(file)
    }
    input.click()
  }, [editor])

  // ── Comment functions ──

  function openComment() {
    if (!editor) return
    const { from, to } = editor.state.selection
    commentSelectionRef.current = editor.state.doc.textBetween(from, to, ' ')
    setCommentOpen(true)
    setCommentInput('')
    setTimeout(() => commentInputRef.current?.focus(), 50)
  }

  function submitComment() {
    if (!commentInput.trim() || !onCommentRef.current) return
    onCommentRef.current({
      id: Date.now().toString(36),
      context: commentSelectionRef.current || '(全文)',
      content: commentInput.trim(),
      ts: Date.now(),
      source: 'manual',
    })
    setCommentOpen(false)
    setCommentInput('')
  }

  // ── AI functions ──

  function openAi() {
    if (!editor) return
    const { from, to } = editor.state.selection
    selectedTextRef.current = editor.state.doc.textBetween(from, to, ' ')
    setAiOpen(true)
    setAiResult('')
    setAiInput('')
    setTimeout(() => aiInputRef.current?.focus(), 50)
  }

  async function runAi(prompt: string) {
    if (!editor) return
    setAiStreaming(true)
    setAiResult('')
    aiResultRef.current = ''
    abortRef.current = false

    const fullDoc = turndown.turndown(editor.getHTML())
    const messages: ChatMsg[] = [
      { role: 'user', content: `[文档上下文]\n${fullDoc.slice(0, 2000)}` },
      { role: 'user', content: prompt },
    ]
    try {
      for await (const chunk of streamChat(messages, aiModel)) {
        if (abortRef.current) break
        aiResultRef.current += chunk
        setAiResult(aiResultRef.current)
      }
    } catch (err) {
      console.error('AI stream error:', err)
      aiResultRef.current += '\n\n[出错了，请重试]'
      setAiResult(aiResultRef.current)
    }
    setAiStreaming(false)
  }

  function handlePreset(p: typeof AI_PRESETS[number]) {
    runAi(p.prompt(selectedTextRef.current))
  }

  function handleCustomAi() {
    if (!aiInput.trim()) return
    runAi(`${aiInput.trim()}\n\n以下是需要处理的内容：\n\n${selectedTextRef.current}`)
    setAiInput('')
  }

  function handleAiReplace() {
    if (!editor || !aiResult) return
    // Replace the selected text with AI result
    const { from, to } = editor.state.selection
    if (from !== to) {
      editor.chain().focus()
        .deleteRange({ from, to })
        .insertContentAt(from, mdToHtml(aiResult.trim()))
        .run()
    } else {
      editor.chain().focus().insertContent(mdToHtml(aiResult.trim())).run()
    }
    closeAi()
  }

  function handleAiInsertBelow() {
    if (!editor || !aiResult) return
    const { to } = editor.state.selection
    editor.chain().focus()
      .insertContentAt(to, '<p></p>' + mdToHtml(aiResult.trim()))
      .run()
    closeAi()
  }

  function closeAi() {
    abortRef.current = true
    setAiOpen(false)
    setAiResult('')
    setAiStreaming(false)
    setAiInput('')
  }

  if (!editor) return null

  return (
    <div className="tiptap-wrap">
      {/* ── Bubble Menu ── */}
      <BubbleMenu editor={editor} className="tiptap-bubble-menu">
        <BubbleBtn active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()} title="加粗">
          <b>B</b>
        </BubbleBtn>
        <BubbleBtn active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()} title="斜体">
          <i>I</i>
        </BubbleBtn>
        <BubbleBtn active={editor.isActive('underline')}
          onClick={() => editor.chain().focus().toggleUnderline().run()} title="下划线">
          <u>U</u>
        </BubbleBtn>
        <BubbleBtn active={editor.isActive('strike')}
          onClick={() => editor.chain().focus().toggleStrike().run()} title="删除线">
          <s>S</s>
        </BubbleBtn>
        <BubbleBtn active={editor.isActive('code')}
          onClick={() => editor.chain().focus().toggleCode().run()} title="行内代码">
          <span className="mono text-[11px]">&lt;/&gt;</span>
        </BubbleBtn>
        <BubbleBtn active={editor.isActive('highlight')}
          onClick={() => editor.chain().focus().toggleHighlight().run()} title="高亮">
          <span className="text-[12px]">H</span>
        </BubbleBtn>
        <div className="bubble-divider" />
        <BubbleBtn active={editor.isActive('link')} onClick={setLink} title="链接">
          <span className="text-[12px]">🔗</span>
        </BubbleBtn>
        <BubbleBtn active={false} onClick={insertImage} title="插入图片">
          <span className="text-[12px]">🖼</span>
        </BubbleBtn>
        <div className="bubble-divider" />
        <BubbleBtn active={commentOpen} onClick={openComment} title="添加批注">
          <span className="text-[12px]">💬</span>
        </BubbleBtn>
        <BubbleBtn active={aiOpen} onClick={openAi} title="AI 助手">
          <span className="text-[11px]" style={{ color: 'var(--accent-blue)' }}>✦</span>
        </BubbleBtn>
      </BubbleMenu>

      <EditorContent editor={editor} />

      {/* ── Comment Input Popup ── */}
      {commentOpen && (
        <div className="comment-float-panel animate-fade-in">
          <div className="flex items-center gap-2 px-3 py-1.5"
            style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
            <span className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>💬 批注</span>
            {commentSelectionRef.current && (
              <span className="text-[10px] px-1.5 py-0.5 rounded mono truncate max-w-40"
                style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                "{commentSelectionRef.current.slice(0, 20)}{commentSelectionRef.current.length > 20 ? '...' : ''}"
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 px-3 py-2">
            <input
              ref={commentInputRef}
              value={commentInput}
              onChange={(e) => setCommentInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); submitComment() }
                if (e.key === 'Escape') setCommentOpen(false)
              }}
              placeholder="输入批注内容..."
              className="ai-float-input"
            />
            <button onClick={submitComment} disabled={!commentInput.trim()} className="ai-float-send">
              发送
            </button>
            <button onClick={() => setCommentOpen(false)} className="ai-float-close">✕</button>
          </div>
        </div>
      )}

      {/* ── AI Floating Panel ── */}
      {aiOpen && (
        <AiFloatingPanel
          streaming={aiStreaming}
          result={aiResult}
          input={aiInput}
          inputRef={aiInputRef}
          onInputChange={setAiInput}
          onPreset={handlePreset}
          onCustom={handleCustomAi}
          onReplace={handleAiReplace}
          onInsertBelow={handleAiInsertBelow}
          onRetry={() => { setAiResult(''); aiResultRef.current = '' }}
          onStop={() => { abortRef.current = true }}
          onClose={closeAi}
          presets={AI_PRESETS}
          selectedText={selectedTextRef.current}
          model={aiModel}
          onModelChange={setAiModel}
        />
      )}
    </div>
  )
}

/* ── AI Floating Panel ── */
function AiFloatingPanel({ streaming, result, input, inputRef, onInputChange, onPreset, onCustom, onReplace, onInsertBelow, onRetry, onStop, onClose, presets, selectedText, model, onModelChange }: {
  streaming: boolean
  result: string
  input: string
  inputRef: React.RefObject<HTMLInputElement | null>
  onInputChange: (v: string) => void
  onPreset: (p: typeof AI_PRESETS[number]) => void
  onCustom: () => void
  onReplace: () => void
  onInsertBelow: () => void
  onRetry: () => void
  onStop: () => void
  onClose: () => void
  presets: typeof AI_PRESETS
  selectedText: string
  model: string
  onModelChange: (m: string) => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const resultEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => { resultEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [result])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div ref={panelRef} className="ai-float-panel animate-fade-in">
      {/* Header */}
      <div className="ai-float-header">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium" style={{ color: 'var(--accent-blue)' }}>✦ AI</span>
          <select
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            className="ai-model-select"
          >
            {AI_MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          {selectedText && (
            <span className="text-[10px] px-1.5 py-0.5 rounded mono"
              style={{ background: 'var(--accent-dim)', color: 'var(--accent-blue)' }}>
              {selectedText.length} 字
            </span>
          )}
        </div>
        <button onClick={onClose} className="ai-float-close">✕</button>
      </div>

      {/* Presets + custom input (before streaming) */}
      {!streaming && !result && (
        <>
          <div className="ai-float-presets">
            {presets.map((p) => (
              <button key={p.label} onClick={() => onPreset(p)} className="ai-preset-btn">
                <span className="mono mr-0.5">{p.icon}</span>{p.label}
              </button>
            ))}
          </div>
          <div className="ai-float-input-row">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onCustom() } }}
              placeholder="告诉 AI 你想怎么改..."
              className="ai-float-input"
            />
            <button onClick={onCustom} disabled={!input.trim()} className="ai-float-send">发送</button>
          </div>
        </>
      )}

      {/* Result */}
      {(streaming || result) && (
        <div className="ai-float-result">
          <div className="text-[11px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text)' }}>
            {result || <span className="animate-subtle-pulse" style={{ color: 'var(--text-muted)' }}>思考中...</span>}
          </div>
          <div ref={resultEndRef} />
        </div>
      )}

      {/* Actions */}
      {result && !streaming && (
        <div className="ai-float-actions">
          <button onClick={onRetry} className="ai-action-btn muted">重试</button>
          <div className="flex items-center gap-1.5">
            <button onClick={onClose} className="ai-action-btn muted border">放弃</button>
            <button onClick={onInsertBelow} className="ai-action-btn outline">插入下方</button>
            <button onClick={onReplace} className="ai-action-btn primary">替换</button>
          </div>
        </div>
      )}

      {streaming && (
        <div className="ai-float-actions" style={{ justifyContent: 'flex-end' }}>
          <button onClick={onStop} className="ai-action-btn"
            style={{ borderColor: 'var(--error)', color: 'var(--error)' }}>停止</button>
        </div>
      )}
    </div>
  )
}

/* ── Bubble button ── */
function BubbleBtn({ active, onClick, title, children }: {
  active: boolean; onClick: () => void; title: string; children: React.ReactNode
}) {
  return (
    <button type="button" onClick={onClick} title={title}
      className={`bubble-btn ${active ? 'active' : ''}`}>
      {children}
    </button>
  )
}
