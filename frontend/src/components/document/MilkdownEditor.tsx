import { useEffect, useRef } from 'react'
import { Crepe } from '@milkdown/crepe'
import { replaceAll } from '@milkdown/kit/utils'

import '@milkdown/crepe/theme/frame.css'
import 'katex/dist/katex.min.css'

interface Props {
  value: string
  onChange: (md: string) => void
  onSave?: () => void
}

export function MilkdownEditor({ value, onChange, onSave }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const crepeRef = useRef<Crepe | null>(null)
  const readyRef = useRef(false)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const valueRef = useRef(value)
  const suppressRef = useRef(false)

  onChangeRef.current = onChange
  onSaveRef.current = onSave
  valueRef.current = value

  // Create editor once
  useEffect(() => {
    if (!containerRef.current) return
    let destroyed = false
    readyRef.current = false

    const crepe = new Crepe({
      root: containerRef.current,
      defaultValue: valueRef.current,
      featureConfigs: {
        [Crepe.Feature.Placeholder]: {
          text: "输入 '/' 打开命令菜单...",
        },
      },
    })

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, md, prev) => {
        if (suppressRef.current || !readyRef.current) return
        if (md !== prev) onChangeRef.current(md)
      })
    })

    crepe.create().then(() => {
      if (destroyed) {
        try { crepe.destroy() } catch { /* ignore */ }
        return
      }
      crepeRef.current = crepe
      readyRef.current = true
    }).catch(console.error)

    return () => {
      destroyed = true
      readyRef.current = false
      const ref = crepeRef.current
      crepeRef.current = null
      if (ref) {
        try { ref.destroy() } catch { /* ignore destroy errors */ }
      }
    }
  }, [])

  // Sync external value changes
  useEffect(() => {
    if (!readyRef.current || !crepeRef.current) return
    try {
      const current = crepeRef.current.getMarkdown()
      if (value !== current) {
        suppressRef.current = true
        crepeRef.current.editor.action(replaceAll(value))
        suppressRef.current = false
      }
    } catch {
      // Editor not ready or destroyed — ignore
    }
  }, [value])

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

  return (
    <div ref={containerRef} className="milkdown-crepe flex-1 min-h-0 overflow-y-auto" />
  )
}
