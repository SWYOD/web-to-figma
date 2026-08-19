import type { ButtonHTMLAttributes } from 'react'

interface ToolbarButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  primary?: boolean
  iconOnly?: boolean
}

export function ToolbarButton({ primary, iconOnly, className, ...rest }: ToolbarButtonProps): JSX.Element {
  const classes = ['tb-btn', primary && 'primary', iconOnly && 'icon-only', className].filter(Boolean).join(' ')
  return <button type="button" className={classes} {...rest} />
}
