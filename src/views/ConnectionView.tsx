import { useEffect, useRef, useState } from 'react'

import arrowIcon from '../assets/icons/arrow-right.svg'
import externalIcon from '../assets/icons/external-link.svg'
import chatIcon from '../assets/icons/message-circle.svg'
import { ConnectionService } from '../services/connection.service.ts'
import { defaultTarget } from '../services/session/chat-session.ts'

import type { ChatSession } from '../services/session/chat-session.ts'
import type { SessionSnapshot } from '../types/session.ts'
import type { FormEvent } from 'react'

export function ConnectionView({
  session,
  snapshot: s,
}: {
  session: ChatSession
  snapshot: SessionSnapshot
}) {
  const [target, setTarget] = useState(defaultTarget)
  const [fieldError, setFieldError] = useState('')
  const [invalidField, setInvalidField] = useState('')
  const firstField = useRef<HTMLInputElement>(null)
  const isBusy = s.phase === 'connecting' || s.phase === 'waiting'

  useEffect(() => {
    if (!isBusy) {
      firstField.current?.focus()
    }
  }, [isBusy])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setFieldError('')
    try {
      try {
        ConnectionService.normalizeOrigin(target.apiUrl)
      } catch (error) {
        setInvalidField('api-url')
        document.getElementById('api-url')?.focus()
        throw error
      }

      if (!/^\d+$/.test(target.idInstance.trim())) {
        setInvalidField('instance')
        firstField.current?.focus()
        throw new Error('ID инстанса должен состоять из цифр.')
      }

      if (!target.apiTokenInstance.trim()) {
        setInvalidField('token')
        document.getElementById('token')?.focus()
        throw new Error('Введите токен доступа.')
      }

      await session.connect(target)
    } catch (error) {
      setFieldError(error instanceof Error ? error.message : 'Проверьте данные.')
    }
  }

  return (
    <main
      data-ui="connect-layout"
      className="flex min-h-dvh items-center justify-center bg-[#141518] px-4 py-6"
    >
      <section
        className="w-full max-w-[440px] rounded-[24px] border border-[#34353d] bg-[#202126] p-8 shadow-[0_20px_64px_#00000030] max-[599px]:rounded-[20px] max-[599px]:p-6"
        aria-labelledby="connect-title"
      >
        <div
          data-ui="card-mark"
          className="mb-5 grid size-12 place-items-center rounded-[14px] bg-[#142e4b] text-[#70b6ff]"
        >
          <span
            data-ui="chat-mark"
            className="icon size-[26px]"
            style={{ maskImage: `url("${chatIcon}")` }}
            aria-hidden="true"
          />
        </div>
        <h1 id="connect-title" className="text-[24px] leading-[30px] font-semibold text-[#f5f5f7]">
          Подключение Telegram
        </h1>
        <p className="mt-2 text-[14px] leading-[21px] text-[#b6b8c2]">
          Введите данные инстанса из кабинета GREEN-API.
        </p>
        {isBusy ? (
          <div
            data-ui="restoring"
            className="mt-7 flex flex-wrap items-center gap-3 rounded-[12px] border border-[#34353d] bg-[#15161a] p-4 text-[14px] leading-[21px] text-[#d5d7df]"
            role="status"
          >
            <span className="spinner" />
            {s.progress}
            <button
              type="button"
              className="text-button"
              onClick={() => void session.cancelConnection()}
            >
              Отменить
            </button>
          </div>
        ) : (
          <form className="mt-7" onSubmit={submit}>
            <label
              htmlFor="api-url"
              className="mt-0 mb-2 text-[13px] leading-[18px] font-medium text-[#d5d7df]"
            >
              Адрес API
            </label>
            <input
              id="api-url"
              className="h-[50px] rounded-[12px] border-[#626572] bg-[#15161a] px-3.5 text-[15px] text-[#f5f5f7] transition-[border-color,box-shadow] hover:border-[#7a7e8d] focus:border-[#70b6ff] focus:shadow-[0_0_0_3px_#70b6ff24] aria-invalid:border-[#ff8996] aria-invalid:focus:border-[#ff8996]"
              type="url"
              value={target.apiUrl}
              onChange={(event) => {
                setTarget({ ...target, apiUrl: event.target.value })
                setFieldError('')
              }}
              aria-invalid={!!fieldError && invalidField === 'api-url'}
              aria-describedby={fieldError || s.error ? 'access-error' : undefined}
              required
            />
            <label
              htmlFor="instance"
              className="mt-5 mb-2 text-[13px] leading-[18px] font-medium text-[#d5d7df]"
            >
              ID инстанса
            </label>
            <input
              id="instance"
              className="h-[50px] rounded-[12px] border-[#626572] bg-[#15161a] px-3.5 text-[15px] text-[#f5f5f7] transition-[border-color,box-shadow] hover:border-[#7a7e8d] focus:border-[#70b6ff] focus:shadow-[0_0_0_3px_#70b6ff24] aria-invalid:border-[#ff8996] aria-invalid:focus:border-[#ff8996]"
              ref={firstField}
              inputMode="numeric"
              value={target.idInstance}
              onChange={(event) => {
                setTarget({ ...target, idInstance: event.target.value })
                setFieldError('')
              }}
              aria-invalid={!!fieldError && invalidField === 'instance'}
              aria-describedby={fieldError || s.error ? 'access-error' : undefined}
              required
            />
            <label
              htmlFor="token"
              className="mt-5 mb-2 text-[13px] leading-[18px] font-medium text-[#d5d7df]"
            >
              Токен доступа
            </label>
            <input
              id="token"
              className="h-[50px] rounded-[12px] border-[#626572] bg-[#15161a] px-3.5 text-[15px] text-[#f5f5f7] transition-[border-color,box-shadow] hover:border-[#7a7e8d] focus:border-[#70b6ff] focus:shadow-[0_0_0_3px_#70b6ff24] aria-invalid:border-[#ff8996] aria-invalid:focus:border-[#ff8996]"
              type="password"
              value={target.apiTokenInstance}
              onChange={(event) => {
                setTarget({ ...target, apiTokenInstance: event.target.value })
                setFieldError('')
              }}
              autoComplete="off"
              aria-invalid={!!fieldError && invalidField === 'token'}
              aria-describedby={fieldError || s.error ? 'access-error' : undefined}
              required
            />
            {(fieldError || s.error || s.storageError) && (
              <p
                id="access-error"
                className="mt-3 rounded-[10px] border border-[#70414c] bg-[#38232a] p-3 text-[13px] leading-5 wrap-anywhere text-[#ffc0c8]"
                role="alert"
              >
                {fieldError || s.error || s.storageError}
              </p>
            )}
            <button
              className="mt-6 flex min-h-[50px] w-full items-center justify-center gap-2 rounded-[12px] border-0 bg-[#006bd6] px-5 py-3 text-[15px] leading-5 font-semibold text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#70b6ff] enabled:hover:bg-[#0879e8] enabled:active:bg-[#005bb8]"
              type="submit"
            >
              Подключиться{' '}
              <span
                data-ui="inline-icon"
                className="icon h-4 w-4 [vertical-align:-3px]"
                style={{ maskImage: `url("${arrowIcon}")` }}
                aria-hidden="true"
              />
            </button>
          </form>
        )}
        <p data-ui="save-note" className="mt-4 text-[12px] leading-[18px] text-[#a7aab5]">
          Подключение сохраняется в этом браузере.
        </p>
        <div className="mt-6 flex flex-col items-start gap-1 border-t border-[#34353d] pt-4">
          <a
            className="inline-flex min-h-11 items-center gap-2 rounded-lg text-[13px] leading-5 text-[#70b6ff] hover:text-[#a8d3ff]"
            href="https://console.green-api.com/"
            target="_blank"
            rel="noreferrer"
          >
            Открыть кабинет GREEN-API{' '}
            <span
              data-ui="inline-icon"
              className="icon h-4 w-4 [vertical-align:-3px]"
              style={{ maskImage: `url("${externalIcon}")` }}
              aria-hidden="true"
            />
          </a>
          <button
            type="button"
            data-ui="forget-access"
            className="min-h-11 rounded-lg border-0 bg-transparent px-0 text-left text-[12px] leading-[18px] text-[#b6b8c2] transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#70b6ff]"
            onClick={() => void session.disconnect()}
          >
            Удалить сохранённый доступ
          </button>
        </div>
      </section>
    </main>
  )
}
