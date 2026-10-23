import { HistoryService } from './history.service.ts'
import { MessageService } from './message.service.ts'

import type { HistoryState } from '../../types/session.ts'
import type { Workspace } from '../../types/workspace.ts'

interface HistoryRequest {
  chatId: string
  more: boolean
  signal: AbortSignal
  current: () => boolean
  saved?: {
    count: number
    rawCount: number
  }
  previous?: HistoryState
  read: (count: number, signal: AbortSignal) => Promise<unknown>
  save: (change: (workspace: Workspace) => void) => Promise<unknown>
  publish: (state: HistoryState) => void
  track: (job: Promise<void>) => Promise<void>
}

export class HistoryLoader {
  private active?: {
    chatId: string
    controller: AbortController
    job: Promise<void>
  }

  abort() {
    this.active?.controller.abort()
  }

  load(request: HistoryRequest): Promise<void> {
    const { chatId, more, previous, saved } = request

    if (this.active?.chatId === chatId && !this.active.controller.signal.aborted) {
      return this.active.job
    }

    this.abort()
    const controller = new AbortController()
    const signal = AbortSignal.any([request.signal, controller.signal])
    const count = more
      ? (saved?.count ?? 100) + 100
      : Math.max(saved?.count ?? 100, previous?.count ?? 100)

    if (!Number.isSafeInteger(count) || count <= 0) {
      return Promise.resolve()
    }

    request.publish({ loading: true, count })
    const job = (async () => {
      try {
        const raw = await request.read(count, signal)
        const messages = HistoryService.parse(raw, chatId).map((message) => ({
          ...message,
          statusSource: 'history',
          error: message.status === 'unknown' ? undefined : message.error,
          ...(message.direction === 'out' && message.status === 'unknown' && message.apiId
            ? { reconcile: { boundAt: Date.now(), slot: 0, attempts: 0 } }
            : {}),
        }))

        if (signal.aborted || !request.current()) {
          return
        }

        await request.save((workspace) => {
          MessageService.putMessages(workspace, messages)
          workspace.meta.history[chatId] = { count, rawCount: (raw as unknown[]).length }
        })
        if (!signal.aborted && request.current()) {
          request.publish({ loading: false, count, rawCount: (raw as unknown[]).length })
        }
      } catch (error) {
        if (!signal.aborted && request.current()) {
          request.publish({
            loading: false,
            count,
            error: error instanceof Error ? error.message : 'Не удалось загрузить историю.',
          })
        }
      }
    })()

    this.active = { chatId, controller, job }
    void job
      .finally(() => {
        if (this.active?.job === job) {
          this.active = undefined
        }
      })
      .catch(() => {})

    return request.track(job)
  }
}
