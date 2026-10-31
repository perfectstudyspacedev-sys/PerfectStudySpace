import { useId, useRef } from 'react'
import useDialogFocus from '../hooks/useDialogFocus'

// In-app popup used instead of the browser's own confirm/alert boxes, so questions and notices
// look like the rest of the website. Without onCancel it is a notice with a single button.
export default function ConfirmDialog({
  title, children, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false, busy = false,
  onConfirm, onCancel, testId,
}) {
  const close = onCancel ?? onConfirm
  const dialog = useRef(null)
  const titleId = useId()
  useDialogFocus(dialog, { onClose: close, busy })
  return (
    <div className="modal-overlay" onClick={busy ? undefined : close}>
      <div
        ref={dialog} tabIndex={-1} className="modal" style={{ maxWidth: 420 }} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy}
        data-testid={testId} onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>{title}</h2>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: '0.75rem 0 1.25rem', lineHeight: 1.5 }}>{children}</div>
        <div className="modal-actions">
          {onCancel && <button type="button" className="btn btn-ghost" data-initial-focus={danger || undefined} onClick={onCancel} disabled={busy}>{cancelLabel}</button>}
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} data-initial-focus={!danger || !onCancel || undefined} onClick={onConfirm} disabled={busy}>
            {busy ? 'Please wait…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
