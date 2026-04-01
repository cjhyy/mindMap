import { create } from 'zustand'
import type { GraphMeta, GraphDetail, OperationStatus, StreamEvent } from '../types'
import type { ChatMsg, UserProfile } from '../api/client'
import { api } from '../api/client'

export type AppMode = 'chat' | 'graph'  // kept for compat but unused in new layout

export interface ProgressEntry {
  type: 'tool' | 'turn' | 'status' | 'phase' | 'nodes'
  text: string
  ts: number
}

export interface GraphMemory {
  summary: string
  key_points: string[]
  user_profile?: Record<string, unknown> | null
}

/** Per-graph session cache (in memory) */
interface GraphSession {
  chatMessages: ChatMsg[]
  progressLog: ProgressEntry[]
  streamEvents: StreamEvent[]
  graphMemory: GraphMemory | null
}

interface GraphStore {
  // App mode (legacy)
  mode: AppMode
  setMode: (m: AppMode) => void

  // Explore modal
  exploreModalOpen: boolean
  setExploreModalOpen: (v: boolean) => void

  // Chat (per-graph when graphId available, global for new exploration)
  chatMessages: ChatMsg[]
  chatLoading: boolean
  userProfile: UserProfile | null
  checkedScope: string[]
  graphMemory: GraphMemory | null

  pushChatMessage: (m: ChatMsg) => void
  setChatLoading: (v: boolean) => void
  setUserProfile: (p: UserProfile | null) => void
  setCheckedScope: (scope: string[]) => void
  clearChat: () => void
  loadGraphChat: (graphId: string) => Promise<void>
  saveCurrentChat: () => void
  saveMemory: (memory: GraphMemory) => void

  // Graphs
  graphs: GraphMeta[]
  activeGraphId: string | null
  activeGraph: GraphDetail | null
  activeNodeId: string | null
  newNodeIds: Set<string>

  setGraphs: (g: GraphMeta[]) => void
  setActiveGraph: (id: string | null, detail?: GraphDetail) => void
  setActiveNode: (id: string | null) => void
  switchToGraph: (id: string) => void  // save current session, restore target

  // Agent streaming
  streamEvents: StreamEvent[]
  isStreaming: boolean
  progressLog: ProgressEntry[]
  currentOpId: string | null
  prevNodeCount: number

  // Auto-continue
  pendingContinue: { unexplored: number; noDocs: number } | null
  autoRoundsLeft: number

  pushStreamEvent: (e: StreamEvent) => void
  clearStream: () => void
  setStreaming: (v: boolean) => void
  pushProgress: (e: ProgressEntry) => void
  setCurrentOpId: (id: string | null) => void
  setPendingContinue: (v: { unexplored: number; noDocs: number } | null) => void
  setAutoRoundsLeft: (n: number) => void
}

let _saveTimer: ReturnType<typeof setTimeout> | null = null

/** In-memory per-graph session cache */
const _sessionCache: Record<string, GraphSession> = {}

function _saveSessionToCache(state: GraphStore) {
  const gid = state.activeGraphId
  if (!gid) return
  _sessionCache[gid] = {
    chatMessages: state.chatMessages,
    progressLog: state.progressLog,
    streamEvents: state.streamEvents,
    graphMemory: state.graphMemory,
  }
}

