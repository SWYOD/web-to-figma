import { useEffect, useState } from 'react'
import { Cable, Check, Copy } from 'lucide-react'
import { IconButton, Popover, StatusRow } from '@web-to-figma/ui'
import type { BridgeInfo } from '../../../shared/types'

export function BridgePopover(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<BridgeInfo | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    window.api.getBridgeInfo().then(setInfo)
    return window.api.onBridgeStatus((status) => {
      setInfo((prev) => (prev ? { ...prev, connectionCount: status.connectionCount } : prev))
    })
  }, [])

  const connected = (info?.connectionCount ?? 0) > 0

  const copyToken = async (): Promise<void> => {
    if (!info) return
    await navigator.clipboard.writeText(info.pairingToken)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      anchor={
        <IconButton active={connected} onClick={() => setOpen((v) => !v)} title="Figma bridge">
          <Cable size={16} />
        </IconButton>
      }
    >
      <div className="popover-section">
        <div className="popover-label">Figma bridge</div>
        <StatusRow state={connected ? 'connected' : 'disconnected'}>
          {connected ? `Подключено (${info?.connectionCount})` : 'Плагин Figma не подключён'}
        </StatusRow>
      </div>
      <div className="popover-sep" />
      <div className="popover-section">
        <div className="popover-label">Код подключения</div>
        <div className="bridge-code">
          <span className="bridge-code-value">{info?.pairingToken ?? '…'}</span>
          <IconButton size="xs" onClick={copyToken} title="Скопировать">
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </IconButton>
        </div>
        <div className="bridge-hint">
          Вставьте этот код один раз в UI Figma Plugin (Web Importer) при первом запуске —
          он сохранится и переиспользуется автоматически.
        </div>
      </div>
    </Popover>
  )
}
