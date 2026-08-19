interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
}

/** Портировано 1:1 из components/Switch.tsx (Skill-tree) — см. docs/design-system.md §4. */
export function Switch({ checked, onChange }: SwitchProps): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`switch${checked ? ' on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-thumb" />
    </button>
  )
}
