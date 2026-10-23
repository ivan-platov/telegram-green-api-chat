import { useLayoutEffect, useRef, useState } from 'react'

import sendIcon from '../assets/icons/send-horizontal.svg'
import { ConnectionService } from '../services/connection.service.ts'

import type { ChatSession } from '../services/session/chat-session.ts'
import type { SessionSnapshot } from '../types/session.ts'
import type { RefObject } from 'react'

export function Composer({
  session,
  snapshot: s,
  composer,
  desktopEnter,
}: {
  session: ChatSession
  snapshot: SessionSnapshot
  composer: RefObject<HTMLTextAreaElement | null>
  desktopEnter: boolean
}) {
  const [composerNotice, setComposerNotice] = useState('')
  const composing = useRef(false)
  const enterHeld = useRef(false)
  const suppressEnter = useRef(false)
  const draft = session.draft()
  const canSend = session.sendReady() && !!draft.text.trim() && draft.text.length <= 4096
  const blockReason = ConnectionService.getSendBlockReason(s)

  useLayoutEffect(() => {
    const el = composer.current

    if (el) {
      el.style.height = 'auto'
      el.style.height = `${Math.min(180, Math.max(44, el.scrollHeight))}px`
    }
  }, [draft.text, composer])

  return (
    <form
      data-ui="composer-area"
      className="shrink-0 px-4 pt-2 pb-3 max-[599px]:pr-4 max-[599px]:pl-4"
      onSubmit={(event) => {
        event.preventDefault()
        void session.send()
      }}
    >
      {blockReason && (
        <p id="send-block-reason" className="field-hint" role="status">
          {blockReason}
        </p>
      )}
      {composerNotice && (
        <p className="field-hint" role="status">
          {composerNotice}
        </p>
      )}
      <div
        data-ui="composer"
        className="flex items-end gap-1.5 rounded-[12px] border border-transparent bg-(--sidebar) p-1.5 [transition:border-color_120ms,_box-shadow_120ms] focus-within:[border-color:var(--focus)] focus-within:shadow-none"
      >
        <textarea
          ref={composer}
          aria-label="Сообщение"
          placeholder="Написать сообщение…"
          rows={1}
          value={draft.text}
          readOnly={s.role !== 'owner' || s.phase !== 'ready' || s.navigating}
          maxLength={Math.max(4096, draft.text.length)}
          onChange={(event) => {
            setComposerNotice('')
            session.editDraft(event.target.value)
          }}
          onPaste={(event) => {
            const el = event.currentTarget
            const addition = event.clipboardData.getData('text')

            if (el.value.length - (el.selectionEnd - el.selectionStart) + addition.length > 4096) {
              event.preventDefault()
              setComposerNotice('Текст не вставлен: предел 4096 символов')
            }
          }}
          onCompositionStart={() => {
            composing.current = true
            suppressEnter.current = false
          }}
          onCompositionEnd={() => {
            composing.current = false
            suppressEnter.current = enterHeld.current
          }}
          onKeyUp={(event) => {
            if (event.key === 'Enter') {
              enterHeld.current = false
              suppressEnter.current = false
            }
          }}
          onBlur={() => {
            enterHeld.current = false
            suppressEnter.current = false
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              enterHeld.current = true
            } else {
              suppressEnter.current = false
            }

            if (
              event.key === 'Enter' &&
              desktopEnter &&
              !event.shiftKey &&
              !event.altKey &&
              !event.ctrlKey &&
              !event.metaKey &&
              !composing.current &&
              !event.nativeEvent.isComposing &&
              !suppressEnter.current
            ) {
              event.preventDefault()
              if (!event.repeat && canSend) {
                void session.send()
              }
            }
          }}
          className="max-h-[180px] min-h-11 w-full min-w-0 resize-none overflow-auto border-0 bg-transparent px-2.5 py-3 text-[16px] leading-5 text-white focus:shadow-none focus:outline-none focus-visible:shadow-none focus-visible:outline-none"
        />
        <button
          type="submit"
          data-ui="send-button"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-0 bg-(--primary) text-white [&:hover:not(:disabled)]:[background:#005fc2]"
          aria-label="Отправить сообщение"
          disabled={!canSend}
          aria-describedby={blockReason ? 'send-block-reason' : undefined}
          title={
            blockReason ||
            (draft.text.length > 4096
              ? 'Сократите текст до 4096 символов.'
              : !draft.text.trim()
                ? 'Введите текст сообщения.'
                : 'Отправить сообщение')
          }
        >
          <span
            data-ui="send-icon"
            className="icon h-5.5 w-5.5"
            style={{ maskImage: `url("${sendIcon}")` }}
            aria-hidden="true"
          />
        </button>
      </div>
      <div
        data-ui="composer-hints"
        className="flex min-h-4.5 items-center justify-between gap-2 pt-1 text-[10px] leading-normal text-(--muted)"
      >
        <span>
          {s.storageError
            ? 'Черновик может быть не сохранён. Не закрывайте эту вкладку.'
            : s.draftSaving
              ? 'Сохраняем черновик…'
              : desktopEnter
                ? 'Enter — отправить · Shift+Enter — новая строка'
                : ''}
        </span>
        {draft.text.length >= 3600 && <span role="status">{draft.text.length}/4096</span>}
      </div>
    </form>
  )
}
