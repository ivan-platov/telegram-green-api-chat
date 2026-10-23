import { expect } from '@playwright/test'

import type { BrowserContext, Page, Route } from '@playwright/test'

export type Journal = {
  chatId: string
  idMessage: string
  textMessage: string
  type: string
  typeMessage: string
  timestamp?: number
  statusMessage?: string
}

export const target = {
  apiUrl: 'https://fixture-api.test',
  idInstance: '123',
  apiTokenInstance: 'fixture-token',
}

export const journal = (
  id: string,
  timestamp = 1700000000,
  chatId = '42',
  outgoing = false,
): Journal => ({
  chatId,
  idMessage: id,
  textMessage: `Сообщение ${id}`,
  type: outgoing ? 'outgoing' : 'incoming',
  typeMessage: 'textMessage',
  timestamp,
  ...(outgoing ? { statusMessage: 'read' } : {}),
})

export class Gateway {
  calls: {
    method: string
    body: Record<string, unknown>
    page: Page
    time: number
  }[] = []

  history: Journal[] = []
  queue: {
    receiptId: number
    body: object
  }[] = []

  state = 'authorized'
  owner = '100'
  settings: Record<string, unknown> = {
    typeInstance: 'telegram',
    wid: 'owner',
    webhookUrl: '',
    incomingWebhook: 'yes',
    outgoingWebhook: 'yes',
    outgoingAPIMessageWebhook: 'yes',
    outgoingMessageWebhook: 'yes',
    stateWebhook: 'no',
  }

  handlers = new Map<string, (route: Route) => Promise<void>>()
  sent = 0
  nextReceipt = 1
  notifications = true
  unexpected: string[] = []
  constructor(readonly context: BrowserContext) {}
  enqueue(body: object) {
    this.queue.push({ receiptId: this.nextReceipt++, body })
  }

  text(text: string, id = 'incoming', chatId = '42', type = 'incomingMessageReceived') {
    return {
      typeWebhook: type,
      instanceData: { idInstance: 123, typeInstance: 'telegram', wid: 'owner' },
      idMessage: id,
      senderData: { chatId, chatType: 'user' },
      messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: text } },
      timestamp: 1700001000,
    }
  }

  status(id: string, status: string, chatId = '42') {
    return {
      typeWebhook: 'outgoingMessageStatus',
      instanceData: { idInstance: 123, typeInstance: 'telegram', wid: 'owner' },
      chatId,
      idMessage: id,
      status,
    }
  }

  async install() {
    await this.context.route('**/*', async (route) => {
      const url = new URL(route.request().url())

      if (url.origin === 'http://127.0.0.1:5188' || url.origin === 'http://127.0.0.1:5189') {
        return route.continue()
      }

      if (!url.hostname.endsWith('.test')) {
        this.unexpected.push(url.origin)

        return route.abort()
      }

      const parts = url.pathname.split('/')
      const method = parts[2]

      this.calls.push({
        method,
        body: route.request().postDataJSON() ?? {},
        page: route.request().frame().page(),
        time: Date.now(),
      })
      const handler = this.handlers.get(method)

      if (handler) {
        return handler(route)
      }

      let response: unknown

      switch (method) {
        case 'getStateInstance':
          response = { stateInstance: this.state }
          break
        case 'getSettings':
          response = this.settings
          break
        case 'getAccountSettings':
          response = { chatId: this.owner }
          break
        case 'checkAccount':
          response = {
            status: true,
            exist: true,
            chatId: route.request().postDataJSON().phoneNumber === 12025550102 ? '43' : '42',
          }
          break
        case 'getChatHistory': {
          const body = route.request().postDataJSON()

          response = this.history
            .filter((entry) => entry.chatId === body.chatId)
            .slice(-body.count)
            .reverse()
          break
        }

        case 'receiveNotification':
          response = this.queue[0] ?? null
          break
        case 'deleteNotification':
          if (String(this.queue[0]?.receiptId) === parts[4]) {
            this.queue.shift()
          }

          response = { result: true }
          break
        case 'sendMessage': {
          const body = route.request().postDataJSON()
          const id = `server-${++this.sent}`

          this.history.push({
            ...journal(id, 1700001000, body.chatId, true),
            textMessage: body.message,
          })
          if (this.notifications) {
            this.enqueue(this.text(body.message, id, body.chatId, 'outgoingAPIMessageReceived'))
            this.enqueue(this.status(id, 'read', body.chatId))
          }

          response = { idMessage: id }
          break
        }

        case 'getMessage': {
          const body = route.request().postDataJSON()

          response = this.history.find(
            (entry) => entry.chatId === body.chatId && entry.idMessage === body.idMessage,
          )
          if (!response) {
            return route.fulfill({ status: 400, json: { message: 'Message not found by id' } })
          }

          break
        }

        default:
          this.unexpected.push(method)

          return route.abort()
      }

      await route.fulfill({ json: response })
    })
  }
}

export async function connect(page: Page, url = '/') {
  await page.goto(url)
  await page.getByLabel('Адрес API', { exact: true }).fill(target.apiUrl)
  await page.getByLabel('ID инстанса', { exact: true }).fill(target.idInstance)
  await page.getByLabel('Токен доступа', { exact: true }).fill(target.apiTokenInstance)
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Чаты', exact: true })).toBeVisible()
  await expect(
    page
      .getByText(
        /^(Получение сообщений работает|Уведомления о доставке не настроены|Доступ не сохранён в браузере)$/,
      )
      .first(),
  ).toBeVisible()
}

export async function openChat(page: Page, phone = '+1 202 555 0101') {
  await page.getByRole('button', { name: 'Новый чат', exact: true }).first().click()
  await page.getByLabel('Номер телефона', { exact: true }).fill(phone)
  await page.getByRole('button', { name: 'Начать чат', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toBeVisible()
}

export async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('green-api-chat.workspace', 1)

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(new Error('open'))
    })

    try {
      const tx = db.transaction(['messages', 'drafts', 'chats', 'meta'], 'readonly')
      const result: Record<
        string,
        {
          value: Record<string, unknown>
        }[]
      > = {}

      await Promise.all(
        ['messages', 'drafts', 'chats', 'meta'].map(
          (name) =>
            new Promise<void>((resolve, reject) => {
              const request = tx.objectStore(name).getAll()

              request.onsuccess = () => {
                result[name] = request.result
                resolve()
              }

              request.onerror = () => reject(new Error('read'))
            }),
        ),
      )

      return result
    } finally {
      db.close()
    }
  })
}
