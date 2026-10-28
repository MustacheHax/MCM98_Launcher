import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icons'

interface EmptyStateProps {
  icon: IconName
  title: string
  description: string
  action?: ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps): JSX.Element {
  return (
    <div className="empty-state">
      <div className="empty-visual" aria-hidden="true">
        <span className="empty-ring ring-one" />
        <span className="empty-ring ring-two" />
        <span className="empty-icon">
          <Icon name={icon} size={26} />
        </span>
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action && <div className="empty-action">{action}</div>}
    </div>
  )
}
