import assert from 'node:assert/strict'
import test from 'node:test'

import { RequestScheduler } from '../src/services/api/request-scheduler.ts'

const target = (name) => ({
  apiUrl: `https://${name}.test`,
  idInstance: '1',
  apiTokenInstance: 'fake',
})

test('SHOULD combine simultaneous reads IF operation and body match', async () => {
  let calls = 0
  let release
  const scheduler = new RequestScheduler()
  const execute = async () => {
    calls++

    return new Promise((resolve) => {
      release = resolve
    })
  }

  const options = {
    target: target('dedup'),
    method: 'getSettings',
    signal: new AbortController().signal,
    execute,
  }
  const one = scheduler.read(options)
  const two = scheduler.read(options)

  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  release({ ready: true })
  assert.deepEqual(await Promise.all([one, two]), [{ ready: true }, { ready: true }])
  assert.equal(calls, 1)
})
test('SHOULD space reads IF different message IDs share an instance method', async () => {
  let now = 10000
  const starts = []
  const scheduler = new RequestScheduler({
    clock: () => now,
    pause: async (milliseconds) => {
      now += milliseconds
    },
  })

  await Promise.all(
    ['a', 'b', 'c'].map((idMessage) =>
      scheduler.read({
        target: target('spacing'),
        method: 'getMessage',
        signal: new AbortController().signal,
        body: { idMessage },
        execute: async () => {
          starts.push(now)

          return null
        },
      }),
    ),
  )
  assert.deepEqual(starts, [10000, 11100, 12200])
})
test('SHOULD cancel only one subscriber IF another still needs the same read', async () => {
  let release
  const scheduler = new RequestScheduler()
  const execute = async () =>
    new Promise((resolve) => {
      release = resolve
    })
  const controller = new AbortController()
  const options = { target: target('cancel-one'), method: 'getSettings', execute }
  const first = scheduler.read({ ...options, signal: controller.signal })
  const rejected = assert.rejects(first)
  const second = scheduler.read({ ...options, signal: new AbortController().signal })

  controller.abort()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  release('ok')
  await rejected
  assert.equal(await second, 'ok')
})
test('SHOULD NOT issue a request IF the only subscriber cancels before start', async () => {
  let calls = 0
  const scheduler = new RequestScheduler()
  const controller = new AbortController()
  const pending = scheduler.read({
    target: target('cancel-all'),
    method: 'getSettings',
    signal: controller.signal,
    execute: async () => {
      calls++

      return null
    },
  })
  const rejected = assert.rejects(pending)

  controller.abort()
  await rejected
  await Promise.resolve()
  assert.equal(calls, 0)
})
