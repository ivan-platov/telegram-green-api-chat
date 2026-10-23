import readIcon from '../assets/icons/check-check.svg'
import deliveredIcon from '../assets/icons/check.svg'
import failedIcon from '../assets/icons/circle-alert.svg'
import unknownIcon from '../assets/icons/circle-question-mark.svg'
import clockIcon from '../assets/icons/clock.svg'
import { DeliveryService } from '../services/messages/delivery.service.ts'
import { MessageService } from '../services/messages/message.service.ts'

import type { Message } from '../types/message.ts'

const statusIcons = {
  pending: clockIcon,
  delivered: deliveredIcon,
  read: readIcon,
  failed: failedIcon,
  unknown: unknownIcon,
}

export function MessageMeta({
  message,
  zone,
  onCheck,
  checking,
  checkBlockReason,
}: {
  message: Message
  zone: string
  onCheck: (id: string) => void
  checking: boolean
  checkBlockReason: string
}) {
  const time = MessageService.getTime(message)
  const status = message.status ?? 'unknown'
  const label = DeliveryService.getMessageLabel(message)
  const summary = message.direction === 'out' ? label : 'Время сообщения'
  const metadata = (
    <>
      {time !== undefined ? (
        <time
          dateTime={new Date(time).toISOString()}
          title={
            message.timeConflict
              ? 'GREEN-API вернул разные значения времени; показано первое полученное серверное время.'
              : message.serverCreatedAt !== undefined
                ? 'Время сообщения по данным GREEN-API.'
                : message.localCreatedAt !== undefined
                  ? 'Локальное время отправки на этом устройстве.'
                  : 'Время из сохранённого сообщения.'
          }
        >
          {new Intl.DateTimeFormat('ru-RU', {
            timeZone: zone,
            hour: '2-digit',
            minute: '2-digit',
          }).format(time)}
        </time>
      ) : (
        <span>Время не получено</span>
      )}
      {message.direction === 'out' && (
        <>
          <span
            data-ui="delivery-icon"
            className="icon h-4 w-4"
            style={{ maskImage: `url("${statusIcons[status]}")` }}
            aria-hidden="true"
          />
          {status === 'failed' && <span>Не отправлено</span>}
        </>
      )}
    </>
  )
  const className =
    'mt-0 text-right text-[10px] leading-4 text-[#ffffffb3] data-[status=failed]:text-(--error-text) data-[status=read]:text-[#8cceff] data-[status=unknown]:text-[#ffdf9b]'
  const problematic = message.direction === 'out' && (status === 'failed' || status === 'unknown')

  if (!problematic) {
    return (
      <div
        data-status={message.direction === 'out' ? status : 'incoming'}
        data-ui="message-meta message-meta-static"
        className={`${className} flex items-center justify-end gap-1.5`}
        aria-label={summary}
      >
        {metadata}
      </div>
    )
  }

  return (
    <details
      data-status={message.direction === 'out' ? status : 'incoming'}
      data-ui="message-meta"
      className={className}
      onToggle={(event) => {
        if (!event.currentTarget.open) {
          const active = document.activeElement

          if (
            active &&
            event.currentTarget.contains(active) &&
            active !== event.currentTarget.firstElementChild
          ) {
            ;(event.currentTarget.firstElementChild as HTMLElement)?.focus()
          }
        }
      }}
    >
      <summary
        className="relative z-1 -mt-6 ml-auto flex min-h-11 w-max max-w-full min-w-11 list-none items-center justify-end gap-1.5 pt-5 [&::-webkit-details-marker]:hidden"
        aria-label={summary}
      >
        {metadata}
      </summary>
      <div data-ui="message-details" className="pt-2 text-left text-[12px] leading-normal">
        <p>{message.direction === 'out' ? label : 'Входящее сообщение'}</p>
        <p>
          {message.error ||
            (status === 'unknown'
              ? 'Подтверждения доставки нет. Это не означает, что сообщение не дошло. Проверьте переписку перед повторной отправкой.'
              : 'Запрос отправки завершился ошибкой.')}
        </p>
        {message.verificationError && <p role="alert">{message.verificationError}</p>}
        {status === 'unknown' && message.apiId && (
          <button
            type="button"
            disabled={checking || !!checkBlockReason}
            title={checkBlockReason || 'Получить текущий статус сообщения без повторной отправки.'}
            onClick={() => onCheck(message.id)}
            className="mt-2 min-h-11 rounded-[8px] border border-(--border) bg-(--input) px-3 py-2 text-white"
          >
            {checking ? 'Проверяем статус…' : 'Проверить статус'}
          </button>
        )}
      </div>
    </details>
  )
}
