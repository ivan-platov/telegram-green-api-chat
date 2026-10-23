import type { Target } from '../../types/workspace.ts'

export function supportsQueueLock() {
  return window.isSecureContext && !!navigator.locks?.request
}

export async function ownQueue(target: Target, signal: AbortSignal, work: () => Promise<void>) {
  if (!supportsQueueLock()) {
    throw new Error(
      'Браузер не поддерживает безопасное владение очередью (Web Locks). Обмен выключен.',
    )
  }

  await navigator.locks.request(
    JSON.stringify(['green-api-chat', target.apiUrl, target.idInstance]),
    { mode: 'exclusive', signal },
    work,
  )
}
