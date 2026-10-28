import { useEffect, useRef } from 'react'
import type { InstalledProduct } from '@shared/types'

interface ConfirmDialogProps {
  product: InstalledProduct
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmDialog({
  product,
  busy,
  onCancel,
  onConfirm
}: ConfirmDialogProps): JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onCancel])

  return (
    <div className="modal-scrim" role="presentation" onClick={() => !busy && onCancel()}>
      <div
        className="confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="confirm-icon">
          <span>!</span>
        </div>
        <h2 id="confirm-title">Uninstall {product.name}?</h2>
        <p>
          This deletes the installed files from your library. Your GitHub releases and repository are
          not affected.
        </p>
        <code className="confirm-path">{product.installPath}</code>
        <div className="confirm-actions">
          <button className="btn" onClick={onCancel} disabled={busy} ref={cancelRef}>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Uninstalling…' : 'Uninstall'}
          </button>
        </div>
      </div>
    </div>
  )
}
