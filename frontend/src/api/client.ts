const BASE = '/api'

export interface UserProfile {
  topic: string
  background: string
  goal: string
  scope: string[]
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json()
}

export const api = {
  // Graphs
  listGraphs: () => request<import('../types').GraphMeta[]>('/graphs'),
  createGraph: (name: string, description: string) =>
    request<import('../types').GraphMeta>('/graphs', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),
  getGraph: (id: string) => request<import('../types').GraphDetail>(`/graphs/${id}`),
  deleteGraph: (id: string) => request(`/graphs/${id}`, { method: 'DELETE' }),

  // Render
  renderMermaid: (id: string, maxDepth = 3) =>
    request<{ format: string; content: string }>(`/graphs/${id}/render/mermaid?max_depth=${maxDepth}`),
  renderMarkdown: (id: string, maxDepth = 4) =>
    request<{ format: string; content: string }>(`/graphs/${id}/render/markdown?max_depth=${maxDepth}`),

  // Nodes
  listNodes: (graphId: string, params?: { keyword?: string; domain?: string; status?: string }) => {
    const q = new URLSearchParams()
    if (params?.keyword) q.set('keyword', params.keyword)
    if (params?.domain) q.set('domain', params.domain)
    if (params?.status) q.set('status', params.status)
    return request<import('../types').NodeListItem[]>(`/graphs/${graphId}/nodes?${q}`)
  },
  getNode: (graphId: string, nodeId: string) =>
    request<import('../types').NodeDetail>(`/graphs/${graphId}/nodes/${nodeId}`),
  updateNode: (graphId: string, nodeId: string, data: Partial<import('../types').NodeData>) =>
    request<import('../types').NodeDetail>(`/graphs/${graphId}/nodes/${nodeId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteNodeFromGraph: (graphId: string, nodeId: string) =>
    request(`/graphs/${graphId}/nodes/${nodeId}`, { method: 'DELETE' }),
  getNodeDoc: (graphId: string, nodeId: string) =>
    request<import('../types').NodeDocResponse>(`/graphs/${graphId}/nodes/${nodeId}/doc`),
  updateNodeDoc: (graphId: string, nodeId: string, content: string) =>
    request(`/graphs/${graphId}/nodes/${nodeId}/doc`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),
  deleteNodeDoc: (graphId: string, nodeId: string) =>
    request(`/graphs/${graphId}/nodes/${nodeId}/doc`, { method: 'DELETE' }),

  // Markdown
  exportMarkdown: (graphId: string) =>
    request<import('../types').MarkdownExport>(`/graphs/${graphId}/markdown/export`),

  // Graph Chat & Memory
  getGraphChat: (graphId: string) =>
    request<{ messages: { role: string; content: string }[] }>(`/graphs/${graphId}/chat`),
  saveGraphChat: (graphId: string, messages: { role: string; content: string }[]) =>
    request(`/graphs/${graphId}/chat`, {
      method: 'PUT',
      body: JSON.stringify({ messages }),
    }),
  getGraphMemory: (graphId: string) =>
    request<{ summary?: string; key_points?: string[]; user_profile?: Record<string, unknown> }>(`/graphs/${graphId}/memory`),
  saveGraphMemory: (graphId: string, memory: { summary: string; key_points: string[]; user_profile?: Record<string, unknown> | null }) =>
    request(`/graphs/${graphId}/memory`, {
      method: 'PUT',
      body: JSON.stringify(memory),
    }),

  // Agent
  agentCreate: (graphId: string, task: string, background?: string) =>
    request<import('../types').OperationResponse>(`/graphs/${graphId}/agent/create`, {
      method: 'POST',
      body: JSON.stringify({ task, background: background ?? '' }),
    }),
  agentExpand: (graphId: string, nodeLabel: string) =>
    request<import('../types').OperationResponse>(`/graphs/${graphId}/agent/expand`, {
      method: 'POST',
      body: JSON.stringify({ node_label: nodeLabel }),
    }),
  agentQuery: (graphId: string, query: string) =>
    request<import('../types').OperationResponse>(`/graphs/${graphId}/agent/query`, {
      method: 'POST',
      body: JSON.stringify({ query }),
    }),
  agentConnect: (graphId: string) =>
    request<import('../types').OperationResponse>(`/graphs/${graphId}/agent/connect`, {
      method: 'POST',
    }),
  agentAuto: (graphId: string) =>
    request<import('../types').OperationResponse>(`/graphs/${graphId}/agent/auto`, {
      method: 'POST',
    }),
  agentFillDocs: (graphId: string) =>
    request<import('../types').OperationResponse>(`/graphs/${graphId}/agent/fill-docs`, {
      method: 'POST',
    }),
  agentExplore: (graphId: string, profile: UserProfile) =>
    request<import('../types').OperationResponse>(`/graphs/${graphId}/agent/explore`, {
      method: 'POST',
      body: JSON.stringify(profile),
    }),

  // Operations
  getOperation: (opId: string) =>
    request<import('../types').OperationStatus>(`/operations/${opId}`),
  cancelOperation: (opId: string) =>
    request<import('../types').OperationStatus>(`/operations/${opId}`, { method: 'DELETE' }),
  listOperations: (graphId?: string) => {
    const q = graphId ? `?graph_id=${graphId}` : ''
    return request<import('../types').OperationStatus[]>(`/operations${q}`)
  },
}

export interface ChatMsg { role: 'user' | 'assistant'; content: string }

export async function* streamChat(messages: ChatMsg[]): AsyncGenerator<string> {
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6)
      if (data === '[DONE]') return
      try {
        const chunk = JSON.parse(data)
        if (chunk.content) yield chunk.content
      } catch { /* ignore */ }
    }
  }
}

export function subscribeToOperation(
  opId: string,
  onEvent: (e: import('../types').StreamEvent) => void,
  onDone: () => void,
): () => void {
  const es = new EventSource(`/api/operations/${opId}/stream`)
  const handle = (raw: MessageEvent) => {
    try { onEvent(JSON.parse(raw.data)) } catch { /* ignore */ }
  }
  es.addEventListener('message', handle)
  es.addEventListener('started', handle)
  es.addEventListener('tool_call', handle)
  es.addEventListener('turn_end', handle)
  es.addEventListener('heartbeat', () => {/* keep-alive, ignore */})
  es.addEventListener('done', (e: MessageEvent) => { handle(e); onDone(); es.close() })
  es.addEventListener('cancelled', (e: MessageEvent) => { handle(e); onDone(); es.close() })
  es.onerror = () => { onDone(); es.close() }
  return () => es.close()
}
