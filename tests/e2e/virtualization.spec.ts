import { expect, test } from '@playwright/test'

import { connect, Gateway, journal, openChat, stored, target } from './fixture.ts'

import type { Page } from '@playwright/test'

let gateway: Gateway

test.beforeEach(async ({ context }) => {
  gateway = new Gateway(context)
  await gateway.install()
})
test.afterEach(() => {
  expect(gateway.unexpected).toEqual([])
})

async function seed(page: Page, count: number, chatCount = 1) {
  await page.goto('/')
  await page.evaluate(
    async ({ count, chatCount, target }) => {
      const storageUrl = '/src/services/storage/workspace-storage.ts'
      const { WorkspaceStorage } = await import(storageUrl)
      const storage = await WorkspaceStorage.open(
        JSON.stringify([target.apiUrl, target.idInstance, '100']),
      )

      await storage.update(
        (workspace: {
          messages: object[]
          chats: object[]
          meta: {
            nextOrder: number
            lastSelected: string
          }
        }) => {
          workspace.messages = Array.from({ length: count }, (_, index) => ({
            id: `cached-${index}`,
            apiId: `cached-api-${index}`,
            chatId: '42',
            direction: index % 2 ? 'in' : 'out',
            text: `Запись ${index}\n${'Длинная строка с переносами. '.repeat(index % 4)}`,
            serverCreatedAt: 1700000000000 + index * 60000,
            firstSeenOrder: index + 1,
            status: 'read',
          }))
          workspace.chats = Array.from({ length: chatCount }, (_, index) => ({
            chatId: index === 0 ? '42' : String(1000 + index),
            phone: index === 0 ? '12025550101' : String(15550001000 + index),
            order: index + 1,
          }))
          workspace.meta.lastSelected = '42'
          workspace.meta.nextOrder = count + 1
        },
      )
      await storage.close()
    },
    { count, chatCount, target },
  )
}

async function firstVisible(page: Page) {
  return page.getByTestId('message-scroll').evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const bubble = [...element.querySelectorAll<HTMLElement>('[data-local-id]')].find(
      (item) =>
        item.getBoundingClientRect().bottom > rect.top + 4 &&
        item.getBoundingClientRect().top < rect.bottom,
    )

    return bubble
      ? { id: bubble.dataset.localId, top: bubble.getBoundingClientRect().top - rect.top }
      : undefined
  })
}

async function stableAnchor(page: Page) {
  let previous:
    | {
        id?: string
        top: number
        height: number
      }
    | undefined
  let stable = 0

  await expect
    .poll(
      async () => {
        const current = await page.getByTestId('message-scroll').evaluate((element) => {
          const viewport = element.getBoundingClientRect()
          const bubble = [...element.querySelectorAll<HTMLElement>('[data-local-id]')].find(
            (node) => {
              const rect = node.getBoundingClientRect()

              return rect.bottom > viewport.top + 4 && rect.top < viewport.bottom
            },
          )

          return bubble
            ? {
                id: bubble.dataset.localId,
                top: bubble.getBoundingClientRect().top - viewport.top,
                height: element.scrollHeight,
              }
            : undefined
        })

        stable =
          current &&
          previous &&
          current.id === previous.id &&
          current.height === previous.height &&
          Math.abs(current.top - previous.top) < 0.5
            ? stable + 1
            : 0
        previous = current

        return stable
      },
      { intervals: [16, 32, 64, 100] },
    )
    .toBeGreaterThanOrEqual(2)

  return previous!
}

