import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { ChatSession } from '../services/session/chat-session.ts'

export function useChatSession() {
  const [session] = useState(() => new ChatSession())
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const cleanup = useRef<number | undefined>(undefined)

  useEffect(() => {
    window.clearTimeout(cleanup.current)
    const timer = window.setTimeout(() => session.restore(), 0)

    window.addEventListener('storage', session.onStorage)

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('storage', session.onStorage)
      cleanup.current = window.setTimeout(() => {
        void session.stop()
      }, 0)
    }
  }, [session])

  return { session, snapshot }
}