export const useGraphStore = create<GraphStore>((set, get) => ({
  mode: 'chat',
  setMode: (mode) => set({ mode }),

  exploreModalOpen: false,
  setExploreModalOpen: (exploreModalOpen) => set({ exploreModalOpen }),

  chatMessages: [],
  chatLoading: false,
  userProfile: null,
  checkedScope: [],
  graphMemory: null,
  pushChatMessage: (m) => set((s) => ({ chatMessages: [...s.chatMessages, m] })),
  setChatLoading: (chatLoading) => set({ chatLoading }),
  setUserProfile: (userProfile) => set({
    userProfile,
    checkedScope: userProfile?.scope ?? [],
  }),
  setCheckedScope: (checkedScope) => set({ checkedScope }),
  clearChat: () => set({ chatMessages: [], userProfile: null, checkedScope: [], graphMemory: null }),

  loadGraphChat: async (graphId: string) => {
    // First check in-memory cache
    const cached = _sessionCache[graphId]
    if (cached) {
      set({
        chatMessages: cached.chatMessages,
        progressLog: cached.progressLog,
        streamEvents: cached.streamEvents,
        graphMemory: cached.graphMemory,
      })
      return
    }
    // Otherwise load from backend
    try {
      const [chatRes, memRes] = await Promise.all([
        api.getGraphChat(graphId),
        api.getGraphMemory(graphId),
      ])
      set({
        chatMessages: (chatRes.messages ?? []).map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        progressLog: [],
        streamEvents: [],
        graphMemory: memRes.summary ? memRes as GraphMemory : null,
      })
    } catch {
      set({ chatMessages: [], progressLog: [], streamEvents: [], graphMemory: null })
    }
  },

  saveCurrentChat: () => {
    if (_saveTimer) clearTimeout(_saveTimer)
    _saveTimer = setTimeout(() => {
      const { activeGraphId, chatMessages } = get()
      if (!activeGraphId || chatMessages.length === 0) return
      api.saveGraphChat(activeGraphId, chatMessages).catch(() => {})
    }, 2000)
  },

  saveMemory: (memory: GraphMemory) => {
    const { activeGraphId } = get()
    if (!activeGraphId) return
    set({ graphMemory: memory })
    api.saveGraphMemory(activeGraphId, memory).catch(() => {})
  },

  graphs: [],
  activeGraphId: null,
  activeGraph: null,
  activeNodeId: null,
  newNodeIds: new Set<string>(),
  setGraphs: (graphs) => set({ graphs }),
  setActiveGraph: (id, detail) => set((s) => {
    if (!detail) return { activeGraphId: id, activeGraph: null, newNodeIds: new Set() }
    const oldNodes = s.activeGraph?.graph_data?.nodes ?? {}
    const newNodes = detail.graph_data?.nodes ?? {}
    const added = new Set<string>()
    for (const nid of Object.keys(newNodes)) {
      if (!oldNodes[nid]) added.add(nid)
    }
    if (added.size > 0) {
      setTimeout(() => {
        useGraphStore.setState((cur) => {
          const remaining = new Set(cur.newNodeIds)
          for (const nid of added) remaining.delete(nid)
          return { newNodeIds: remaining }
        })
      }, 3000)
    }
    return { activeGraphId: id, activeGraph: detail, newNodeIds: added }
  }),
  setActiveNode: (id) => set({ activeNodeId: id }),

  switchToGraph: (id: string) => {
    // Save current graph's session to cache
    _saveSessionToCache(get())
    // Restore target graph's session from cache (or empty)
    const cached = _sessionCache[id]
    set({
      chatMessages: cached?.chatMessages ?? [],
      progressLog: cached?.progressLog ?? [],
      streamEvents: cached?.streamEvents ?? [],
      graphMemory: cached?.graphMemory ?? null,
    })
  },

  streamEvents: [],
  isStreaming: false,
  progressLog: [],
  currentOpId: null,
  prevNodeCount: 0,

  pendingContinue: null,
  autoRoundsLeft: 0,

  pushStreamEvent: (e) => set((s) => {
    const updated = [...s.streamEvents.slice(-200), e]
    // Also update cache for current graph
    if (s.activeGraphId && _sessionCache[s.activeGraphId]) {
      _sessionCache[s.activeGraphId].streamEvents = updated
    }
    return { streamEvents: updated }
  }),
  clearStream: () => set({ streamEvents: [], progressLog: [], pendingContinue: null }),
  setStreaming: (isStreaming) => set({ isStreaming }),
  pushProgress: (e) => set((s) => {
    const updated = [...s.progressLog.slice(-100), e]
    // Also update cache for current graph
    if (s.activeGraphId && _sessionCache[s.activeGraphId]) {
      _sessionCache[s.activeGraphId].progressLog = updated
    }
    return { progressLog: updated }
  }),
  setCurrentOpId: (currentOpId) => set({ currentOpId }),
  setPendingContinue: (pendingContinue) => set({ pendingContinue }),
  setAutoRoundsLeft: (autoRoundsLeft) => set({ autoRoundsLeft }),
}))
