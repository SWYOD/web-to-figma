import { useEffect, useState, type ReactNode } from 'react'
import type { ReferenceSessionState } from '../../../shared/types'
import { AttachToProjectRow } from './AttachToProjectRow'
import { ReferenceItemsPanel } from './ReferenceItemsPanel'

/**
 * Содержимое плавающей правой панели "Референсов" ('panel-references-right'
 * слой, см. main/index.ts rightPanelGate/activeTopView) — по прямому
 * требованию пользователя ("критично, делай float"), тот же
 * ReferenceItemsPanel, что и push-режим в ReferencesView.tsx, только здесь,
 * в ОТДЕЛЬНОМ overlay-рендерере. ReferenceItemsPanel/AttachToProjectRow оба
 * самодостаточны (читают/пишут через window.api сами, не через пропы) —
 * единственное, что нужно синхронизировать между процессами — ТЕКУЩИЙ
 * session (какой сайт сейчас собираем), тот уже и так живёт в main
 * (referenceSession) и рассылается сюда тем же broadcastReferenceSession,
 * что и главному окну (см. window.api.onReferenceSessionState); начальное
 * значение при монтировании — referenceGetSessionState (тот же паттерн, что
 * referenceGetBrowserVisible у BrowserTopBarOverlayContent.tsx).
 *
 * Панель видна ТОЛЬКО пока сессия сбора активна (см. ReferencesView.tsx
 * `collecting`) — если session ещё не пришёл (или сессию успели завершить,
 * пока пользователь наводил курсор на правый край), рисовать нечего.
 */
export function ReferencesRightPanelOverlayContent({ pinAction }: { pinAction: ReactNode }): JSX.Element | null {
  const [session, setSession] = useState<ReferenceSessionState | null>(null)

  useEffect(() => {
    window.api.referenceGetSessionState().then(setSession)
    return window.api.onReferenceSessionState(setSession)
  }, [])

  if (!session) return null

  return (
    <>
      <ReferenceItemsPanel session={session} pinAction={pinAction} />
      {!session.projectId && <AttachToProjectRow url={session.siteUrl} />}
    </>
  )
}
