import { MessageService } from './message.service.ts'
import { NotificationService } from './notification.service.ts'
import { delay } from '../abortable-delay.ts'
import { ApiErrorService } from '../api/api-error.service.ts'
import { ApiError } from '../api/api-error.ts'
import { ApiResponseService } from '../api/response.service.ts'

import type { Run, SessionContext } from '../../types/session-runtime.ts'

export class NotificationReceiver {
  private host: SessionContext
  constructor(host: SessionContext) {
    this.host = host
  }

  controller?: AbortController
  start(run: Run) {
    if (
      this.controller ||
      !this.host.current(run) ||
      this.host.snapshot().instance !== 'authorized'
    ) {
      return
    }

    const controller = new AbortController()

    this.controller = controller
    const signal = AbortSignal.any([run.controller.signal, controller.signal])

    this.host.patch({ receive: 'starting' })
    const job = (async () => {
      let receipt: number | undefined
      let failures = 0
      let refreshAfterAck = false
      let recover = false

      while (!signal.aborted) {
        if (this.host.snapshot().storageError) {
          this.host.patch({ receive: 'stopped' })

          return
        }

        try {
          if (receipt === undefined) {
            const value = await run.api.receiveNotification(signal)

            if (!this.host.current(run) || signal.aborted) {
              return
            }

            if (this.host.snapshot().storageError) {
              this.host.patch({ receive: 'stopped' })

              return
            }

            if (value !== null) {
              const envelope = ApiResponseService.requireObject(value)

              if (!Number.isSafeInteger(envelope.receiptId) || Number(envelope.receiptId) < 0) {
                throw new ApiError('Не удалось прочитать идентификатор уведомления.')
              }

              const event = NotificationService.parse(envelope.body, run.target.idInstance, run.wid)

              if (event.kind === 'text') {
                const existed = run
                  .storage!.getSnapshot()
                  .messages.some(
                    (message) =>
                      message.chatId === event.message.chatId &&
                      message.apiId === event.message.apiId &&
                      message.direction === event.message.direction,
                  )

                await this.host.save(run, (workspace) =>
                  MessageService.putMessages(workspace, [event.message]),
                )
                if (
                  !existed &&
                  event.message.direction === 'in' &&
                  event.message.chatId === this.host.snapshot().selected
                ) {
                  this.host.patch({
                    liveText: `Новое сообщение: ${event.message.text}`,
                    incomingId: event.message.id,
                  })
                }
              } else if (event.kind === 'delivery') {
                await this.host.save(run, (workspace) =>
                  MessageService.putDelivery(workspace, event.update),
                )
              } else if (event.kind === 'quota') {
                await this.host.save(run, (workspace) => {
                  workspace.meta.quotaNotice = {
                    description: event.description,
                    observedAt: Date.now(),
                  }
                })
              } else if (event.kind === 'state') {
                await this.host.save(run, (workspace) => {
                  workspace.meta.lastStateEvent = { state: event.state, observedAt: Date.now() }
                })
                this.host.patch({ instance: event.state })
                refreshAfterAck = true
              }

              receipt = Number(envelope.receiptId)
            }
          }

          if (signal.aborted) {
            return
          }

          if (receipt !== undefined) {
            await run.api.deleteNotification(receipt, signal)
            receipt = undefined
          }

          failures = 0
          if (!this.host.current(run) || signal.aborted) {
            return
          }

          this.host.patch({ receive: 'active', receiveError: '' })
          if (refreshAfterAck) {
            refreshAfterAck = false
            void this.host.refresh()
          }

          if (recover) {
            recover = false
            this.recover(run)
          }

          await delay(200, signal)
        } catch (error) {
          if (signal.aborted || !this.host.current(run)) {
            return
          }

          if (!(error instanceof ApiError) || !error.retryable) {
            this.host.patch({
              receive: 'stopped',
              receiveError: ApiErrorService.getMessage(error),
            })
            if (ApiErrorService.isAccess(error)) {
              this.host.patch({ instance: 'unknown' })
            }

            if (error instanceof ApiError && error.serviceKind === 'account-changed') {
              void this.host.refresh()
            }

            return
          }

          this.host.patch({
            receive: 'retrying',
            receiveError: ApiErrorService.getMessage(error),
          })
          recover = true
          await delay(Math.min(1000 * 2 ** Math.min(failures++, 5), 30000), signal).catch(() => {})
        }
      }
    })()

    void this.host
      .track(run, job)
      .finally(() => {
        if (this.controller === controller) {
          this.controller = undefined
        }
      })
      .catch(() => {})
  }

  recover(run: Run) {
    if (run.recovery) {
      return
    }

    run.recovery = this.host
      .track(
        run,
        (async () => {
          if (Date.now() - run.lastCheck >= 30000) {
            await this.host.refresh()
          }

          if (this.host.current(run) && this.host.snapshot().selected) {
            await this.host.loadHistory()
          }
        })(),
      )
      .finally(() => {
        run.recovery = undefined
      })
    void run.recovery.catch(() => {})
  }
}
