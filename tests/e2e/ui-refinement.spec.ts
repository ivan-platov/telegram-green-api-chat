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
test('SHOULD reject a malformed number before HTTP and clear the error after correction', async ({
  page,
}) => {
  await connect(page)
  await page.getByRole('button', { name: 'Новый чат', exact: true }).first().click()
  const input = page.getByLabel('Номер телефона')

  await input.fill('123')
  await page.getByRole('button', { name: 'Начать чат', exact: true }).click()
  await expect(input).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByRole('alert')).toContainText('Проверьте номер')
  expect(gateway.calls.filter((call) => call.method === 'checkAccount')).toHaveLength(0)
  await input.fill('+7 999 123 4567')
  await expect(input).toHaveAttribute('aria-invalid', 'false')
})
test('SHOULD normalize 8 to 7 in API, saved registry and chat title', async ({ page }) => {
  await connect(page)
  await openChat(page, '8 (999) 123-45-67')
  await expect(page.getByRole('heading', { name: '+79991234567', exact: true })).toBeVisible()
  expect(gateway.calls.find((call) => call.method === 'checkAccount')?.body).toEqual({
    phoneNumber: 79991234567,
  })
  expect((await stored(page)).chats[0].value.phone).toBe('79991234567')
  await page.reload()
  await expect(page.getByRole('heading', { name: '+79991234567', exact: true })).toBeVisible()
})
test('SHOULD keep the plus icon centered inside its hover target', async ({ page }) => {
  await connect(page)
  const button = page.getByRole('button', { name: 'Новый чат', exact: true }).first()

  await button.hover()
  const outer = await button.boundingBox()
  const inner = await button.locator('[aria-hidden="true"]').boundingBox()

  expect(Math.abs(outer!.x + outer!.width / 2 - inner!.x - inner!.width / 2)).toBeLessThan(1)
  expect(Math.abs(outer!.y + outer!.height / 2 - inner!.y - inner!.height / 2)).toBeLessThan(1)
})
test('SHOULD repair a legacy 8 label without changing chat identity, draft or messages', async ({
  page,
}) => {
  gateway.history = [journal('keep')]
  await connect(page)
  await openChat(page, '+7 999 123 4567')
  const editor = page.getByRole('textbox', { name: 'Сообщение', exact: true })

  await editor.fill('Сохранённый черновик')
  await expect(page.getByText('Сохраняем черновик…')).toHaveCount(0)
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('green-api-chat.workspace', 1)

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('chats', 'readwrite')
        const store = tx.objectStore('chats')
        const request = store.getAll()

        request.onsuccess = () => {
          for (const entry of request.result) {
            entry.value.phone = '89991234567'
            store.put(entry)
          }
        }

        tx.oncomplete = () => resolve()
        tx.onabort = tx.onerror = () => reject(tx.error)
      })
    } finally {
      db.close()
    }
  })
  await page.reload()
  await expect(page.getByRole('heading', { name: '+79991234567', exact: true })).toBeVisible()
  await expect(editor).toHaveValue('Сохранённый черновик')
  const data = await stored(page)

  expect(data.chats[0].value).toMatchObject({ chatId: '42', phone: '79991234567' })
  expect(data.messages).toHaveLength(1)
})
test('SHOULD focus text fields without a detached outline or geometry shift', async ({ page }) => {
  await connect(page)
  await page.getByRole('button', { name: 'Новый чат', exact: true }).first().click()
  const phone = page.getByLabel('Номер телефона')

  await expect(phone).toBeFocused()
  expect(await phone.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none')
  await phone.fill('+1 202 555 0101')
  await phone.press('Enter')
  const editor = page.getByRole('textbox', { name: 'Сообщение', exact: true })

  await editor.blur()
  const before = await editor.boundingBox()

  await editor.focus()
  expect(await editor.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none')
  expect(await editor.boundingBox()).toEqual(before)
  const button = await page.getByRole('button', { name: 'Отправить сообщение' }).boundingBox()

  expect(Math.abs(before!.y + before!.height / 2 - button!.y - button!.height / 2)).toBeLessThan(1)
  await editor.fill('Первая строка\nВторая строка\nТретья строка')
  expect((await editor.boundingBox())!.height).toBeGreaterThan(before!.height)
  await editor.fill('Короткая')
  expect((await editor.boundingBox())!.height).toBe(before!.height)
})
test('SHOULD prefetch earlier messages before reaching the top and preserve the visible message', async ({
  page,
}) => {
  gateway.history = Array.from({ length: 250 }, (_, i) => journal(String(i), 1700000000 + i))
  await connect(page)
  await openChat(page)
  await expect.poll(async () => (await stored(page)).messages.length).toBe(100)
  const scroll = page.getByTestId('message-scroll')

  await scroll.evaluate((el) => {
    el.scrollTop = 450
  })
  await expect
    .poll(() =>
      scroll.evaluate((el) => {
        const rect = el.getBoundingClientRect()

        return [...el.querySelectorAll<HTMLElement>('[data-local-id]')].some(
          (item) =>
            item.getBoundingClientRect().bottom > rect.top + 20 &&
            item.getBoundingClientRect().top < rect.bottom,
        )
      }),
    )
    .toBe(true)
  const before = await scroll.evaluate((el) => {
    const top = el.getBoundingClientRect().top
    const message = [...el.querySelectorAll<HTMLElement>('[data-local-id]')].find(
      (item) =>
        item.getBoundingClientRect().bottom > top + 20 &&
        item.getBoundingClientRect().top < el.getBoundingClientRect().bottom,
    )

    return { id: message?.dataset.localId, y: message!.getBoundingClientRect().top - top }
  })

  await expect.poll(async () => (await stored(page)).messages.length).toBe(200)
  await expect
    .poll(() =>
      scroll.evaluate((el, before) => {
        const message = [...el.querySelectorAll<HTMLElement>('[data-local-id]')].find(
          (item) => item.dataset.localId === before.id,
        )

        return message
          ? Math.abs(
              message.getBoundingClientRect().top - el.getBoundingClientRect().top - before.y,
            )
          : 9999
      }, before),
    )
    .toBeLessThan(3)
  await scroll.evaluate((el) => {
    el.scrollTop = 0
  })
  await expect.poll(async () => (await stored(page)).messages.length).toBe(250)
  await scroll.evaluate((el) => {
    el.scrollTop = 0
  })
  await expect(scroll.getByText('Сообщение 0', { exact: true })).toBeVisible()
  expect(
    gateway.calls.filter((call) => call.method === 'getChatHistory').map((call) => call.body.count),
  ).toEqual([100, 200, 300])
  await expect(page.getByRole('button', { name: 'Загрузить более ранние' })).toHaveCount(0)
  await expect(page.getByText('Сервис больше записей сейчас не вернул')).toHaveCount(0)
})
test('SHOULD retry a failed automatic history load without losing cached messages', async ({
  page,
}) => {
  gateway.history = Array.from({ length: 150 }, (_, i) => journal(String(i), 1700000000 + i))
  await connect(page)
  await openChat(page)
  await expect.poll(async () => (await stored(page)).messages.length).toBe(100)
  gateway.handlers.set('getChatHistory', (route) => route.fulfill({ status: 500, json: {} }))
  await page.getByTestId('message-scroll').evaluate((el) => {
    el.scrollTop = 0
  })
  await expect(page.getByText('Не удалось загрузить историю.', { exact: true })).toBeVisible()
  expect((await stored(page)).messages).toHaveLength(100)
  gateway.handlers.delete('getChatHistory')
  await page.getByRole('button', { name: 'Повторить', exact: true }).click()
  await expect.poll(async () => (await stored(page)).messages.length).toBe(150)
})
