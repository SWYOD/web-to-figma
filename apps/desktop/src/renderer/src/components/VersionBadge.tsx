import { useEffect, useState } from 'react'

/** Пилюля с версией приложения (из package.json) — с отдельной акцентной
 *  меткой пререлиза (всё после первого «-», напр. «beta.10»), если она
 *  есть. Тот же паттерн и место (toolbar, рядом с брендом), что в
 *  Skill-tree (см. docs/architecture.md). */
export function VersionBadge(): JSX.Element | null {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    window.api.getAppVersion().then((v) => {
      if (alive) setVersion(v)
    })
    return () => {
      alive = false
    }
  }, [])

  if (!version) return null
  const dashIdx = version.indexOf('-')
  const base = dashIdx === -1 ? version : version.slice(0, dashIdx)
  const tag = dashIdx === -1 ? null : version.slice(dashIdx + 1)

  return (
    <span className="version-badge" title={`Web To Figma v${version}`}>
      <span className="version-badge-base">v{base}</span>
      {tag && <span className="version-badge-tag">{tag}</span>}
    </span>
  )
}
