import type { ReactNode } from 'react'

export type ConnectionState = 'disconnected' | 'connecting' | 'connected'

export function StatusRow({ state, children }: { state: ConnectionState; children: ReactNode }): JSX.Element {
  return (
    <div className="status-row">
      <span className={`status-dot ${state}`} />
      {children}
    </div>
  )
}
