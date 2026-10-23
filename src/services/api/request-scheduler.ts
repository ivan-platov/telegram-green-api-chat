import { delay } from '../abortable-delay.ts'

import type { Target } from '../../types/workspace.ts'

type Lane = {
  tail: Promise<unknown>
  last: number
}
const lanes = new Map<string, Lane>()

export class RequestScheduler {
  private pending = new Map<
    string,
    {
      promise: Promise<unknown>
      controller: AbortController
      users: number
    }
  >()

  private clock: () => number
  private pause: typeof delay
  constructor(
    dependencies: {
      clock?: () => number
      pause?: typeof delay
    } = {},
  ) {
    this.clock = dependencies.clock ?? (() => performance.now())
    this.pause = dependencies.pause ?? delay
  }

  read({
    target,
    method,
    signal,
    body,
    execute,
    beforeStart,
  }: {
    target: Target
    method: string
    signal: AbortSignal
    body?: object
    execute: (signal: AbortSignal) => Promise<unknown>
    beforeStart?: () => Promise<void>
  }): Promise<unknown> {
    signal.throwIfAborted()
    const key = JSON.stringify([target.apiUrl, target.idInstance, method])
    const same = JSON.stringify([key, target.apiTokenInstance, body])
    let entry = this.pending.get(same)

    if (!entry) {
      const lane = lanes.get(key) ?? { tail: Promise.resolve(), last: -Infinity }

      lanes.set(key, lane)
      const controller = new AbortController()
      const promise = lane.tail
        .catch(() => {})
        .then(async () => {
          controller.signal.throwIfAborted()
          const remaining = 1100 - (this.clock() - lane.last)

          if (remaining > 0) {
            await this.pause(remaining, controller.signal)
          }

          controller.signal.throwIfAborted()
          if (beforeStart) {
            await beforeStart()
          }

          controller.signal.throwIfAborted()
          lane.last = this.clock()

          return execute(controller.signal)
        })

      entry = { promise, controller, users: 0 }
      const captured = entry

      lane.tail = promise.catch(() => {})
      this.pending.set(same, entry)
      void promise
        .finally(() => {
          if (this.pending.get(same) === captured) {
            this.pending.delete(same)
          }
        })
        .catch(() => {})
    }

    const captured = entry

    captured.users++

    return new Promise((resolve, reject) => {
      let done = false
      const finish = (error: boolean, value: unknown) => {
        if (done) {
          return
        }

        done = true
        signal.removeEventListener('abort', abort)
        captured.users--
        if (!captured.users) {
          captured.controller.abort()
          if (this.pending.get(same) === captured) {
            this.pending.delete(same)
          }
        }

        if (error) {
          reject(value)
        } else {
          resolve(value)
        }
      }

      const abort = () => finish(true, signal.reason)

      signal.addEventListener('abort', abort, { once: true })
      captured.promise.then(
        (value) => finish(false, value),
        (error) => finish(true, error),
      )
    })
  }
}
