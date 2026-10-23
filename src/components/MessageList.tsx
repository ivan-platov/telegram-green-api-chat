import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { MessageMeta } from './MessageMeta.tsx'
import downIcon from '../assets/icons/arrow-down.svg'
import { DateService } from '../services/date.service.ts'
import { MessagePresentationService } from '../services/messages/message-presentation.service.ts'

import type { Message } from '../types/message.ts'

export type ReadAnchor = {
  id?: string
  offset: number
  end: boolean
  width: number
}

export function MessageList({
  messages,
  scope,
  chatId,
  anchors,
  incomingId,
  loading,
  historyError,
  historyLoaded,
  checking,
  checkBlockReason,
  onCheck,
  hasMore,
  onLoadEarlier,
}: {
  messages: Message[]
  scope: string
  chatId: string
  anchors: Map<string, ReadAnchor>
  incomingId?: string
  loading: boolean
  historyError?: boolean
  historyLoaded: boolean
  checking?: string[]
  checkBlockReason: string
  onCheck: (id: string) => void
  hasMore: boolean
  onLoadEarlier: () => void
}) {
  const element = useRef<HTMLDivElement>(null)
  const [zone, setZone] = useState(DateService.getBrowserZone)
  const rows = useMemo(
    () => MessagePresentationService.getRows(messages, scope, chatId, zone),
    [messages, scope, chatId, zone],
  )
  const [unread, setUnread] = useState(0)
  const key = JSON.stringify([scope, chatId])
  const saved = useRef(anchors.get(key))
  const atEnd = useRef(saved.current?.end ?? true)
  const initialized = useRef(false)
  const userScrolled = useRef(false)
  const localIds = useRef(new Set(messages.map((message) => message.id)))
  const lastIncoming = useRef(incomingId)
  const frame = useRef(0)
  const restoringAnchor = useRef(false)
  const measuredWidth = useRef(0)
  const measuredHeight = useRef(0)
  const previousZone = useRef(zone)
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => element.current,
    getItemKey: (index) => rows[index].key,
    estimateSize: (index) => (rows[index].kind === 'message' ? 96 : 36),
    overscan: 8,
    gap: 12,
    anchorTo: 'end',
    followOnAppend: true,
    scrollEndThreshold: 24,
    useAnimationFrameWithResizeObserver: true,
  })
  const current = useRef({ rows, virtual })

  current.current = { rows, virtual }
  const earlier = useRef(onLoadEarlier)

  earlier.current = onLoadEarlier
  const visibleStart =
    virtual.getVirtualItems().find((item) => item.end >= (virtual.scrollOffset ?? 0))?.index ?? 0

  useEffect(() => {
    if (!initialized.current || loading || historyError || !hasMore || visibleStart > 12) {
      return
    }

    const frame = requestAnimationFrame(() => earlier.current())

    return () => cancelAnimationFrame(frame)
  }, [visibleStart, loading, historyError, hasMore, messages])
  const capture = useCallback(() => {
    const el = element.current

    if (!el) {
      return
    }

    if (
      restoringAnchor.current ||
      (measuredWidth.current && measuredWidth.current !== el.clientWidth) ||
      (measuredHeight.current && measuredHeight.current !== el.clientHeight)
    ) {
      return
    }

    measuredWidth.current = el.clientWidth
    measuredHeight.current = el.clientHeight
    const end = el.scrollHeight - el.clientHeight - el.scrollTop <= 24

    atEnd.current = end
    const viewport = el.getBoundingClientRect()
    const first = [...el.querySelectorAll<HTMLElement>('[data-local-id]')].find((node) => {
      const rect = node.getBoundingClientRect()

      return rect.bottom > viewport.top + 4 && rect.top < viewport.bottom
    })

    anchors.set(key, {
      id: first?.dataset.localId,
      offset: first
        ? viewport.top +
          parseFloat(getComputedStyle(el).paddingTop) -
          first.getBoundingClientRect().top
        : 0,
      end,
      width: el.clientWidth,
    })
    if (end) {
      setUnread(0)
    }
  }, [anchors, key])
  const restore = useCallback(
    (anchor?: ReadAnchor) => {
      cancelAnimationFrame(frame.current)
      restoringAnchor.current = false
      const { rows, virtual } = current.current

      if (anchor?.id && !anchor.end) {
        const index = rows.findIndex(
          (row) => row.kind === 'message' && row.message.id === anchor.id,
        )

        if (index >= 0) {
          restoringAnchor.current = true
          virtual.scrollToIndex(index, { align: 'start' })
          // Restoring a saved viewport waits for real DOM measurements after reflow/remount.
          // Prepending history is anchored by the virtualizer itself.
          let attempts = 0
          let stableFrames = 0
          const position = () => {
            const el = element.current

            if (!el) {
              restoringAnchor.current = false

              return
            }

            const node = [...el.querySelectorAll<HTMLElement>('[data-local-id]')].find(
              (node) => node.dataset.localId === anchor.id,
            )

            if (node) {
              const delta =
                node.getBoundingClientRect().top -
                el.getBoundingClientRect().top -
                parseFloat(getComputedStyle(el).paddingTop) +
                anchor.offset

              if (Math.abs(delta) > 0.5) {
                stableFrames = 0
                virtual.scrollToOffset(el.scrollTop + delta)
              } else {
                stableFrames++
              }
            } else {
              virtual.scrollToIndex(index, { align: 'start' })
            }

            if (++attempts < 12 && stableFrames < 3) {
              frame.current = requestAnimationFrame(position)
            } else {
              restoringAnchor.current = false
              capture()
            }
          }

          frame.current = requestAnimationFrame(position)

          return
        }
      }

      virtual.scrollToEnd()
    },
    [capture],
  )

  function userScroll() {
    userScrolled.current = true
    restoringAnchor.current = false
    cancelAnimationFrame(frame.current)
  }

  useLayoutEffect(
    () => () => {
      initialized.current = false
    },
    [],
  )
  useLayoutEffect(() => {
    if (!initialized.current && (rows.length || !loading)) {
      initialized.current = true
      if (!userScrolled.current) {
        restore(saved.current)
      }
    }

    const newAttempt = messages.find(
      (message) => !localIds.current.has(message.id) && message.localCreatedAt !== undefined,
    )

    localIds.current = new Set(messages.map((message) => message.id))
    if (newAttempt && initialized.current) {
      const index = rows.findIndex(
        (row) => row.kind === 'message' && row.message.id === newAttempt.id,
      )

      if (index >= 0) {
        virtual.scrollToIndex(index, { align: 'end' })
      }
    }

    const refresh = requestAnimationFrame(capture)

    return () => cancelAnimationFrame(refresh)
  }, [rows, loading, messages, virtual, capture, restore])
  useEffect(() => {
    if (incomingId !== lastIncoming.current) {
      lastIncoming.current = incomingId
      if (!atEnd.current) {
        setUnread((value) => value + 1)
      }
    }
  }, [incomingId])
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        setZone(DateService.getBrowserZone())
      }
    }

    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)

    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  useLayoutEffect(() => {
    const el = element.current

    if (!el) {
      return
    }

    let width = el.clientWidth
    let height = el.clientHeight

    measuredWidth.current = width
    measuredHeight.current = height
    const observer = new ResizeObserver(() => {
      const widthChanged = width !== el.clientWidth
      const heightChanged = height !== el.clientHeight

      if (widthChanged || heightChanged) {
        width = el.clientWidth
        height = el.clientHeight
        measuredWidth.current = width
        measuredHeight.current = height
        const anchor = anchors.get(key)

        if (widthChanged) {
          virtual.measure()
          restore(anchor)
        } else if (atEnd.current) {
          virtual.scrollToEnd()
        } else {
          capture()
        }
      }
    })

    observer.observe(el)

    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame.current)
      restoringAnchor.current = false
    }
  }, [anchors, key, virtual, restore, capture])
  useLayoutEffect(() => {
    if (previousZone.current !== zone && initialized.current) {
      const anchor = anchors.get(key)

      virtual.measure()
      restore(anchor)
    }

    previousZone.current = zone
  }, [zone, anchors, key, virtual, restore])

  return (
    <div data-ui="message-region" className="relative min-h-0 flex-1">
      <div
        data-ui="message-scroll"
        className="h-full overflow-auto px-4 py-3 [overflow-anchor:none] max-[599px]:pr-4 max-[599px]:pl-4"
        role="region"
        ref={element}
        data-testid="message-scroll"
        aria-label="Сообщения"
        onWheel={userScroll}
        onTouchMove={userScroll}
        onPointerDown={userScroll}
        onKeyDown={(event) => {
          if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
            userScroll()
          }
        }}
        onScroll={capture}
        tabIndex={0}
      >
        {!rows.length && (
          <div className="empty-state">
            <h2>
              {loading
                ? 'Загружаем историю…'
                : historyError
                  ? 'История не загружена'
                  : historyLoaded
                    ? 'Нет доступных текстовых сообщений'
                    : 'История ещё не загружена'}
            </h2>
            <p>
              {loading
                ? 'Подождите ответа сервиса.'
                : historyError
                  ? 'Повторите загрузку истории.'
                  : historyLoaded
                    ? 'GREEN-API не вернул текстовые сообщения в загруженной части истории.'
                    : 'Для загрузки истории необходимо активное подключение в этой вкладке.'}
            </p>
          </div>
        )}
        <div className="virtual-surface" style={{ height: virtual.getTotalSize() }}>
          {virtual.getVirtualItems().map((item) => {
            const row = rows[item.index]

            return (
              <div
                data-index={item.index}
                data-message-key={row.key}
                key={item.key}
                ref={virtual.measureElement}
                data-kind={row.kind}
                data-ui="virtual-message-row"
                className="absolute top-0 left-0 flex w-full data-[kind=day]:justify-center data-[kind=undated]:justify-center [&.day]:justify-center [&.undated]:justify-center"
                style={{ top: item.start }}
              >
                {row.kind === 'message' ? (
                  <article
                    data-local-id={row.message.id}
                    data-direction={row.message.direction}
                    data-ui="bubble"
                    className="max-w-[min(480px,_85%)] min-w-18 rounded-[16px] [padding:8px_12px_6px] wrap-anywhere data-[direction=in]:mr-auto data-[direction=in]:rounded-bl-[4px] data-[direction=in]:[background:var(--incoming)] data-[direction=out]:ml-auto data-[direction=out]:rounded-br-[4px] data-[direction=out]:[background:var(--outgoing)]"
                  >
                    <p data-ui="message-text" className="text-[16px] leading-5 whitespace-pre-wrap">
                      {row.message.text}
                    </p>
                    <MessageMeta
                      message={row.message}
                      zone={zone}
                      onCheck={onCheck}
                      checking={checking?.includes(row.message.id) ?? false}
                      checkBlockReason={checkBlockReason}
                    />
                  </article>
                ) : (
                  <div
                    data-ui="day-label"
                    className="rounded-[16px] px-2 py-0.5 text-center text-[14px] leading-5 text-(--muted) [background:#25262dad]"
                  >
                    {row.label}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      {(unread > 0 || !atEnd.current) && (
        <button
          type="button"
          data-ui="jump-down"
          className="absolute right-6 bottom-4 min-h-11 rounded-[24px] border border-(--border) bg-(--sidebar) px-4 py-2.5 text-[#ededf0] [box-shadow:0_4px_16px_#0005]"
          onClick={() => {
            virtual.scrollToEnd()
            setUnread(0)
          }}
          aria-label="К последним сообщениям"
        >
          {unread ? `Новые сообщения: ${unread}` : 'Вниз'}{' '}
          <span
            data-ui="inline-icon"
            className="icon h-4 w-4 [vertical-align:-3px]"
            style={{ maskImage: `url("${downIcon}")` }}
            aria-hidden="true"
          />
        </button>
      )}
    </div>
  )
}
