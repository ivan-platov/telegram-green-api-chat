import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { PhoneService } from '../services/phone.service.ts'

import type { Chat } from '../types/workspace.ts'

export function ChatList({
  chats,
  selected,
  preview,
  enabled,
  onSelect,
  focusChat,
}: {
  chats: Chat[]
  selected: string
  preview: Map<string, string>
  enabled: boolean
  onSelect: (id: string, touch: boolean) => void
  focusChat?: {
    id: string
    version: number
  }
}) {
  const element = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState('')
  const touch = useRef(false)
  const revision = useRef(0)
  const pendingFocus = useRef<
    | {
        id: string
        token: number
        source: Element | null
      }
    | undefined
  >(undefined)
  const savedOffset = useRef(0)
  const virtual = useVirtualizer({
    count: chats.length,
    getScrollElement: () => element.current,
    estimateSize: () => 82,
    getItemKey: (index) => chats[index].chatId,
    overscan: 6,
    enabled,
    anchorTo: 'start',
    followOnAppend: false,
  })
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const focus = useCallback(
    (index: number) => {
      const chat = chats[index]

      if (!chat) {
        return
      }

      const token = ++revision.current

      pendingFocus.current = { id: chat.chatId, token, source: document.activeElement }
      virtual.scrollToIndex(index)
      buttons.current.get(chat.chatId)?.focus({ preventScroll: true })
    },
    [chats, virtual],
  )

  useLayoutEffect(() => {
    const intent = pendingFocus.current

    if (intent && intent.token === revision.current) {
      const button = buttons.current.get(intent.id)

      if (
        document.activeElement !== intent.source &&
        document.activeElement !== document.body &&
        document.activeElement !== button
      ) {
        pendingFocus.current = undefined

        return
      }

      if (button) {
        pendingFocus.current = undefined
        button.focus({ preventScroll: true })
      }
    }
  })
  useLayoutEffect(() => {
    if (enabled) {
      virtual.scrollToOffset(savedOffset.current)
    }
  }, [enabled, virtual])
  const appliedFocus = useRef<typeof focusChat>(undefined)

  useEffect(() => {
    if (enabled && focusChat && appliedFocus.current !== focusChat) {
      appliedFocus.current = focusChat
      focus(chats.findIndex((chat) => chat.chatId === focusChat.id))
    }
  }, [focusChat, enabled, chats, focus])
  useEffect(
    () => () => {
      revision.current++
    },
    [],
  )
  const items = virtual.getVirtualItems()
  const visible = items.filter(
    (item) =>
      item.end > (virtual.scrollOffset ?? 0) &&
      item.start < (virtual.scrollOffset ?? 0) + (virtual.scrollRect?.height ?? 0),
  )
  const entries = visible.length ? visible : items
  const tabId = entries.some((item) => chats[item.index].chatId === focused)
    ? focused
    : entries.some((item) => chats[item.index].chatId === selected)
      ? selected
      : entries[0] && chats[entries[0].index].chatId

  return (
    <div
      data-ui="chat-scroll"
      className="relative min-h-0 flex-1 overflow-auto [overflow-anchor:none]"
      ref={element}
      aria-label="Список чатов"
      data-testid="chat-scroll"
      tabIndex={-1}
      onScroll={(event) => {
        if (enabled) {
          savedOffset.current = event.currentTarget.scrollTop
        }
      }}
    >
      {!chats.length && (
        <p
          data-ui="list-empty"
          className="px-5 py-8 text-center text-[14px] [line-height:1.6] text-(--muted)"
        >
          Здесь появятся открытые вами чаты
        </p>
      )}
      <div className="virtual-surface" style={{ height: virtual.getTotalSize() }}>
        {items.map((item) => {
          const chat = chats[item.index]

          return (
            <button
              key={item.key}
              type="button"
              data-ui="chat-row"
              className="absolute [inset:0_0_auto] flex w-full items-center gap-4 rounded-none border-0 bg-transparent [padding:9px_16px] text-left hover:[background:#ffffff07] [&_.avatar]:h-14 [&_.avatar]:w-14 [&_.avatar]:text-[18px] [&[aria-current=true]]:shadow-none [&[aria-current=true]]:[background:var(--selected)]"
              style={{ height: item.size, transform: `translateY(${item.start}px)` }}
              ref={(button) => {
                if (button) {
                  buttons.current.set(chat.chatId, button)
                } else {
                  buttons.current.delete(chat.chatId)
                }
              }}
              aria-current={selected === chat.chatId ? 'true' : undefined}
              tabIndex={tabId === chat.chatId ? 0 : -1}
              aria-label={`Чат ${chat.phone ? PhoneService.getLabel(chat.phone) : chat.chatId}`}
              onFocus={() => setFocused(chat.chatId)}
              onPointerDown={(event) => {
                touch.current = event.pointerType === 'touch'
              }}
              onClick={() => onSelect(chat.chatId, touch.current)}
              onKeyDown={(event) => {
                let index: number | undefined

                if (event.key === 'ArrowDown') {
                  index = Math.min(chats.length - 1, item.index + 1)
                }

                if (event.key === 'ArrowUp') {
                  index = Math.max(0, item.index - 1)
                }

                if (event.key === 'Home') {
                  index = 0
                }

                if (event.key === 'End') {
                  index = chats.length - 1
                }

                if (index !== undefined) {
                  event.preventDefault()
                  focus(index)
                }

                if (event.key === 'Enter' || event.key === ' ') {
                  touch.current = false
                }
              }}
            >
              <span className="avatar" aria-hidden="true">
                {(chat.phone || chat.chatId).slice(-2)}
              </span>
              <span data-ui="chat-row-text" className="flex min-w-0 flex-col gap-1">
                <strong className="overflow-hidden text-[15px] font-semibold text-ellipsis whitespace-nowrap">
                  {chat.phone ? PhoneService.getLabel(chat.phone) : chat.chatId}
                </strong>
                <span className="overflow-hidden text-[15px] text-ellipsis whitespace-nowrap text-(--muted)">
                  {preview.get(chat.chatId) ?? 'История ещё не загружена'}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
