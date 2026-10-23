import assert from 'node:assert/strict'
import test from 'node:test'

import { ApiError } from '../src/services/api/api-error.ts'
import { GreenApiService } from '../src/services/api/green-api.service.ts'

const credentials = {
  apiUrl: 'https://example.test',
  idInstance: '123',
  apiTokenInstance: 'test-token',
}

test('SHOULD preserve spaces and line breaks when sending text', async (t) => {
  let submitted

  t.mock.method(globalThis, 'fetch', async (request) => {
    submitted = await request.json()

    return Response.json({ idMessage: 'sent1' })
  })
  await new GreenApiService(credentials).sendText(
    '456',
    '  Привет\n🙂  ',
    new AbortController().signal,
  )
  assert.equal(submitted.message, '  Привет\n🙂  ')
})
test('SHOULD NOT send a whitespace-only message', async (t) => {
  const network = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected network call')
  })

  await assert.rejects(
    new GreenApiService(credentials).sendText('456', ' \n ', new AbortController().signal),
    /4096/,
  )
  assert.equal(network.mock.callCount(), 0)
})
test('SHOULD NOT send a message longer than the API limit', async (t) => {
  const network = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected network call')
  })

  await assert.rejects(
    new GreenApiService(credentials).sendText(
      '456',
      'a'.repeat(4097),
      new AbortController().signal,
    ),
    /4096/,
  )
  assert.equal(network.mock.callCount(), 0)
})
test('SHOULD report an unknown outcome without retry after a network failure', async (t) => {
  const network = t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('network')
  })

  await assert.rejects(
    new GreenApiService(credentials).sendText('456', 'Привет', new AbortController().signal),
    (error) => error instanceof ApiError && error.uncertain,
  )
  assert.equal(network.mock.callCount(), 1)
})
test('SHOULD NOT report success if a successful HTTP response omits message ID', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ status: false }))
  await assert.rejects(
    new GreenApiService(credentials).sendText('456', 'Привет', new AbortController().signal),
    (error) => error.uncertain === true,
  )
})
test('SHOULD report an unknown send outcome if the gateway reports a closed connection', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 499 }))
  await assert.rejects(
    new GreenApiService(credentials).sendText('456', 'Привет', new AbortController().signal),
    (error) => error.uncertain === true,
  )
})
test('SHOULD mention privacy when a phone cannot be resolved', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ exist: false, chatId: '' }))
  await assert.rejects(
    new GreenApiService(credentials).resolvePhone('79991234567', new AbortController().signal),
    /приватности/,
  )
})
test('SHOULD reject a business error returned with HTTP 200 during phone lookup', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ status: false, data: { reason: 'rate_limit_exceeded' } }),
  )
  await assert.rejects(
    new GreenApiService(credentials).resolvePhone('79991234567', new AbortController().signal),
    /ограничения/,
  )
})
test('SHOULD accept an empty HTTP response as an empty queue', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(''))
  assert.equal(
    await new GreenApiService(credentials).receiveNotification(new AbortController().signal),
    null,
  )
})

test('SHOULD keep transport configuration isolated between connections', async (t) => {
  const requests = []

  t.mock.method(globalThis, 'fetch', async (request) => {
    requests.push(request)

    return Response.json({ stateInstance: 'authorized' })
  })
  const other = {
    apiUrl: 'https://other.test/',
    idInstance: '456',
    apiTokenInstance: 'other-token',
  }

  await new GreenApiService(credentials).getStateInstance({ signal: new AbortController().signal })
  await new GreenApiService(other).getStateInstance({ signal: new AbortController().signal })

  assert.deepEqual(
    requests.map((request) => request.url),
    [
      'https://example.test/waInstance123/getStateInstance/test-token',
      'https://other.test/waInstance456/getStateInstance/other-token',
    ],
  )
  assert.ok(requests.every((request) => request.credentials === 'omit'))
  assert.ok(requests.every((request) => request.referrerPolicy === 'no-referrer'))
})

