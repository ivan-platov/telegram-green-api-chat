import { useChatSession } from './hooks/useChatSession.ts'
import { ConnectionView } from './views/ConnectionView.tsx'
import { WorkspaceView } from './views/WorkspaceView.tsx'

export function App() {
  const { session, snapshot } = useChatSession()
  const connecting = snapshot.screen === 'connection' || snapshot.screen === 'restoring'

  return (
    <div data-ui="app" className="h-dvh">
      {connecting ? (
        <ConnectionView session={session} snapshot={snapshot} />
      ) : (
        <WorkspaceView session={session} snapshot={snapshot} />
      )}
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        key={snapshot.incomingId}
      >
        {snapshot.liveText}
      </div>
    </div>
  )
}
