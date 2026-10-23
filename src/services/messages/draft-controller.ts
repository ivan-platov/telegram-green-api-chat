import { MessageService } from './message.service.ts'
import { ApiErrorService } from '../api/api-error.service.ts'
import { ApiError } from '../api/api-error.ts'
import { ConnectionService } from '../connection.service.ts'

import type { SessionContext } from '../../types/session-runtime.ts'
import type { Draft } from '../../types/workspace.ts'

export class DraftController {
  private host: SessionContext
  constructor(host: SessionContext) {
    this.host = host
  }

  draftQueue: Promise<unknown> = Promise.resolve()
  draftWrites = 0
  revisions = new Map<string, Draft>()
  sendReady() {
    return !ConnectionService.getSendBlockReason(this.host.snapshot())
  }

  draft(chatId = this.host.snapshot().selected) {
    return (
      this.revisions.get(chatId) ??
      this.host.snapshot().data.drafts[chatId] ?? { text: '', revision: 0, updatedAt: 0 }
    )
  }

  editDraft(text: string) {
    const run = this.host.run()
    const chatId = this.host.snapshot().selected

    if (
      !run ||
      !run.storage ||
      this.host.snapshot().role !== 'owner' ||
      this.host.snapshot().navigating ||
      !chatId
    ) {
      return
    }

    const draft = { text, revision: this.draft(chatId).revision + 1, updatedAt: Date.now() }

    this.revisions.set(chatId, draft)
    this.draftWrites++
    this.host.patch({ draftSaving: true })
    const write = this.draftQueue
      .catch(() => {})
      .then(() =>
        this.host.save(run, (workspace) => {
          workspace.drafts[chatId] = draft
        }),
      )

    this.draftQueue = write
    void this.host
      .track(run, write)
      .finally(() => {
        this.draftWrites--
        if (this.host.current(run)) {
          this.host.patch({ draftSaving: this.draftWrites > 0 })
        }
      })
      .catch(() => {})
  }

  async flush() {
    await this.draftQueue
    if (this.host.snapshot().storageError) {
      throw new Error(this.host.snapshot().storageError)
    }
  }

  async send() {
    const run = this.host.run()
    const chatId = this.host.snapshot().selected
    const draft = { ...this.draft() }

    if (
      !run ||
      !run.storage ||
      !chatId ||
      !this.sendReady() ||
      !draft.text.trim() ||
      draft.text.length > 4096
    ) {
      return
    }

    const cleared = { text: '', revision: draft.revision + 1, updatedAt: Date.now() }

    this.revisions.set(chatId, cleared)
    this.host.patch({ sending: true })
    const id = crypto.randomUUID()
    let attemptSaved = false
    const job = (async () => {
      try {
        await this.flush()
        await this.host.save(run, (workspace) => {
          MessageService.putMessages(workspace, [
            {
              id,
              chatId,
              text: draft.text,
              direction: 'out',
              status: 'pending',
              localCreatedAt: Date.now(),
              createdAt: Date.now(),
              draftRevisionAtSend: draft.revision,
            },
          ])
          if ((workspace.drafts[chatId]?.revision ?? 0) <= cleared.revision) {
            workspace.drafts[chatId] = cleared
          }
        })
        attemptSaved = true
        const apiId = await run.api.sendText(chatId, draft.text, run.controller.signal)

        if (!this.host.current(run)) {
          return
        }

        run.pendingBindings.set(id, { apiId, chatId, draft })
        await this.host.save(run, (workspace) => {
          MessageService.bindAttempt(workspace, id, apiId, Date.now())
        })
        run.pendingBindings.delete(id)
      } catch (error) {
        if (
          this.host.current(run) &&
          !attemptSaved &&
          this.draft(chatId).revision === cleared.revision
        ) {
          this.revisions.set(chatId, {
            ...draft,
            revision: cleared.revision + 1,
            updatedAt: Date.now(),
          })
          this.host.patch({})
        }

        if (this.host.current(run) && run.pendingBindings.has(id)) {
          this.host.patch({
            data: {
              ...this.host.snapshot().data,
              messages: this.host.snapshot().data.messages.map((message) =>
                message.id === id
                  ? {
                      ...message,
                      status: 'unknown',
                      unknownReason: 'result-not-saved',
                      error:
                        'Ответ сервиса не удалось сохранить. Проверьте подключение для повторного сохранения; текст не будет отправлен заново.',
                    }
                  : message,
              ),
            },
          })
        }

        if (this.host.current(run) && !this.host.snapshot().storageError) {
          await this.host
            .save(run, (workspace) => {
              workspace.messages = workspace.messages.map((message) =>
                message.id === id
                  ? {
                      ...message,
                      status: error instanceof ApiError && error.uncertain ? 'unknown' : 'failed',
                      unknownReason: 'transport',
                      error: ApiErrorService.getMessage(error),
                    }
                  : message,
              )
            })
            .catch(() => {})
        }
      } finally {
        if (this.host.current(run)) {
          this.host.patch({ sending: false })
        }
      }
    })()

    return this.host.track(run, job)
  }
}
