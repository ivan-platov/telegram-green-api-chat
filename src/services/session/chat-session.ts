import { ApiErrorService } from '../api/api-error.service.ts'
import { ConnectionService } from '../connection.service.ts'
import { PhoneService } from '../phone.service.ts'
import { WorkspaceService } from '../workspace.service.ts'
import { ownQueue } from './queue-owner.ts'
import { delay } from '../abortable-delay.ts'
import { ApiError } from '../api/api-error.ts'
import { defaultApiUrl } from '../api/config.ts'
import { GreenApiService } from '../api/green-api.service.ts'
import { DraftController } from '../messages/draft-controller.ts'
import { HistoryLoader } from '../messages/history-loader.ts'
import { MessageService } from '../messages/message.service.ts'
import { NotificationReceiver } from '../messages/notification-receiver.ts'
import { StatusReconciler } from '../messages/status-reconciler.ts'
import {
  connectionKey,
  ConnectionStorageService,
  legacyConnectionKey,
} from '../storage/connection-storage.service.ts'
import { WorkspaceStorage } from '../storage/workspace-storage.ts'

import type { Run, SessionContext } from '../../types/session-runtime.ts'
import type { Screen, SessionSnapshot } from '../../types/session.ts'
import type { Draft, Target, Workspace } from '../../types/workspace.ts'

const initial = (): SessionSnapshot => ({
  screen: 'connection',
  phase: 'idle',
  role: 'none',
  scope: '',
  owner: '',
  data: WorkspaceService.create(),
  selected: '',
  receive: 'off',
  instance: 'unknown',
  incomingReady: false,
  statusesReady: false,
  error: '',
  connectionError: '',
  receiveError: '',
  checkingConnection: false,
  storageError: '',
  storageWarning: '',
  progress: '',
  opening: false,
  phoneError: '',
  navigating: false,
  sending: false,
  histories: {},
  draftSaving: false,
  liveText: '',
})

export class ChatSession {
  private snapshot = initial()
  private listeners = new Set<() => void>()
  private run?: Run
  private lifecycle: Promise<unknown> = Promise.resolve()
  private navigation = 0
  private lookup?: AbortController
  private history = new HistoryLoader()
  private origin: {
    screen: Screen
    selected: string
  } = { screen: 'chats', selected: '' }

  private disposed = false
  private services: SessionContext = {
    snapshot: () => this.snapshot,
    run: () => this.run,
    current: (run) => this.current(run),
    patch: (update) => this.patch(update),
    save: (run, change) => this.save(run, change),
    track: (run, job) => this.track(run, job),
    refresh: () => this.refresh(),
    loadHistory: () => this.loadHistory(),
  }

  private drafts = new DraftController(this.services)
  private receiver = new NotificationReceiver(this.services)
  private statuses = new StatusReconciler(this.services)
  sendReady() {
    return this.drafts.sendReady()
  }

  draft(chatId?: string) {
    return this.drafts.draft(chatId)
  }

  editDraft(text: string) {
    this.drafts.editDraft(text)
  }

  flush() {
    return this.drafts.flush()
  }

  send() {
    return this.drafts.send()
  }

  checkStatus(id: string, manual = true, slot = 0) {
    return this.statuses.checkStatus(id, manual, slot)
  }

