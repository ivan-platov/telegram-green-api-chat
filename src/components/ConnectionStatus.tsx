import externalIcon from '../assets/icons/external-link.svg'
import { ConnectionService } from '../services/connection.service.ts'

import type { ChatSession } from '../services/session/chat-session.ts'
import type { SessionSnapshot } from '../types/session.ts'

export function ConnectionStatus({
  session,
  snapshot: s,
}: {
  session: ChatSession
  snapshot: SessionSnapshot
}) {
  const statusProblems = ConnectionService.getProblems(s)

  return (
    <>
      {s.data.meta.quotaNotice && !s.data.meta.quotaNotice.dismissed && (
        <div className="problem-panel" role="status">
          <strong>Уведомление GREEN-API о лимите тарифа</strong>
          <details>
            <summary>Подробнее о лимите</summary>
            <p>{s.data.meta.quotaNotice.description}</p>
          </details>
          <button
            className="text-button"
            type="button"
            disabled={s.role !== 'owner'}
            onClick={() => void session.dismissQuotaNotice()}
          >
            Скрыть уведомление о лимите
          </button>
        </div>
      )}
      {statusProblems.length > 0 && (
        <div className="problem-panel" role="status">
          <strong>{statusProblems[0]}</strong>
          <details>
            <summary>Подробнее</summary>
            <ul>
              {[...new Set(statusProblems)].map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
            {s.phase === 'ready' && !s.incomingReady && (
              <p>В кабинете включите входящие уведомления и оставьте Webhook URL пустым.</p>
            )}
            {s.phase === 'ready' && !s.statusesReady && (
              <p>
                Включите уведомления об исходящих сообщениях с API, с телефона и об их статусах. Без
                них проверка через журнал доступна при работающем получении сообщений.
              </p>
            )}
            <a href="https://console.green-api.com/" target="_blank" rel="noreferrer">
              Кабинет GREEN-API{' '}
              <span
                data-ui="inline-icon"
                className="icon h-4 w-4 [vertical-align:-3px]"
                style={{ maskImage: `url("${externalIcon}")` }}
                aria-hidden="true"
              />
            </a>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                void session.editAccess()
              }}
            >
              Изменить доступ
            </button>
          </details>
          <button
            className="text-button"
            type="button"
            disabled={s.role !== 'owner' || s.phase !== 'ready' || s.checkingConnection}
            onClick={() => void session.retry()}
          >
            {s.checkingConnection ? 'Проверяем подключение…' : 'Проверить подключение'}
          </button>
        </div>
      )}
    </>
  )
}
