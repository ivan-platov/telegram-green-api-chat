import { expect, test } from '@playwright/test'

import { connect, Gateway, journal, openChat, stored } from './fixture.ts'

let gateway: Gateway

test.beforeEach(async ({ context }) => {
  gateway = new Gateway(context)
  await gateway.install()
})
test.afterEach(() => {
  expect(gateway.unexpected).toEqual([])
})
test('does not send if the local attempt cannot be committed', async ({ page }) => {
  await connect(page)
  await openChat(page)
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Текст останется')
  await expect(page.getByText('Сохраняем черновик…')).toHaveCount(0)
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put

    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (this.name === 'messages') {
        this.transaction.abort()
        throw new Error('fixture-abort')
      }

      return original.apply(this, args)
    }
  })
  await page.getByRole('button', { name: 'Отправить сообщение' }).click()
  await expect(
    page
      .getByText('Не удалось сохранить данные. Обмен приостановлен; текст остаётся в этом окне.', {
        exact: true,
      })
      .first(),
  ).toBeVisible()
  expect(gateway.calls.filter((call) => call.method === 'sendMessage')).toHaveLength(0)
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue(
    'Текст останется',
  )
})
test('keeps the current draft if saving fails during navigation', async ({ page }) => {
  await connect(page)
  await openChat(page)
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put

    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (this.name === 'drafts') {
        this.transaction.abort()
        throw new Error('fixture-draft-abort')
      }

      return original.apply(this, args)
    }
  })
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Не терять')
  await page.getByRole('button', { name: 'Новый чат', exact: true }).first().click()
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue(
    'Не терять',
  )
  await expect(page.getByLabel('Номер телефона')).toHaveCount(0)
})
test('does not resend when persisting the successful API result fails', async ({ page }) => {
  gateway.notifications = false
  await connect(page)
  await openChat(page)
  gateway.handlers.set('sendMessage', async (route) => {
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.put

      IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
        if (this.name === 'messages') {
          this.transaction.abort()
          throw new Error('fixture-bind-abort')
        }

        return original.apply(this, args)
      }
    })
    await route.fulfill({ json: { idMessage: 'accepted-but-unpersisted' } })
  })
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Одна попытка')
  await page.getByRole('button', { name: 'Отправить сообщение' }).click()
  await expect(
    page
      .getByText('Не удалось сохранить данные. Обмен приостановлен; текст остаётся в этом окне.', {
        exact: true,
      })
      .first(),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Отправить сообщение' })).toBeDisabled()
  expect(gateway.calls.filter((call) => call.method === 'sendMessage')).toHaveLength(1)
})
test('recovers a known API result after storage is repaired without resending', async ({
  page,
}) => {
  gateway.notifications = false
  await connect(page)
  await openChat(page)
  gateway.handlers.set('sendMessage', async (route) => {
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.put

      ;(
        window as unknown as {
          restorePut: () => void
        }
      ).restorePut = () => {
        IDBObjectStore.prototype.put = original
      }

      IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
        if (this.name === 'messages') {
          this.transaction.abort()
          throw new Error('fixture-bind-abort')
        }

        return original.apply(this, args)
      }
    })
    await route.fulfill({ json: { idMessage: 'recoverable-id' } })
  })
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Известный результат')
  await page.getByRole('button', { name: 'Отправить сообщение' }).click()
  await expect(page.getByLabel('Доставка не подтверждена', { exact: true })).toBeVisible()
  await page.evaluate(() =>
    (
      window as unknown as {
        restorePut: () => void
      }
    ).restorePut(),
  )
  await page.getByRole('button', { name: 'Проверить подключение', exact: true }).click()
  await expect
    .poll(async () => (await stored(page)).messages[0]?.value.apiId)
    .toBe('recoverable-id')
  expect(gateway.calls.filter((call) => call.method === 'sendMessage')).toHaveLength(1)
  expect((await stored(page)).messages).toHaveLength(1)
})
test('merges early echo and read with a later HTTP response', async ({ page }) => {
  let release: (() => void) | undefined

  gateway.handlers.set('sendMessage', async (route) => {
    gateway.enqueue(gateway.text('Ранний echo', 'race-id', '42', 'outgoingAPIMessageReceived'))
    gateway.enqueue(gateway.status('race-id', 'read'))
    await new Promise<void>((resolve) => {
      release = resolve
    })
    await route.fulfill({ json: { idMessage: 'race-id' } })
  })
  await connect(page)
  await openChat(page)
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Ранний echo')
  await page.getByRole('button', { name: 'Отправить сообщение' }).click()
  await expect
    .poll(() => gateway.calls.filter((call) => call.method === 'deleteNotification').length)
    .toBe(2)
  release?.()
  await expect(page.getByLabel('Прочитано', { exact: true })).toBeVisible()
  await expect(
    page.getByTestId('message-scroll').getByText('Ранний echo', { exact: true }),
  ).toHaveCount(1)
  expect((await stored(page)).messages).toHaveLength(1)
})
test('does not switch chats when an old send completes in the background', async ({ page }) => {
  let release: (() => void) | undefined

  gateway.handlers.set('sendMessage', async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve
    })
    await route.fulfill({ json: { idMessage: 'send-a' } })
  })
  await connect(page)
  await openChat(page)
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Для A')
  await page.getByRole('button', { name: 'Отправить сообщение' }).click()
  await expect
    .poll(() => gateway.calls.filter((call) => call.method === 'sendMessage').length)
    .toBe(1)
  await openChat(page, '12025550102')
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Черновик B')
  release?.()
  await expect(page.getByRole('heading', { name: '+12025550102', exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue(
    'Черновик B',
  )
})
test('preserves a reply that arrives before an older history response', async ({ page }) => {
  let release: (() => void) | undefined

  gateway.handlers.set('getChatHistory', async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve
    })
    await route.fulfill({ json: [journal('old')] })
  })
  await connect(page)
  await openChat(page)
  gateway.enqueue(gateway.text('Новый ответ', 'newer'))
  await expect
    .poll(() => gateway.calls.filter((call) => call.method === 'deleteNotification').length)
    .toBe(1)
  release?.()
  await expect.poll(async () => (await stored(page)).messages.length).toBe(2)
})
test('ignores history from a chat that is no longer selected', async ({ page }) => {
  let release: (() => void) | undefined

  gateway.handlers.set('getChatHistory', async (route) => {
    const chatId = route.request().postDataJSON().chatId

    if (chatId === '42') {
      await new Promise<void>((resolve) => {
        release = resolve
      })
    }

    await route.fulfill({ json: [journal('late', 1700000000, chatId)] }).catch(() => {})
  })
  await connect(page)
  await openChat(page)
  await openChat(page, '12025550102')
  release?.()
  await expect(page.getByRole('heading', { name: '+12025550102', exact: true })).toBeVisible()
  await expect(
    page.getByTestId('message-scroll').getByText('Сообщение late', { exact: true }),
  ).toBeVisible()
  expect((await stored(page)).messages.every((item) => item.value.chatId === '43')).toBe(true)
})
test('reports a failed deletion instead of claiming access was forgotten', async ({ page }) => {
  await connect(page)
  await page.evaluate(() => {
    Storage.prototype.removeItem = () => {
      throw new Error('Удаление недоступно')
    }
  })
  await page.getByRole('button', { name: 'Отключиться', exact: true }).click()
  await expect(
    page.getByText('Не удалось удалить сохранённый доступ.', { exact: true }).first(),
  ).toBeVisible()
  expect(await page.evaluate(() => !!localStorage.getItem('green-api-chat.connection.v2'))).toBe(
    true,
  )
  await expect(page.getByText('Данные не сохраняются', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Подключение остановлено', { exact: true })).toBeVisible()
})
test('warns when credentials could not be saved', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error('quota')
    }
  })
  await connect(page)
  await expect(
    page
      .getByText(
        'Доступ не сохранён в браузере. После перезагрузки потребуется ввести его снова.',
        { exact: true },
      )
      .first(),
  ).toBeVisible()
})
test('uses raw history count even when most records are media', async ({ page }) => {
  gateway.history = Array.from({ length: 150 }, (_, index) => ({
    ...journal(String(index)),
    typeMessage: index === 149 ? 'textMessage' : 'imageMessage',
  }))
  await connect(page)
  await openChat(page)
  await expect
    .poll(() =>
      gateway.calls
        .filter((call) => call.method === 'getChatHistory')
        .map((call) => call.body?.count),
    )
    .toEqual([100, 200])
  expect((await stored(page)).messages).toHaveLength(1)
  expect((await stored(page)).messages).toHaveLength(1)
  await expect(page.getByRole('button', { name: 'Загрузить более ранние' })).toHaveCount(0)
})
