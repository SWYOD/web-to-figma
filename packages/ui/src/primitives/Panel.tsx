import type { HTMLAttributes, ReactNode } from 'react'

export function Panel({ className, ...rest }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div className={['panel', className].filter(Boolean).join(' ')} {...rest} />
}

export function PanelHead({ children }: { children: ReactNode }): JSX.Element {
  return <div className="panel-head">{children}</div>
}

export function PanelTitle({ children }: { children: ReactNode }): JSX.Element {
  return <div className="panel-title">{children}</div>
}

export function PanelHeadActions({ children }: { children: ReactNode }): JSX.Element {
  return <div className="panel-head-actions">{children}</div>
}

export function Block({ children }: { children: ReactNode }): JSX.Element {
  return <div className="block">{children}</div>
}

export function BlockHead({ children }: { children: ReactNode }): JSX.Element {
  return <div className="block-head">{children}</div>
}