  async dismissQuotaNotice() {
    const run = this.run

    if (!run || this.snapshot.role !== 'owner') {
      return
    }

    await this.track(
      run,
      this.save(run, (workspace) => {
        if (workspace.meta.quotaNotice) {
          workspace.meta.quotaNotice = { ...workspace.meta.quotaNotice, dismissed: true }
        }
      }),
    ).catch(() => {})
  }

  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)

    return () => this.listeners.delete(listener)
  }

  private patch(update: Partial<SessionSnapshot>) {
    if (!this.disposed) {
      this.snapshot = { ...this.snapshot, ...update }
      for (const listener of this.listeners) {
        listener()
      }
    }
  }

  private current(run: Run) {
    return this.run === run && !run.controller.signal.aborted
  }

  private track<T>(run: Run, promise: Promise<T>) {
    run.jobs.add(promise)
    void promise.finally(() => run.jobs.delete(promise)).catch(() => {})

    return promise
  }

  private async save(run: Run, change: (workspace: Workspace) => void) {
    if (!this.current(run) || !run.storage) {
      throw new DOMException('Сессия остановлена', 'AbortError')
    }

    try {
      const data = await run.storage.update((workspace) => {
        if (!this.current(run)) {
          throw new DOMException('Сессия остановлена', 'AbortError')
        }

        change(workspace)
      })

      if (this.current(run)) {
        this.patch({ data, storageError: '' })
      }

      return data
    } catch (error) {
      if (this.current(run) && !(error instanceof DOMException && error.name === 'AbortError')) {
        this.patch({ storageError: ApiErrorService.getMessage(error), receive: 'stopped' })
      }

      throw error
    }
  }

  restore() {
    this.disposed = false
    const saved = ConnectionStorageService.read()

    if (saved.error) {
      this.patch({ error: saved.error })
    }

    if (saved.value) {
      void this.connect(
        {
          apiUrl: saved.value.apiUrl,
          idInstance: saved.value.idInstance,
          apiTokenInstance: saved.value.apiTokenInstance,
        },
        true,
      )
    }
  }

  connect(target: Target, restoring = false) {
    const operation = this.lifecycle
      .catch(() => {})
      .then(async () => {
        await this.stopRun()
        if (this.disposed) {
          return
        }

        try {
          target = {
            ...target,
            apiUrl: ConnectionService.normalizeOrigin(target.apiUrl),
            idInstance: target.idInstance.trim(),
            apiTokenInstance: target.apiTokenInstance.trim(),
          }
          if (!/^\d+$/.test(target.idInstance) || !target.apiTokenInstance) {
            throw new Error('Укажите числовой ID инстанса и токен.')
          }
        } catch (error) {
          this.patch({
            screen: 'connection',
            phase: 'error',
            error: ApiErrorService.getMessage(error),
          })

          return
        }

        this.drafts.revisions.clear()
        this.drafts.draftQueue = Promise.resolve()
        this.drafts.draftWrites = 0
        this.patch({
          ...initial(),
          screen: restoring ? 'restoring' : 'connection',
          phase: 'connecting',
          progress: restoring ? 'Восстанавливаем подключение…' : 'Проверяем подключение…',
        })
        const run: Run = {
          controller: new AbortController(),
          target,
          api: new GreenApiService(target),
          task: Promise.resolve(),
          jobs: new Set(),
          lastCheck: 0,
          reconcile: new Set(),
          pendingBindings: new Map(),
        }

        this.run = run
        this.patch({
          role: 'waiting',
          phase: 'waiting',
          progress: 'Ожидаем доступ к очереди сообщений…',
        })
        const cachedAccess = ConnectionStorageService.read().value

        if (
          cachedAccess?.ownerChatId &&
          cachedAccess.apiUrl === target.apiUrl &&
          cachedAccess.idInstance === target.idInstance &&
          cachedAccess.apiTokenInstance === target.apiTokenInstance
        ) {
          void WorkspaceStorage.open(
            WorkspaceService.getKey({ ...target, ownerChatId: cachedAccess.ownerChatId }),
            false,
          )
            .then(async (cache) => {
              try {
                if (this.current(run) && this.snapshot.role === 'waiting') {
                  const data = cache.getSnapshot()
                  const selected = data.meta.lastSelected ?? ''

                  this.patch({
                    data,
                    selected,
                    scope: WorkspaceService.getKey({
                      ...target,
                      ownerChatId: cachedAccess.ownerChatId!,
                    }),
                    owner: cachedAccess.ownerChatId!,
                    screen: selected ? 'conversation' : 'chats',
                  })
                }
              } finally {
                await cache.close()
              }
            })
            .catch(() => {})
        }

        run.task = ownQueue(target, run.controller.signal, async () => {
          if (!this.current(run)) {
            return
          }

          this.patch({
            role: 'owner',
            phase: 'connecting',
            progress: restoring ? 'Восстанавливаем подключение…' : 'Проверяем подключение…',
          })
          let monitor: number | undefined
          let reconcile: number | undefined

          try {
            const saved = ConnectionStorageService.read().value

            if (
              restoring &&
              (!saved ||
                saved.apiUrl !== target.apiUrl ||
                saved.idInstance !== target.idInstance ||
                saved.apiTokenInstance !== target.apiTokenInstance)
            ) {
              throw new Error('Сохранённое подключение изменилось. Подключитесь заново.')
            }

            const handshake = AbortSignal.any([run.controller.signal, AbortSignal.timeout(20000)])
            let result:
              | {
                  state: string
                  settings: Record<string, unknown>
                  owner: string
                }
              | undefined

            for (let attempt = 0; ; attempt++) {
              try {
                result = await this.readConnection(run, handshake)
                break
              } catch (error) {
                if (handshake.aborted) {
                  throw new Error('Время проверки истекло. Повторите подключение.', {
                    cause: error,
                  })
                }

                if (!(error instanceof ApiError) || !error.retryable || attempt === 3) {
                  throw error
                }

                this.patch({
                  progress: `Проверка подключения не завершена. Повтор через ${2 ** (attempt + 1)} с…`,
                })
                await delay(1000 * 2 ** (attempt + 1), handshake)
              }
            }

            if (!this.current(run)) {
              return
            }

            const identity = {
              apiUrl: target.apiUrl,
              idInstance: target.idInstance,
              ownerChatId: result.owner,
            }

            run.scope = WorkspaceService.getKey(identity)
            run.wid = typeof result.settings.wid === 'string' ? result.settings.wid : undefined
            run.storage = await WorkspaceStorage.open(run.scope)
            if (!this.current(run)) {
              return
            }

            const needsPhoneCorrection = run.storage.getSnapshot().chats.some((chat) => {
              const parsed = PhoneService.normalize(chat.phone)

              return parsed.ok && parsed.digits !== chat.phone
            })

            if (needsPhoneCorrection) {
              await run.storage.update((workspace) => {
                workspace.chats = workspace.chats.map((chat) => {
                  const parsed = PhoneService.normalize(chat.phone)

                  return parsed.ok ? { ...chat, phone: parsed.digits } : chat
                })
              })
            }

            if (!this.current(run)) {
              return
            }

            const data = run.storage.getSnapshot()

            this.drafts.revisions.clear()
            for (const [id, draft] of Object.entries(data.drafts)) {
              this.drafts.revisions.set(id, draft)
            }

            let storageWarning = ''

            if (restoring) {
              const latest = ConnectionStorageService.read().value

              if (
                !latest ||
                latest.apiUrl !== target.apiUrl ||
                latest.idInstance !== target.idInstance ||
                latest.apiTokenInstance !== target.apiTokenInstance
              ) {
                throw new Error(
                  'Сохранённый доступ изменён во время проверки. Подключитесь заново.',
                )
              }
            }

            try {
              ConnectionStorageService.write({
                version: 2,
                ...target,
                ownerChatId: result.owner,
                credentialRevision: (saved?.credentialRevision ?? 0) + 1,
                migrationCandidate: saved?.migrationCandidate,
              })
            } catch {
              storageWarning =
                'Доступ не сохранён в браузере. После перезагрузки потребуется ввести его снова.'
            }

            const selected = data.chats.some((chat) => chat.chatId === data.meta.lastSelected)
              ? data.meta.lastSelected!
              : ''

            this.patch({
              data,
              selected,
              scope: run.scope,
              owner: result.owner,
              screen: selected ? 'conversation' : 'chats',
              phase: 'ready',
              storageWarning,
              ...this.connectionState(result),
              error: '',
              progress: '',
            })
            run.lastCheck = Date.now()
            if (this.snapshot.incomingReady) {
              this.receiver.start(run)
            }

            if (selected) {
              void this.loadHistory().catch(() => {})
            }

            monitor = window.setInterval(() => {
              if (document.visibilityState === 'visible') {
                void this.refresh().catch(() => {})
              }
            }, 30000)
            reconcile = window.setInterval(() => this.statuses.due(run), 1000)
            const awake = () => {
              if (document.visibilityState === 'visible' && Date.now() - run.lastCheck >= 30000) {
                void this.refresh().catch(() => {})
              }
            }

            window.addEventListener('focus', awake)
            window.addEventListener('online', awake)
            document.addEventListener('visibilitychange', awake)
            await new Promise<void>((resolve) =>
              run.controller.signal.addEventListener(
                'abort',
                () => {
                  window.removeEventListener('focus', awake)
                  window.removeEventListener('online', awake)
                  document.removeEventListener('visibilitychange', awake)
                  resolve()
                },
                { once: true },
              ),
            )
          } finally {
            window.clearInterval(monitor)
            window.clearInterval(reconcile)
            await Promise.allSettled([...run.jobs])
            if (run.storage) {
              try {
                await run.storage.update((workspace) => {
                  for (const [id, binding] of run.pendingBindings) {
                    MessageService.bindAttempt(workspace, id, binding.apiId, Date.now())
                  }

                  workspace.messages = workspace.messages.map((message) =>
                    message.direction === 'out' && message.status === 'pending' && !message.apiId
                      ? { ...message, status: 'unknown', unknownReason: 'reload-during-send' }
                      : message,
                  )
                })
              } catch {
                /* Existing records stay intact if the database became unavailable. */
              }

              await run.storage.close()
            }

            run.beforeRelease?.()
          }
        }).catch((error) => {
          if (this.current(run)) {
            this.patch({
              phase: 'error',
              error: ApiErrorService.getMessage(error),
              receive: 'stopped',
              progress: '',
              role: 'none',
              screen: run.storage ? this.snapshot.screen : 'connection',
            })
          }
        })
      })

    this.lifecycle = operation

    return operation
  }

  private async readConnection(run: Run, signal = run.controller.signal) {
    const state = await run.api.getStateInstance({ signal })

    if (!run.storage && state.stateInstance !== 'authorized') {
      throw new ApiError(
        `${ConnectionService.getInstanceLabel(String(state.stateInstance))}. Проверьте состояние в кабинете GREEN-API.`,
      )
    }

    const settings = await run.api.getSettings({ signal })
    const account = await run.api.getAccountSettings({ signal })

    if (
      settings.typeInstance !== 'telegram' ||
      typeof state.stateInstance !== 'string' ||
      typeof account.chatId !== 'string' ||
      !/^[1-9]\d*$/.test(account.chatId)
    ) {
      throw new ApiError('Не удалось проверить Telegram-аккаунт инстанса.')
    }

    return { state: state.stateInstance, settings, owner: account.chatId }
  }

  private connectionState(result: { state: string; settings: Record<string, unknown> }) {
    return {
      instance: result.state,
      incomingReady: result.settings.incomingWebhook === 'yes' && result.settings.webhookUrl === '',
      statusesReady:
        result.settings.outgoingWebhook === 'yes' &&
        result.settings.outgoingAPIMessageWebhook === 'yes' &&
        result.settings.outgoingMessageWebhook === 'yes',
    }
  }

  private async stopRun() {
    const run = this.run

    this.navigation++
    this.lookup?.abort()
    this.history.abort()
    if (!run) {
      return
    }

    run.controller.abort()
    await run.task
    if (this.run === run) {
      this.run = undefined
    }
  }

  async stop() {
    this.disposed = true
    await this.stopRun()
  }

  async cancelConnection() {
    await this.stopRun()
    this.patch({ screen: 'connection', phase: 'idle', progress: '', role: 'none' })
  }

  onStorage = (event: StorageEvent) => {
    if (![connectionKey, legacyConnectionKey].includes(event.key ?? '')) {
      return
    }

    const saved = ConnectionStorageService.read().value
    const run = this.run

    if (!run) {
      return
    }

    if (
      !saved ||
      saved.apiUrl !== run.target.apiUrl ||
      saved.idInstance !== run.target.idInstance ||
      saved.apiTokenInstance !== run.target.apiTokenInstance
    ) {
      void this.stopRun().then(() =>
        this.patch({
          ...initial(),
          error: saved
            ? 'Подключение изменено в другой вкладке. Проверьте данные и подключитесь.'
            : '',
        }),
      )
    }
  }

  async disconnect() {
    let removingAccess = false

    try {
      await this.flush()
      removingAccess = true
      const run = this.run
      let deletionError: unknown

      if (run && this.snapshot.role === 'owner') {
        run.beforeRelease = () => {
          try {
            ConnectionStorageService.remove()
          } catch (error) {
            deletionError = error
          }
        }
      } else {
        ConnectionStorageService.remove()
      }

      await this.stopRun()
      if (deletionError) {
        throw deletionError
      }

      this.drafts.revisions.clear()
      this.patch(initial())
    } catch (error) {
      if (removingAccess) {
        await this.stopRun()
        this.patch({
          error: 'Не удалось удалить сохранённый доступ.',
          phase: 'error',
          role: 'none',
          receive: 'off',
        })
      } else {
        this.patch({
          error: 'Не удалось удалить сохранённый доступ.',
          storageError: ApiErrorService.getMessage(error),
          receive: 'stopped',
        })
      }
    }
  }

  async editAccess() {
    try {
      await this.flush()
      await this.stopRun()
      this.drafts.revisions.clear()
      this.patch(initial())
    } catch (error) {
      this.patch({ storageError: ApiErrorService.getMessage(error) })
    }
  }

  async refresh() {
    const run = this.run

    if (!run || !this.current(run) || !run.storage) {
      return
    }

    if (run.refreshing) {
      return run.refreshing
    }

    this.patch({ checkingConnection: true })

    run.refreshing = this.track(
      run,
      (async () => {
        try {
          const result = await this.readConnection(run)

          if (!this.current(run)) {
            return
          }

          if (WorkspaceService.getKey({ ...run.target, ownerChatId: result.owner }) !== run.scope) {
            this.patch({
              instance: 'unknown',
              phase: 'connecting',
              error: 'У инстанса сменился Telegram-аккаунт. Проверяем новое подключение…',
              receive: 'off',
            })
            void this.connect(run.target, false)

            return
          }

          run.lastCheck = Date.now()
          run.wid = typeof result.settings.wid === 'string' ? result.settings.wid : undefined
          this.patch({ ...this.connectionState(result), connectionError: '', error: '' })
          if (
            this.snapshot.incomingReady &&
            result.state === 'authorized' &&
            !this.receiver.controller
          ) {
            this.receiver.start(run)
          }

          if (
            (!this.snapshot.incomingReady || result.state !== 'authorized') &&
            this.receiver.controller
          ) {
            this.receiver.controller.abort()
            this.patch({ receive: 'off' })
          }
        } catch (error) {
          if (this.current(run)) {
            this.patch({
              connectionError: ApiErrorService.getMessage(error),
              ...(ApiErrorService.isAccess(error) ? { instance: 'unknown' } : {}),
            })
          }
        }
      })(),
    ).finally(() => {
      run.refreshing = undefined
      if (this.current(run)) {
        this.patch({ checkingConnection: false })
      }
    })

    return run.refreshing
  }

  async retry() {
    const run = this.run

    if (!run || !run.storage) {
      return
    }

    try {
      const cleared = new Map<string, Draft>()

      await this.save(run, (workspace) => {
        for (const [id, draft] of this.drafts.revisions) {
          workspace.drafts[id] = draft
        }

        for (const [id, binding] of run.pendingBindings) {
          MessageService.bindAttempt(workspace, id, binding.apiId, Date.now())
          const current = this.draft(binding.chatId)

          if (current.revision === binding.draft.revision && current.text === binding.draft.text) {
            const empty = { text: '', revision: current.revision + 1, updatedAt: Date.now() }

            workspace.drafts[binding.chatId] = empty
            cleared.set(binding.chatId, empty)
          }
        }
      })
      for (const [id, draft] of cleared) {
        const current = this.draft(id)

        if (current.revision === draft.revision - 1) {
          this.drafts.revisions.set(id, draft)
        }
      }

      run.pendingBindings.clear()
      this.drafts.draftQueue = Promise.resolve()
      this.patch({})
      await this.refresh()
      if (!this.receiver.controller && this.snapshot.incomingReady) {
        this.receiver.start(run)
      }

      this.receiver.recover(run)
    } catch {
      /* The save failure is already visible. */
    }
  }

  private async navigate(action: (run: Run, revision: number) => Promise<void>) {
    const run = this.run

    if (!run || !run.storage || this.snapshot.navigating || this.snapshot.role !== 'owner') {
      return
    }

    const revision = ++this.navigation

    this.lookup?.abort()
    this.history.abort()
    this.patch({ navigating: true, opening: false, phoneError: '' })
    try {
      await this.flush()
      if (this.current(run) && revision === this.navigation) {
        await action(run, revision)
      }
    } catch (error) {
      if (this.current(run)) {
        this.patch({ storageError: ApiErrorService.getMessage(error) })
      }
    } finally {
      if (this.current(run)) {
        this.patch({ navigating: false })
      }
    }
  }

  newChat() {
    return this.navigate(async () => {
      this.origin = { screen: this.snapshot.screen, selected: this.snapshot.selected }
      this.patch({ screen: 'newChat' })
    })
  }

  cancelNew() {
    ++this.navigation
    this.lookup?.abort()
    this.patch({
      screen: this.origin.screen,
      selected: this.origin.selected,
      opening: false,
      phoneError: '',
    })
  }

  select(chatId: string) {
    return this.navigate(async (run, revision) => {
      if (!this.snapshot.data.chats.some((chat) => chat.chatId === chatId)) {
        return
      }

      await this.save(run, (workspace) => {
        workspace.meta.lastSelected = chatId
      })
      if (revision !== this.navigation) {
        return
      }

      this.patch({ selected: chatId, screen: 'conversation' })
      void this.loadHistory()
    })
  }

  back() {
    return this.navigate(async () => {
      this.patch({ screen: 'chats' })
    })
  }

  clearPhoneError() {
    if (this.snapshot.phoneError) {
      this.patch({ phoneError: '' })
    }
  }

  async openPhone(input: string) {
    const run = this.run

    if (
      !run ||
      !run.storage ||
      this.snapshot.opening ||
      ConnectionService.getLookupBlockReason(this.snapshot)
    ) {
      return
    }

    const parsed = PhoneService.normalize(input)

    if (!parsed.ok) {
      this.patch({ phoneError: parsed.error })

      return
    }

    const phone = parsed.digits
    const revision = ++this.navigation
    const controller = new AbortController()

    this.lookup?.abort()
    this.lookup = controller
    const signal = AbortSignal.any([controller.signal, run.controller.signal])

    this.patch({ opening: true, phoneError: '' })
    try {
      const chatId = await run.api.resolvePhone(phone, signal)

      if (signal.aborted || revision !== this.navigation || !this.current(run)) {
        return
      }

      await this.save(run, (workspace) => {
        if (revision !== this.navigation) {
          throw new DOMException('Открытие отменено', 'AbortError')
        }

        const existing = workspace.chats.find((chat) => chat.chatId === chatId)

        workspace.chats = existing
          ? workspace.chats.map((chat) => (chat.chatId === chatId ? { ...chat, phone } : chat))
          : [
              ...workspace.chats,
              {
                chatId,
                phone,
                order: workspace.chats.reduce((max, chat) => Math.max(max, chat.order), 0) + 1,
              },
            ]
        workspace.meta.lastSelected = chatId
      })
      if (signal.aborted || revision !== this.navigation || !this.current(run)) {
        return
      }

      this.patch({ selected: chatId, screen: 'conversation' })
      void this.loadHistory()
    } catch (error) {
      if (!signal.aborted && this.current(run)) {
        this.patch({ phoneError: ApiErrorService.getMessage(error) })
      }
    } finally {
      if (this.lookup === controller && this.current(run)) {
        this.patch({ opening: false })
      }
    }
  }

  loadHistory(more = false) {
    const run = this.run
    const chatId = this.snapshot.selected

    if (!run || !run.storage || !chatId || this.snapshot.role !== 'owner') {
      return Promise.resolve()
    }

    return this.history.load({
      chatId,
      more,
      signal: run.controller.signal,
      current: () => this.current(run) && this.snapshot.selected === chatId,
      saved: this.snapshot.data.meta.history[chatId],
      previous: this.snapshot.histories[chatId],
      read: (count, signal) => run.api.getChatHistory({ chatId, count }, { signal }),
      save: (change) => this.save(run, change),
      publish: (state) =>
        this.patch({ histories: { ...this.snapshot.histories, [chatId]: state } }),
      track: (job) => this.track(run, job),
    })
  }
}

export const defaultTarget = (): Target => {
  const saved = ConnectionStorageService.read().value

  return saved
    ? {
        apiUrl: saved.apiUrl,
        idInstance: saved.idInstance,
        apiTokenInstance: saved.apiTokenInstance,
      }
    : { apiUrl: defaultApiUrl, idInstance: '', apiTokenInstance: '' }
}
