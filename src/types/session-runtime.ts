import type { SessionSnapshot } from './session.ts'
import type { Draft, Target, Workspace } from './workspace.ts'
import type { GreenApiService } from '../services/api/green-api.service.ts'
import type { WorkspaceStorage } from '../services/storage/workspace-storage.ts'

export type Run = {
  controller: AbortController
  target: Target
  api: GreenApiService
  task: Promise<void>
  storage?: WorkspaceStorage
  jobs: Set<Promise<unknown>>
  wid?: string
  scope?: string
  refreshing?: Promise<void>
  recovery?: Promise<void>
  lastCheck: number
  reconcile: Set<string>
  beforeRelease?: () => void
  pendingBindings: Map<
    string,
    {
      apiId: string
      chatId: string
      draft: Draft
    }
  >
}

export interface SessionContext {
  snapshot: () => SessionSnapshot
  run: () => Run | undefined
  current: (run: Run) => boolean
  patch: (update: Partial<SessionSnapshot>) => void
  save: (run: Run, change: (workspace: Workspace) => void) => Promise<Workspace>
  track: <T>(run: Run, job: Promise<T>) => Promise<T>
  refresh: () => Promise<void>
  loadHistory: () => Promise<void>
}
