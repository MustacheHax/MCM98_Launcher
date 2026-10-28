import type { ToastKind } from '../state'
import { Icon } from './Icons'

interface ToastProps {
  state: {
    id: number
    kind: ToastKind
    message: string
  }
}

export function Toast({ state }: ToastProps): JSX.Element {
  const icon = state.kind === 'success' ? 'check' : state.kind === 'error' ? 'alert' : 'spark'
  return (
    <div className={`toast toast-${state.kind}`} role="status" aria-live="polite">
      <span className="toast-icon">
        <Icon name={icon} size={17} />
      </span>
      <span>{state.message}</span>
    </div>
  )
}
