interface Props { status: string; size?: 'sm' | 'md' }

const styles: Record<string, { color: string; bg: string; border: string }> = {
  unexplored: { color: 'var(--text-muted)', bg: 'transparent', border: 'var(--border-2)' },
  explored:   { color: 'var(--info)', bg: 'var(--info-dim)', border: 'rgba(126,184,218,0.2)' },
  expanded:   { color: 'var(--accent)', bg: 'var(--accent-dim)', border: 'rgba(212,165,116,0.2)' },
  pending:    { color: 'var(--text-muted)', bg: 'transparent', border: 'var(--border-2)' },
  running:    { color: 'var(--warn)', bg: 'var(--warn-dim)', border: 'rgba(224,164,88,0.2)' },
  completed:  { color: 'var(--accent)', bg: 'var(--accent-dim)', border: 'rgba(212,165,116,0.2)' },
  cancelled:  { color: 'var(--text-muted)', bg: 'transparent', border: 'var(--border-2)' },
  failed:     { color: 'var(--error)', bg: 'var(--error-dim)', border: 'rgba(212,106,106,0.2)' },
}

const marks: Record<string, string> = {
  unexplored: '·', explored: '○', expanded: '✓',
  pending: '·', running: '◎', completed: '✓', cancelled: '✕', failed: '✗',
}

export function StatusBadge({ status, size = 'sm' }: Props) {
  const s = styles[status] ?? styles.unexplored
  const mark = marks[status] ?? '·'
  const pad = size === 'md' ? 'px-2 py-0.5 text-[11px]' : 'px-1.5 py-px text-[10px]'
  return (
    <span className={`inline-flex items-center gap-1 rounded mono ${pad} ${status === 'running' ? 'animate-subtle-pulse' : ''}`}
      style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}` }}>
      <span>{mark}</span>
      <span>{status}</span>
    </span>
  )
}