for (const count of [500, 5000]) {
  test(`bounds mounted rows for ${count} stored messages`, async ({ page }) => {
    await seed(page, count)
    await connect(page)
    await expect.poll(async () => (await stored(page)).messages.length).toBe(count)
    const scroller = page.getByTestId('message-scroll')

    await expect(scroller.locator('[data-local-id]').last()).toContainText(`Запись ${count - 1}`)
    const geometry = await scroller.evaluate((element) => ({
      mounted: element.querySelectorAll('[data-message-key]').length,
      viewport: element.clientHeight,
      minHeight: Math.min(
        ...[...element.querySelectorAll<HTMLElement>('[data-message-key]')].map(
          (item) => item.getBoundingClientRect().height,
        ),
      ),
    }))

    expect(geometry.mounted).toBeLessThanOrEqual(
      Math.ceil(geometry.viewport / geometry.minHeight) + 18,
    )
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight / 2
    })
    await expect(scroller.locator('[data-local-id]')).not.toHaveCount(count)
    await scroller.evaluate((element) => {
      element.scrollTop = 0
    })
    await expect(scroller.locator('[data-local-id]').first()).toContainText('Запись 0')
  })
}

test('renders measured multiline bubbles without overlap', async ({ page }) => {
  await seed(page, 500)
  await connect(page)
  const geometry = await page.getByTestId('message-scroll').evaluate((element) =>
    [...element.querySelectorAll<HTMLElement>('[data-message-key]')].map((item) => ({
      top: item.getBoundingClientRect().top,
      bottom: item.getBoundingClientRect().bottom,
    })),
  )

  expect(geometry.length).toBeGreaterThan(2)
  expect(
    geometry.every((rect, index) => index === 0 || rect.top >= geometry[index - 1].bottom - 1),
  ).toBe(true)
})
test('retains the visible anchor when a new reply arrives above the bottom', async ({ page }) => {
  await seed(page, 500)
  await connect(page)
  const scroller = page.getByTestId('message-scroll')

  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight / 2
  })
  const before = await stableAnchor(page)

  gateway.enqueue(gateway.text('Новое входящее', 'new-incoming'))
  await expect(page.getByRole('button', { name: 'К последним сообщениям' })).toContainText(
    'Новые сообщения: 1',
  )
  await expect
    .poll(async () => {
      const after = await firstVisible(page)

      return after?.id === before?.id && Math.abs(after!.top - before!.top) < 2
    })
    .toBe(true)
})
test('does not move reading position for a status-only update', async ({ page }) => {
  await seed(page, 500)
  await connect(page)
  await page.getByTestId('message-scroll').evaluate((element) => {
    element.scrollTop = element.scrollHeight / 2
  })
  await expect.poll(() => firstVisible(page)).toBeDefined()
  const before = await firstVisible(page)

  gateway.enqueue(gateway.status('cached-api-200', 'read'))
  await expect
    .poll(() => gateway.calls.filter((call) => call.method === 'deleteNotification').length)
    .toBe(1)
  const after = await firstVisible(page)

  expect(after?.id).toBe(before?.id)
  expect(Math.abs(after!.top - before!.top)).toBeLessThan(2)
})
test('virtualizes 500 dialogs and mounts the last row on End', async ({ page }) => {
  await seed(page, 1, 500)
  await connect(page)
  const list = page.getByTestId('chat-scroll')

  expect(await list.getByRole('button').count()).toBeLessThan(40)
  await list.getByRole('button').first().focus()
  await page.keyboard.press('End')
  const last = page.getByRole('button', { name: 'Чат +15550001499', exact: true })

  await expect(last).toBeFocused()
  await last.press('Enter')
  await expect(page.getByRole('heading', { name: '+15550001499', exact: true })).toBeVisible()
})
test('SHOULD enter the visible chats with Tab after scrolling away from the selected chat', async ({
  page,
}) => {
  await seed(page, 1, 100)
  await connect(page)
  const list = page.getByTestId('chat-scroll')

  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect(page.getByRole('button', { name: 'Чат +15550001099', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Новый чат', exact: true }).first().focus()
  await page.keyboard.press('Tab')
  await expect.poll(() => list.locator('button:focus').count()).toBe(1)
  const before = await list.locator('button:focus').getAttribute('aria-label')

  await page.keyboard.press('ArrowDown')
  await expect.poll(() => list.locator('button:focus').getAttribute('aria-label')).not.toBe(before)
  const label = await list.locator('button:focus').getAttribute('aria-label')

  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('heading', { name: label!.replace('Чат ', ''), exact: true }),
  ).toBeVisible()
})
test('restores a runtime message anchor across chat switches', async ({ page }) => {
  await seed(page, 500, 2)
  await connect(page)
  await page.getByTestId('message-scroll').evaluate((element) => {
    element.scrollTop = element.scrollHeight / 2
  })
  await expect.poll(() => firstVisible(page)).toBeDefined()
  const before = await firstVisible(page)

  await page.getByRole('button', { name: 'Чат +15550001001', exact: true }).click()
  await page.getByRole('button', { name: 'Чат +12025550101', exact: true }).click()
  await expect
    .poll(async () => {
      const after = await firstVisible(page)

      return after?.id === before?.id && Math.abs(after!.top - before!.top) < 3
    })
    .toBe(true)
})
test('keeps the same message anchor after history loads and the viewport narrows', async ({
  page,
}) => {
  gateway.history = Array.from({ length: 100 }, (_, index) => ({
    ...journal(String(index), 1700000000 + index),
    textMessage: `Строка ${index} ${'Длинный текст для проверки переноса. '.repeat(10)}`,
  }))
  await connect(page)
  await openChat(page)
  await expect.poll(async () => (await stored(page)).messages.length).toBe(100)
  await page.getByTestId('message-scroll').evaluate((element) => {
    element.scrollTop = element.scrollHeight / 2
  })
  await expect.poll(() => firstVisible(page)).toBeDefined()
  const before = await firstVisible(page)

  await page.setViewportSize({ width: 900, height: 800 })
  await expect
    .poll(async () => {
      const after = await firstVisible(page)

      return after?.id === before?.id && Math.abs(after!.top - before!.top) < 3
    })
    .toBe(true)
})
test('reveals the actual local attempt before the undated tail', async ({ page }) => {
  gateway.history = [{ ...journal('undated'), timestamp: undefined }]
  await connect(page)
  await openChat(page)
  await expect(page.getByText('Время не получено', { exact: true }).first()).toBeVisible()
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Моя новая попытка')
  await page.getByRole('button', { name: 'Отправить сообщение' }).click()
  await expect(
    page.getByTestId('message-scroll').getByText('Моя новая попытка', { exact: true }),
  ).toBeVisible()
})
test('keeps rendered text selectable as text', async ({ page }) => {
  await seed(page, 100)
  await connect(page)
  const selected = await page
    .getByTestId('message-scroll')
    .locator('[data-ui~="message-text"]')
    .last()
    .evaluate((element) => {
      const range = document.createRange()

      range.selectNodeContents(element)
      const selection = getSelection()!

      selection.removeAllRanges()
      selection.addRange(range)

      return { selected: selection.toString(), text: element.textContent }
    })

  expect(selected.selected.trimEnd()).toBe(selected.text!.trimEnd())
})
test('SHOULD retain previous outgoing history while a new send awaits its API result', async ({
  page,
}) => {
  const now = Math.floor(Date.now() / 1000)

  gateway.history = Array.from({ length: 60 }, (_, index) => ({
    ...journal(`history-${index}`, now - 120 + index, '42', index % 2 === 1),
    textMessage: String(index),
  }))
  let release: (() => void) | undefined

  gateway.handlers.set('sendMessage', async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve
    })
    await route.fulfill({ json: { idMessage: 'growth-send' } })
  })
  await connect(page)
  await openChat(page)
  const scroller = page.getByTestId('message-scroll')

  await expect(scroller.getByText('59', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('60')
  await page.getByRole('button', { name: 'Отправить сообщение' }).click()
  await expect
    .poll(() => gateway.calls.filter((call) => call.method === 'sendMessage').length)
    .toBe(1)
  try {
    await expect(scroller.getByText('59', { exact: true })).toBeVisible()
    await expect(scroller.getByText('60', { exact: true })).toBeVisible()
  } finally {
    release?.()
  }
})
for (const width of [1072, 390]) {
  test(`SHOULD keep complete bubbles and the latest message visible as history grows at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 884 })
    gateway.notifications = false
    const now = Math.floor(Date.now() / 1000)

    gateway.history = Array.from({ length: 80 }, (_, index) => ({
      ...journal(`short-${index}`, now - 160 + index, '42', index % 2 === 1),
      textMessage: String(index),
    }))
    await connect(page)
    await openChat(page)
    const scroller = page.getByTestId('message-scroll')
    const composer = page.getByRole('textbox', { name: 'Сообщение', exact: true })

    await expect(scroller.getByText('79', { exact: true })).toBeVisible()
    const completeLayout = () =>
      scroller.evaluate((element) => {
        const viewport = element.getBoundingClientRect()
        const rows = [...element.querySelectorAll<HTMLElement>('[data-message-key]')]
        const rects = rows.map((row) => row.getBoundingClientRect())

        return {
          overlap: rects.some((rect, index) => index > 0 && rect.top < rects[index - 1].bottom - 1),
          detached: rows.some((row) => {
            const bubble = row.querySelector('article')

            if (!bubble) {
              return false
            }

            const rect = bubble.getBoundingClientRect()

            return [
              ...bubble.querySelectorAll('[data-ui~="message-text"], [data-ui~="message-meta"]'),
            ].some((child) => {
              const content = child.getBoundingClientRect()

              return content.top < rect.top - 1 || content.bottom > rect.bottom + 1
            })
          }),
          endGap: element.scrollHeight - element.scrollTop - element.clientHeight,
          lastBottom: rects.at(-1)!.bottom - viewport.bottom,
        }
      })

    for (let index = 1; index <= 5; index++) {
      await composer.fill(`New ${index}`)
      await page.getByRole('button', { name: 'Отправить сообщение' }).click()
      await expect(composer).toHaveValue('')
      await expect.poll(() => gateway.sent).toBe(index)
      gateway.enqueue(gateway.status(`server-${index}`, 'read'))
      await expect
        .poll(
          async () =>
            (await stored(page)).messages.filter(
              (item) => item.value.apiId === `server-${index}` && item.value.status === 'read',
            ).length,
        )
        .toBe(1)
      await expect
        .poll(async () => {
          const layout = await completeLayout()

          return (
            !layout.overlap &&
            !layout.detached &&
            layout.endGap <= 2 &&
            layout.lastBottom <= -10 &&
            layout.lastBottom >= -14
          )
        })
        .toBe(true)
      await expect(scroller.getByText(`New ${index}`, { exact: true })).toBeVisible()
    }

    await composer.fill('One\nTwo\nThree\nFour\nFive')
    await expect.poll(async () => (await completeLayout()).endGap).toBeLessThanOrEqual(2)
    await composer.fill('')
    await expect.poll(async () => (await completeLayout()).endGap).toBeLessThanOrEqual(2)
    await scroller.hover()
    await page.mouse.wheel(0, -500)
    await expect(page.getByRole('button', { name: 'К последним сообщениям' })).toBeVisible()
    const reading = await firstVisible(page)

    await composer.fill('One\nTwo\nThree\nFour\nFive')
    await expect
      .poll(async () => {
        const after = await firstVisible(page)

        return after?.id === reading?.id && Math.abs(after!.top - reading!.top) < 2
      })
      .toBe(true)
    await composer.fill('')
    await page.getByRole('button', { name: 'К последним сообщениям' }).click()
    await expect.poll(async () => (await completeLayout()).endGap).toBeLessThanOrEqual(2)
    await page.screenshot({ path: `.artifacts/growing-history-${width}.png` })
  })
}
