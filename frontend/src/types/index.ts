export interface GraphMeta {
  id: string
  name: string
  description: string
  node_count: number
  edge_count: number
  created_at: string
  updated_at: string
}

export interface GraphDetail extends GraphMeta {
  graph_data: GraphData
}

export interface GraphData {
  name: string
  description: string
  nodes: Record<string, NodeData>
  edges: Record<string, EdgeData>
  root_node_id: string | null
  created_at: string
  updated_at: string
}

export interface NodeData {
  id: string
  label: string
  description: string
  domain: string
  level: number
  status: 'unexplored' | 'explored' | 'expanded'
  tags: string[]
  source_urls: string[]
  parent_id: string | null
  has_doc: boolean
  doc_summary: string
  doc_sections: string[]
  content_depth: 'shallow' | 'medium' | 'deep'
  created_at: string
  updated_at: string
}

export interface EdgeData {
  id: string
  source_id: string
  target_id: string
  edge_type: 'parent_child' | 'cross_domain' | 'prerequisite' | 'related'
  label: string
  weight: number
  created_at: string
}

export interface NodeDetail {
  id: string
  label: string
  description: string
  domain: string
  level: number
  status: string
  tags: string[]
  source_urls: string[]
  parent_id: string | null
  children: NodeData[]
  cross_connections: NodeConnection[]
  has_doc: boolean
  content_depth: string
  doc_summary: string
  doc_sections: string[]
  doc_url: string | null
  created_at: string
  updated_at: string
}

export interface NodeConnection {
  edge_id: string
  node_id: string
  label: string
  edge_type: string
  edge_label: string
}

export interface OperationResponse {
  operation_id: string
  graph_id: string
  status: string
  stream_url: string
}

export interface OperationStatus {
  operation_id: string
  graph_id: string
  operation_type: string
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed'
  result: string | null
  duration_seconds: number | null
  turns: number | null
  tool_calls: number | null
  error: string | null
}

export interface StreamEvent {
  type: 'started' | 'tool_call' | 'turn_end' | 'done' | 'cancelled' | 'heartbeat' | 'message'
  tool?: string
  turn?: number
  tool_calls?: number
  duration_ms?: number
  status?: string
  duration?: number
  result?: string
  error?: string
  content?: string
}

export interface NodeDocResponse {
  node_id: string
  label: string
  content: string
  sections: string[]
}

export interface NodeListItem {
  id: string
  label: string
  domain: string
  level: number
  status: string
  parent_id: string | null
  children_count: number
  description: string
}

export interface MarkdownExport {
  content: string
  node_count: number
  edge_count: number
}
