import { useEffect, useMemo, useRef, useState } from 'react'

import backIcon from '../assets/icons/arrow-left.svg'
import chatIcon from '../assets/icons/message-circle.svg'
import plusIcon from '../assets/icons/plus.svg'
import { ChatList } from '../components/ChatList.tsx'
import { Composer } from '../components/Composer.tsx'
import { ConnectionIndicator } from '../components/ConnectionIndicator.tsx'
import { ConnectionStatus } from '../components/ConnectionStatus.tsx'
import { HistoryFeedback } from '../components/HistoryFeedback.tsx'
import { MessageList } from '../components/MessageList.tsx'
import { NewChatForm } from '../components/NewChatForm.tsx'
import { ConnectionService } from '../services/connection.service.ts'
import { MessageService } from '../services/messages/message.service.ts'
import { PhoneService } from '../services/phone.service.ts'

import type { ReadAnchor } from '../components/MessageList.tsx'
import type { ChatSession } from '../services/session/chat-session.ts'
import type { SessionSnapshot } from '../types/session.ts'

export function WorkspaceView({
  session,
  snapshot: s,
}: {
  session: ChatSession
  snapshot: SessionSnapshot
}) {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width:600px)').matches)
  const [desktopEnter, setDesktopEnter] = useState(
    () =>
      window.matchMedia('(hover:hover) and (pointer:fine)').matches &&
      navigator.maxTouchPoints === 0,
  )
  const anchors = useRef(new Map<string, ReadAnchor>())
  const heading = useRef<HTMLHeadingElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const newButton = useRef<HTMLButtonElement>(null)
  const interaction = useRef<'touch' | 'desktop' | 'restore'>('restore')
  const focusEpoch = useRef(0)
  const [focusChat, setFocusChat] = useState<{
    id: string
    version: number
  }>()
  const selectedChat = s.data.chats.find((chat) => chat.chatId === s.selected)
  const messages = useMemo(
    () => s.data.messages.filter((message) => message.chatId === s.selected),
    [s.data.messages, s.selected],
  )
  const previews = useMemo(() => {
    const result = new Map<string, string>()

    for (const message of MessageService.order(s.data.messages)) {
      result.set(message.chatId, message.text)
    }

    for (const [chatId, history] of Object.entries(s.data.meta.history)) {
      if (!result.has(chatId) && history.rawCount >= 0) {
        result.set(chatId, 'Нет доступных текстовых сообщений')
      }
    }

    return result
  }, [s.data.messages, s.data.meta.history])
  const history = s.histories[s.selected]
  const statusProblems = ConnectionService.getProblems(s)
  const canNavigate = s.role === 'owner' && s.phase === 'ready' && !s.navigating
  const title = selectedChat?.phone ? PhoneService.getLabel(selectedChat.phone) : s.selected

  useEffect(() => {
    const media = window.matchMedia('(min-width:600px)')
    const input = window.matchMedia('(hover:hover) and (pointer:fine)')
    const resize = () => {
      setWide(media.matches)
      setDesktopEnter(input.matches && navigator.maxTouchPoints === 0)
    }

    media.addEventListener('change', resize)
    input.addEventListener('change', resize)

    return () => {
      media.removeEventListener('change', resize)
      input.removeEventListener('change', resize)
    }
  }, [])
  useEffect(() => {
    const epoch = ++focusEpoch.current
    const active = document.activeElement
    const frame = requestAnimationFrame(() => {
      if (
        epoch !== focusEpoch.current ||
        (document.activeElement !== active && document.activeElement !== document.body)
      ) {
        return
      }

      if (s.screen === 'newChat') {
        return
      }

      if (s.screen === 'conversation') {
        if (interaction.current === 'desktop') {
          composer.current?.focus()
        } else {
          heading.current?.focus()
        }
      } else if (interaction.current !== 'restore') {
        if (!wide && s.selected) {
          setFocusChat({ id: s.selected, version: epoch })
        } else {
          newButton.current?.focus()
        }
      } else {
        heading.current?.focus()
      }
    })

    return () => {
      cancelAnimationFrame(frame)
      focusEpoch.current = epoch + 1
    }
  }, [s.screen, s.selected, wide])
  useEffect(() => {
    const active = document.activeElement

    if (active instanceof HTMLElement && active.closest('[hidden]')) {
      heading.current?.focus()
    }
  }, [wide])

  function mark(event: { nativeEvent: Event }) {
    interaction.current =
      'pointerType' in event.nativeEvent && event.nativeEvent.pointerType === 'touch'
        ? 'touch'
        : 'desktop'
  }

  return (
    <main
      data-ui="workspace"
      className="grid h-dvh [grid-template-columns:394px_minmax(0,_1fr)] overflow-hidden max-[599px]:flex max-[599px]:flex-col min-[600px]:max-[799px]:[grid-template-columns:260px_minmax(0,_1fr)]"
    >
      <aside
        hidden={!wide && s.screen !== 'chats'}
        data-ui="sidebar"
        className="flex min-h-0 min-w-0 flex-col border-r border-(--border) bg-(--sidebar) max-[599px]:flex-1 max-[599px]:[border-right:0]"
        aria-label="Чаты"
        aria-hidden={!wide && s.screen !== 'chats'}
      >
        <header
          data-ui="sidebar-header"
          className="flex h-[65px] min-h-[65px] items-center justify-between gap-3 border-b border-(--border) px-4 py-0 max-[599px]:px-4 max-[599px]:py-0"
        >
          <h1
            ref={s.screen === 'chats' ? heading : undefined}
            tabIndex={-1}
            className="text-[24px]"
          >
            Чаты
          </h1>
          <button
            type="button"
            data-ui="new-chat-button"
            className="relative isolate grid h-11 w-11 min-w-11 shrink-0 place-items-center rounded-[12px] border-0 bg-transparent p-0 text-[30px] text-white before:absolute before:inset-1.5 before:-z-1 before:rounded-full before:bg-(--primary) before:content-[''] hover:bg-transparent hover:before:bg-[#479fff] disabled:before:bg-[#ffffff1f]"
            ref={newButton}
            aria-label="Новый чат"
            disabled={!canNavigate}
            onClick={(event) => {
              mark(event)
              void session.newChat()
            }}
          >
            <span
              data-ui="new-chat-icon"
              className="icon h-6 w-6"
              style={{ maskImage: `url("${plusIcon}")` }}
              aria-hidden="true"
            />
          </button>
        </header>
        <ChatList
          chats={s.data.chats}
          selected={s.selected}
          preview={previews}
          enabled={wide || s.screen === 'chats'}
          focusChat={focusChat}
          onSelect={(id, touch) => {
            interaction.current = touch ? 'touch' : 'desktop'
            void session.select(id)
          }}
        />
        <div
          data-ui="sidebar-footer"
          className="flex items-center justify-between gap-2 border-t border-(--border) px-4 py-3"
        >
          <ConnectionIndicator snapshot={s} />
          <button
            type="button"
            className="text-button"
            onClick={() => void session.disconnect()}
            title="Сохранённый доступ будет удалён. Локальная история останется."
          >
            Отключиться
          </button>
        </div>
      </aside>
      <section
        hidden={!wide && s.screen === 'chats'}
        data-ui="main-pane"
        className="relative isolate flex min-h-0 min-w-0 flex-col bg-(--conversation) before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:[mask-image:url('../assets/max-space-pattern.svg')] before:[mask-size:auto] before:[mask-repeat:repeat] before:content-[''] before:[background:linear-gradient(28deg,_rgb(80_91_199_/_30%)_8.03%,_rgb(80_91_199_/_30%)_91.51%)] max-[599px]:flex-1"
        aria-label="Переписка"
        aria-hidden={!wide && s.screen === 'chats'}
      >
        <header
          data-ui="conversation-header"
          className="flex h-[65px] min-h-[65px] items-center gap-3 border-b border-(--border) bg-(--sidebar) px-4 py-0 max-[599px]:px-4 max-[599px]:py-0"
        >
          {!wide && s.screen !== 'chats' && (
            <button
              type="button"
              data-ui="icon-button"
              className="grid h-11 w-11 min-w-11 shrink-0 place-items-center rounded-[12px] border-0 bg-transparent p-0 text-[30px] text-[#69adff] hover:[background:#ffffff09]"
              aria-label={s.screen === 'newChat' ? 'Отменить новый чат' : 'Назад к чатам'}
              onClick={() => {
                if (s.screen === 'newChat') {
                  session.cancelNew()
                } else {
                  void session.back()
                }
              }}
            >
              <span
                className="icon"
                style={{ maskImage: `url("${backIcon}")` }}
                aria-hidden="true"
              />
            </button>
          )}
          {s.screen === 'conversation' && (
            <span className="avatar" aria-hidden="true">
              {title.slice(-2)}
            </span>
          )}
          <h2
            ref={s.screen !== 'chats' ? heading : undefined}
            tabIndex={-1}
            className="overflow-hidden text-[16px] font-semibold text-ellipsis whitespace-nowrap"
          >
            {s.screen === 'newChat'
              ? 'Новый чат'
              : s.screen === 'conversation'
                ? title
                : 'Переписка'}
          </h2>
        </header>
        <ConnectionStatus session={session} snapshot={s} />
        {s.screen === 'newChat' ? (
          <NewChatForm session={session} snapshot={s} />
        ) : s.screen === 'conversation' ? (
          <>
            <HistoryFeedback
              history={history}
              enabled={s.role === 'owner' && s.phase === 'ready' && !s.storageError}
              onRetry={() => void session.loadHistory()}
            />
            {s.data.meta.warnings[s.selected] && (
              <div
                className="max-h-[35dvh] shrink-0 overflow-auto bg-(--warning-bg) px-5 py-2.5 text-[12px] leading-normal wrap-anywhere text-(--warning-text) [&_details]:mt-1.5"
                role="status"
              >
                <strong>Предупреждение по чату</strong>
                <details>
                  <summary>Подробнее</summary>
                  <p>{s.data.meta.warnings[s.selected]}</p>
                </details>
              </div>
            )}
            <MessageList
              key={`${s.scope}:${s.selected}`}
              scope={s.scope}
              chatId={s.selected}
              messages={messages}
              anchors={anchors.current}
              incomingId={s.incomingId}
              loading={history?.loading ?? false}
              historyError={!!history?.error}
              historyLoaded={
                history?.rawCount !== undefined || s.data.meta.history[s.selected] !== undefined
              }
              checking={s.checking}
              checkBlockReason={ConnectionService.getStatusCheckBlockReason(s)}
              hasMore={
                s.role === 'owner' &&
                s.phase === 'ready' &&
                history?.rawCount !== undefined &&
                history.rawCount >= history.count
              }
              onLoadEarlier={() => void session.loadHistory(true)}
              onCheck={(id) => {
                void session.checkStatus(id)
              }}
            />
            <Composer
              session={session}
              snapshot={s}
              composer={composer}
              desktopEnter={desktopEnter}
            />
          </>
        ) : (
          <div data-ui="welcome" className="empty-state m-auto w-[min(430px,_100%)]">
            <div
              data-ui="empty-mark"
              className="[margin:0_auto_24px] grid h-18 w-18 place-items-center rounded-full [background:#25262d]"
            >
              <span
                data-ui="chat-mark"
                className="icon h-8 w-8"
                style={{ maskImage: `url("${chatIcon}")` }}
                aria-hidden="true"
              />
            </div>
            <h2>Выберите чат или начните новый</h2>
            <p>Открытые переписки сохраняются в этом браузере.</p>
            <button
              type="button"
              className="form-action bg-(--primary-action) enabled:hover:bg-[#005fc2]"
              disabled={!canNavigate}
              onClick={(event) => {
                mark(event)
                void session.newChat()
              }}
            >
              Новый чат
            </button>
          </div>
        )}
      </section>
      {!wide && s.screen === 'chats' && statusProblems.length > 0 && (
        <div
          data-ui="mobile-problem"
          className="problem-panel hidden max-[599px]:block"
          role="status"
        >
          {statusProblems[0]}
          <button type="button" className="text-button" onClick={() => void session.retry()}>
            Проверить подключение
          </button>
        </div>
      )}
    </main>
  )
}
