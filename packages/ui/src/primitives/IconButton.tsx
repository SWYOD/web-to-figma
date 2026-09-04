import { forwardRef, type ButtonHTMLAttributes } from 'react'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  size?: 'default' | 'xs'
  variant?: 'default' | 'danger'
}

// forwardRef — нужен вызывающим, которым требуются реальные экранные
// координаты кнопки (напр. AddToProjectButton.tsx считает anchor для
// generic popover overlay через getBoundingClientRect()).
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { active, size = 'default', variant = 'default', className, ...rest },
  ref
) {
  const classes = ['icon-btn', active && 'active', size === 'xs' && 'xs', variant === 'danger' && 'danger', className]
    .filter(Boolean)
    .join(' ')
  return <button ref={ref} type="button" className={classes} {...rest} />
})
