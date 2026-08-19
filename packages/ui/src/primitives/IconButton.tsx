import type { ButtonHTMLAttributes } from 'react'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  size?: 'default' | 'xs'
  variant?: 'default' | 'danger'
}

export function IconButton({ active, size = 'default', variant = 'default', className, ...rest }: IconButtonProps): JSX.Element {
  const classes = ['icon-btn', active && 'active', size === 'xs' && 'xs', variant === 'danger' && 'danger', className]
    .filter(Boolean)
    .join(' ')
  return <button type="button" className={classes} {...rest} />
}
