import type { HistoryState } from '../types/session.ts'

export function HistoryFeedback({
  history,
  enabled,
  onRetry,
}: {
  history?: HistoryState
  enabled: boolean
  onRetry: () => void
}) {
  if (!history?.loading && !history?.error) {
    return null
  }

  return (
    <div
      data-ui="history-feedback"
      className="absolute [top:80px] [left:50%] z-2 flex max-w-[calc(100%_-_32px)] [transform:translateX(-50%)] items-center gap-2 rounded-[12px] bg-(--sidebar) px-3 py-1.5 text-[12px] text-(--muted) [box-shadow:0_2px_12px_#0003]"
      role="status"
    >
      {history.loading ? (
        <span
          data-ui="history-loading"
          className="flex items-center gap-2 whitespace-nowrap [&_.spinner]:h-3.5 [&_.spinner]:w-3.5"
        >
          <span className="spinner" />
          Загружаем сообщения…
        </span>
      ) : (
        <>
          <span>Не удалось загрузить историю.</span>
          <button type="button" className="text-button" disabled={!enabled} onClick={onRetry}>
            Повторить
          </button>
          <details>
            <summary>Подробнее</summary>
            <p>{history.error}</p>
          </details>
        </>
      )}
    </div>
  )
}
