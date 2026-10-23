import { ConnectionService } from '../services/connection.service.ts'

import type { SessionSnapshot } from '../types/session.ts'

export function ConnectionIndicator({ snapshot }: { snapshot: SessionSnapshot }) {
  const status = ConnectionService.getStatus(snapshot)
  const problems = ConnectionService.getProblems(snapshot)

  return (
    <details className="relative min-w-0">
      <summary
        data-ui="connection-indicator"
        data-tone={status.tone}
        className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-[11px] leading-normal text-(--muted) [&::-webkit-details-marker]:hidden"
        aria-label={`Состояние подключения: ${status.label}`}
      >
        <span
          aria-hidden="true"
          className={`size-1.5 shrink-0 rounded-full ${status.tone === 'success' ? 'bg-[#6bcaa0]' : status.tone === 'progress' ? 'bg-[#70b6ff]' : status.tone === 'error' ? 'bg-(--error-text)' : 'bg-(--warning-text)'}`}
        />
        <span>{status.label}</span>
      </summary>
      <p className="absolute bottom-full left-0 z-10 mb-2 w-[280px] max-w-[calc(100vw-32px)] rounded-xl border border-(--border) bg-(--sidebar) p-3 text-[12px] leading-normal wrap-anywhere text-(--muted) shadow-lg">
        {problems.length
          ? `Подробности: ${[...new Set(problems)].join(' ')}`
          : status.tone === 'success'
            ? 'Инстанс авторизован, последний запрос уведомлений выполнен успешно. Доставка каждого сообщения подтверждается отдельно.'
            : `Состояние: ${status.label}`}
      </p>
    </details>
  )
}
