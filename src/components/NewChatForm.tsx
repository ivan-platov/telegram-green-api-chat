import { useEffect, useRef, useState } from 'react'

import { ConnectionService } from '../services/connection.service.ts'
import { PhoneService } from '../services/phone.service.ts'

import type { ChatSession } from '../services/session/chat-session.ts'
import type { SessionSnapshot } from '../types/session.ts'

export function NewChatForm({
  session,
  snapshot: s,
}: {
  session: ChatSession
  snapshot: SessionSnapshot
}) {
  const [phone, setPhone] = useState('')
  const [touched, setTouched] = useState(false)
  const phoneInput = useRef<HTMLInputElement>(null)
  const parsed = PhoneService.normalize(phone)
  const error = touched && !parsed.ok ? parsed.error : s.phoneError
  const blockReason = ConnectionService.getLookupBlockReason(s)

  useEffect(() => {
    phoneInput.current?.focus()
  }, [])

  return (
    <div
      data-ui="new-chat-layout"
      className="flex min-h-0 flex-1 items-center justify-center overflow-auto px-4 py-8 max-[599px]:px-4 max-[599px]:py-6"
    >
      <section data-ui="new-chat-card" className="form-card m-auto">
        <h2>Начните переписку</h2>
        <p className="intro">
          Введите номер собеседника. Российский номер можно начать с 8 или +7.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            setTouched(true)
            if (parsed.ok) {
              void session.openPhone(parsed.digits)
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              session.cancelNew()
            }
          }}
        >
          {blockReason && (
            <p className="field-hint" role="status">
              {blockReason}
            </p>
          )}
          <label htmlFor="phone">Номер телефона</label>
          <input
            ref={phoneInput}
            id="phone"
            type="tel"
            inputMode="tel"
            maxLength={64}
            autoComplete="off"
            placeholder="+7 999 123-45-67"
            value={phone}
            disabled={s.opening}
            aria-invalid={!!error}
            aria-describedby={error ? 'phone-error' : 'phone-hint'}
            onBlur={() => setTouched(true)}
            onChange={(event) => {
              setPhone(event.target.value)
              session.clearPhoneError()
            }}
            required
          />
          <p id="phone-hint" className="field-hint">
            Например, +7 987 123-45-67 или 8 987 123-45-67
          </p>
          {error && (
            <p className="error" id="phone-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="form-action bg-(--primary-action) enabled:hover:bg-[#005fc2]"
            disabled={s.opening || !!blockReason || !phone.trim()}
            type="submit"
          >
            {s.opening ? 'Открываем чат…' : 'Начать чат'}
          </button>
          <button
            className="form-action mt-2 border border-(--border) bg-transparent"
            type="button"
            onClick={() => session.cancelNew()}
          >
            Отмена
          </button>
        </form>
      </section>
    </div>
  )
}