test('SHOULD use the documented queue query and DELETE acknowledgement', async (t) => {
  const requests = []

  t.mock.method(globalThis, 'fetch', async (request) => {
    requests.push(request)

    return Response.json(request.method === 'DELETE' ? { result: true } : null)
  })
  const api = new GreenApiService(credentials)
  const signal = new AbortController().signal

  await api.receiveNotification(signal)
  await api.deleteNotification(12, signal)

  assert.equal(requests[0].method, 'GET')
  assert.equal(new URL(requests[0].url).searchParams.get('receiveTimeout'), '5')
  assert.equal(requests[1].method, 'DELETE')
  assert.equal(new URL(requests[1].url).pathname, '/waInstance123/deleteNotification/test-token/12')
})

for (const status of [429, 469, 500]) {
  test(`SHOULD classify HTTP ${status} without exposing credentials or retrying the send`, async (t) => {
    const network = t.mock.method(globalThis, 'fetch', async () =>
      Response.json({ message: credentials.apiTokenInstance }, { status }),
    )

    await assert.rejects(
      new GreenApiService(credentials).sendText('456', 'Привет', new AbortController().signal),
      (error) => {
        assert.ok(error instanceof ApiError)
        assert.equal(error.httpStatus, status)
        assert.equal(error.retryable, status === 429)
        assert.equal(error.uncertain, status === 500)
        assert.equal('config' in error, false)
        assert.equal('request' in error, false)
        assert.equal('response' in error, false)
        assert.equal(JSON.stringify(error).includes(credentials.apiTokenInstance), false)
        assert.equal(error.message.includes(credentials.apiTokenInstance), false)

        return true
      },
    )
    assert.equal(network.mock.callCount(), 1)
  })
}

test('SHOULD retain the authentication error if the gateway returns HTML instead of JSON', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('<html>denied</html>', { status: 401 }),
  )

  await assert.rejects(
    new GreenApiService(credentials).receiveNotification(new AbortController().signal),
    (error) => error instanceof ApiError && error.httpStatus === 401 && !error.retryable,
  )
})

test('SHOULD stop on malformed queue JSON instead of treating it as an empty queue', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{broken'))

  await assert.rejects(
    new GreenApiService(credentials).receiveNotification(new AbortController().signal),
    (error) => error instanceof ApiError && !error.retryable && /JSON/.test(error.message),
  )
})

test('SHOULD preserve an uncertain outcome if a successful send returns malformed JSON', async (t) => {
  const network = t.mock.method(globalThis, 'fetch', async () => new Response('{broken'))

  await assert.rejects(
    new GreenApiService(credentials).sendText('456', 'Привет', new AbortController().signal),
    (error) => error instanceof ApiError && error.uncertain && !error.retryable,
  )
  assert.equal(network.mock.callCount(), 1)
})

test('SHOULD NOT start a request if its session has already been cancelled', async (t) => {
  const network = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('Unexpected request')
  })
  const controller = new AbortController()
  const reason = new DOMException('Session stopped', 'AbortError')

  controller.abort(reason)

  await assert.rejects(
    new GreenApiService(credentials).receiveNotification(controller.signal),
    (error) => error === reason,
  )
  assert.equal(network.mock.callCount(), 0)
})

test('SHOULD cancel an active poll with the original session reason', async (t) => {
  let started
  const ready = new Promise((resolve) => {
    started = resolve
  })

  t.mock.method(
    globalThis,
    'fetch',
    (request) =>
      new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(request.signal.reason), {
          once: true,
        })
        started()
      }),
  )
  const controller = new AbortController()
  const reason = new DOMException('Session stopped', 'AbortError')
  const request = new GreenApiService(credentials).receiveNotification(controller.signal)
  const rejected = assert.rejects(request, (error) => error === reason)

  await ready
  controller.abort(reason)
  await rejected
})
