import type { Workspace } from './workspace.ts'

export type Screen = 'connection' | 'restoring' | 'chats' | 'newChat' | 'conversation'

export type HistoryState = {
  loading: boolean
  error?: string
  rawCount?: number
  count: number
}

export interface SessionSnapshot {
  screen: Screen
  phase: 'idle' | 'connecting' | 'waiting' | 'ready' | 'error'
  role: 'none' | 'waiting' | 'owner'
  scope: string
  owner: string
  data: Workspace
  selected: string
  receive: 'off' | 'starting' | 'active' | 'retrying' | 'stopped'
  instance: string
  incomingReady: boolean
  statusesReady: boolean
  error: string
  connectionError: string
  receiveError: string
  checkingConnection: boolean
  storageError: string
  storageWarning: string
  progress: string
  opening: boolean
  phoneError: string
  navigating: boolean
  sending: boolean
  histories: Record<string, HistoryState>
  draftSaving: boolean
  liveText: string
  incomingId?: string
  checking?: string[]
}
