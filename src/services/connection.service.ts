import type { SessionSnapshot } from '../types/session.ts'
import type { UiStatus } from '../types/ui-status.ts'

const instanceDescriptions: Record<string, string> = {
  authorized: 'Инстанс авторизован',
  unknown: 'Не удалось проверить подключение',
  starting: 'Инстанс запускается',
  notAuthorized: 'Авторизуйте Telegram в кабинете GREEN-API',
  pendingPassword: 'Завершите двухфакторную авторизацию в кабинете',
  pendingCode: 'Завершите авторизацию в кабинете',
  blocked: 'GREEN-API сообщает о блокировке инстанса',
  suspended: 'На Telegram-аккаунте временные ограничения отправки',
}

export class ConnectionService {
  static getInstanceLabel(state: string): string {
    return instanceDescriptions[state] ?? 'GREEN-API вернул неизвестное состояние инстанса'
  }

  static getStatus(s: SessionSnapshot): UiStatus {
    if (s.storageError) {
      return { label: 'Данные не сохраняются', tone: 'error' }
    }

    if (s.role === 'waiting') {
      return { label: 'Ожидаем доступ к чату', tone: 'progress' }
    }

    if (s.phase === 'error') {
      return { label: 'Подключение остановлено', tone: 'error' }
    }

    if (s.phase === 'connecting') {
      return { label: 'Проверяем подключение…', tone: 'progress' }
    }

    if (s.connectionError) {
      return { label: 'Не удалось проверить подключение', tone: 'error' }
    }

    if (s.error) {
      return { label: 'Ошибка подключения', tone: 'error' }
    }

    if (s.instance !== 'authorized') {
      return { label: this.getInstanceLabel(s.instance), tone: 'warning' }
    }

    if (!s.incomingReady) {
      return { label: 'Получение сообщений не настроено', tone: 'warning' }
    }

    if (s.receive === 'retrying') {
      return { label: 'Повторяем запрос уведомлений…', tone: 'progress' }
    }

    if (s.receive === 'stopped') {
      return { label: 'Получение сообщений остановлено', tone: 'error' }
    }

    if (s.receiveError) {
      return { label: 'Не удалось получить уведомления', tone: 'error' }
    }

    if (s.receive === 'starting') {
      return { label: 'Подключаем получение…', tone: 'progress' }
    }

    if (s.receive !== 'active' || s.phase !== 'ready' || s.role !== 'owner') {
      return { label: 'Обмен сообщениями не запущен', tone: 'warning' }
    }

    if (s.checkingConnection) {
      return { label: 'Проверяем подключение…', tone: 'progress' }
    }

    if (!s.statusesReady) {
      return { label: 'Уведомления о доставке не настроены', tone: 'warning' }
    }

    if (s.storageWarning) {
      return { label: 'Доступ не сохранён в браузере', tone: 'warning' }
    }

    return { label: 'Получение сообщений работает', tone: 'success' }
  }

  static getSendBlockReason(s: SessionSnapshot): string {
    if (s.storageError) {
      return 'Отправка приостановлена: не удаётся сохранить данные в браузере.'
    }

    if (s.role === 'waiting') {
      return 'Ожидаем доступ к очереди сообщений. Отправка в этой вкладке пока недоступна.'
    }

    if (s.phase !== 'ready') {
      return 'Отправка недоступна до завершения подключения.'
    }

    if (s.role !== 'owner') {
      return 'Обмен сообщениями в этой вкладке не запущен.'
    }

    if (s.connectionError) {
      return 'Отправка приостановлена: не удалось проверить подключение.'
    }

    if (s.instance !== 'authorized') {
      return `${this.getInstanceLabel(s.instance)}. Отправка недоступна.`
    }

    if (!s.incomingReady) {
      return 'Настройте получение сообщений перед отправкой.'
    }

    if (s.receive === 'retrying') {
      return 'Отправка приостановлена: повторяем запрос уведомлений.'
    }

    if (s.receive !== 'active' || s.receiveError) {
      return 'Отправка приостановлена до восстановления получения сообщений.'
    }

    if (s.navigating) {
      return 'Сохраняем данные перед переключением чата…'
    }

    if (s.sending) {
      return 'Дождитесь завершения предыдущей отправки.'
    }

    return ''
  }

  static getLookupBlockReason(s: SessionSnapshot): string {
    if (s.role === 'waiting') {
      return 'Ожидаем доступ к очереди сообщений. Создание чата пока недоступно.'
    }

    if (s.phase !== 'ready') {
      return 'Создание чата недоступно до завершения подключения.'
    }

    if (s.role !== 'owner') {
      return 'Обмен сообщениями в этой вкладке не запущен.'
    }

    if (s.storageError) {
      return 'Сначала восстановите сохранение данных в браузере.'
    }

    if (s.connectionError || s.instance !== 'authorized') {
      return 'Сначала проверьте подключение Telegram.'
    }

    if (s.navigating) {
      return 'Дождитесь переключения чата.'
    }

    return ''
  }

  static getStatusCheckBlockReason(s: SessionSnapshot): string {
    return this.getSendBlockReason({ ...s, sending: false, navigating: false })
  }

  static normalizeOrigin(value: string) {
    let url: URL

    try {
      url = new URL(value.trim())
    } catch {
      throw new Error('Укажите абсолютный HTTPS-адрес API из кабинета GREEN-API.')
    }

    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    ) {
      throw new Error('Нужен HTTPS-адрес API без пути, логина и параметров.')
    }

    return url.origin
  }

  static getProblems(s: SessionSnapshot) {
    return [
      s.role === 'waiting'
        ? 'Ожидаем доступ к очереди сообщений. Обмен в этой вкладке ещё не запущен.'
        : '',
      s.error,
      s.storageError,
      s.connectionError ? `Проверка подключения: ${s.connectionError}` : '',
      s.receiveError ? `Получение уведомлений: ${s.receiveError}` : '',
      s.phase === 'ready' && s.instance !== 'authorized' ? this.getInstanceLabel(s.instance) : '',
      s.phase === 'ready' && !s.incomingReady ? 'Получение через HTTP-очередь не настроено' : '',
      s.receive === 'retrying'
        ? 'Не удалось получить уведомления. Запрос будет повторён автоматически.'
        : '',
      s.receive === 'stopped' ? 'Получение сообщений остановлено' : '',
      s.phase === 'ready' && !s.statusesReady ? 'Уведомления о доставке не настроены' : '',
      s.storageWarning,
    ].filter(Boolean)
  }
}
