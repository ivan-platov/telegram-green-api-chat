import { DeliveryService } from './delivery.service.ts'
import { HistoryService } from './history.service.ts'
import { MessageService } from './message.service.ts'
import { ApiErrorService } from '../api/api-error.service.ts'
import { ApiError } from '../api/api-error.ts'
import { ConnectionService } from '../connection.service.ts'

import type { Run, SessionContext } from '../../types/session-runtime.ts'

export class StatusReconciler {
  private host: SessionContext
  constructor(host: SessionContext) {
    this.host = host
  }

  due(run: Run) {
    if (
      !this.host.current(run) ||
      !run.storage ||
      this.host.snapshot().receive !== 'active' ||
      this.host.snapshot().instance !== 'authorized' ||
      this.host.snapshot().storageError ||
      this.host.snapshot().connectionError ||
      this.host.snapshot().receiveError
    ) {
      return
    }

    for (const message of this.host.snapshot().data.messages) {
      if (
        message.direction !== 'out' ||
        !message.apiId ||
        DeliveryService.isTerminal(message) ||
        !message.reconcile ||
        message.reconcile.exhausted
      ) {
        continue
      }

      const elapsed = Date.now() - message.reconcile.boundAt
      let due = -1

      for (const [index, value] of [10000, 30000, 60000].entries()) {
        if (elapsed >= value) {
          due = index
        }
      }

      if (due >= message.reconcile.slot) {
        void this.checkStatus(message.id, false, due)
      }
    }
  }

  async checkStatus(localId: string, manual = true, slot = 0) {
    const run = this.host.run()
    const message = this.host.snapshot().data.messages.find((item) => item.id === localId)

    if (
      !run ||
      !message?.apiId ||
      !run.storage ||
      run.reconcile.has(localId) ||
      !this.host.current(run) ||
      ConnectionService.getStatusCheckBlockReason(this.host.snapshot())
    ) {
      return
    }

    const idMessage = message.apiId

    run.reconcile.add(localId)
    this.host.patch({ checking: [...run.reconcile] })
    const job = (async () => {
      try {
        const raw = await run.api.getMessage(
          { chatId: message.chatId, idMessage },
          {
            signal: run.controller.signal,
            beforeStart: async () => {
              const latest = this.host.snapshot().data.messages.find((item) => item.id === localId)

              if (!latest || DeliveryService.isTerminal(latest)) {
                throw new DOMException('Статус уже подтверждён', 'AbortError')
              }

              let effectiveSlot = slot

              if (latest.reconcile) {
                for (const [index, milliseconds] of [10000, 30000, 60000].entries()) {
                  if (Date.now() - latest.reconcile.boundAt >= milliseconds) {
                    effectiveSlot = Math.max(effectiveSlot, index)
                  }
                }
              }

              if (!manual) {
                await this.host.save(run, (workspace) => {
                  workspace.messages = workspace.messages.map((item) =>
                    item.id === localId
                      ? {
                          ...item,
                          reconcile: {
                            ...item.reconcile!,
                            slot: effectiveSlot + 1,
                            attempts: (item.reconcile?.attempts ?? 0) + 1,
                          },
                        }
                      : item,
                  )
                })
              }
            },
          },
        )

        if (
          raw.chatId !== message.chatId ||
          raw.idMessage !== message.apiId ||
          raw.type !== 'outgoing' ||
          raw.typeMessage !== 'textMessage' ||
          typeof raw.textMessage !== 'string'
        ) {
          throw new ApiError(
            'Ответ сверки относится к другому сообщению или имеет неверный формат.',
          )
        }

        const entry = HistoryService.parse([raw], message.chatId).map((item) => ({
          ...item,
          statusSource: 'getMessage',
          verificationError: undefined,
          error: item.status === 'unknown' ? undefined : item.error,
        }))

        await this.host.save(run, (workspace) => MessageService.putMessages(workspace, entry))
      } catch (error) {
        if (this.host.current(run) && ApiErrorService.isAccess(error)) {
          this.host.patch({
            connectionError: ApiErrorService.getMessage(error),
            instance: 'unknown',
          })
        } else if (
          this.host.current(run) &&
          manual &&
          error instanceof ApiError &&
          (error.retryable || error.serviceKind === 'not-found')
        ) {
          await this.host
            .save(run, (workspace) => {
              workspace.messages = workspace.messages.map((item) =>
                item.id === localId && !DeliveryService.isTerminal(item)
                  ? {
                      ...item,
                      verificationError: `Не удалось проверить статус. ${ApiErrorService.getMessage(error)}`,
                    }
                  : item,
              )
            })
            .catch(() => {})
        } else if (
          this.host.current(run) &&
          error instanceof ApiError &&
          error.serviceKind !== 'not-found' &&
          !error.retryable
        ) {
          await this.host
            .save(run, (workspace) => {
              workspace.meta.warnings[message.chatId] = ApiErrorService.getMessage(error)
              workspace.messages = workspace.messages.map((item) =>
                item.id === localId && item.reconcile && !DeliveryService.isTerminal(item)
                  ? {
                      ...item,
                      status: 'unknown',
                      unknownReason: 'verification-error',
                      error: 'Не удалось проверить статус сообщения.',
                      reconcile: { ...item.reconcile, exhausted: true },
                    }
                  : item,
              )
            })
            .catch(() => {})
        }
      } finally {
        if (this.host.current(run) && !manual) {
          await this.host
            .save(run, (workspace) => {
              workspace.messages = workspace.messages.map((item) =>
                item.id === localId &&
                !DeliveryService.isTerminal(item) &&
                (item.reconcile?.slot ?? 0) >= 3
                  ? {
                      ...item,
                      status: 'unknown',
                      unknownReason: 'confirmation-timeout',
                      error:
                        'Доставка не подтверждена. Проверьте переписку перед повторной отправкой.',
                      reconcile: { ...item.reconcile!, exhausted: true },
                    }
                  : item,
              )
            })
            .catch(() => {})
        }

        run.reconcile.delete(localId)
        if (this.host.current(run)) {
          this.host.patch({ checking: [...run.reconcile] })
        }
      }
    })()

    return this.host.track(run, job)
  }
}
