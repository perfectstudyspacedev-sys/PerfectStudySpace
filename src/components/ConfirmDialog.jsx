// In-app popup used instead of the browser's own confirm/alert boxes, so questions and notices
// look like the rest of the website. Without onCancel it is a notice with a single button.
export default function ConfirmDialog({
  title, children, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false, busy = false,
  onConfirm, onCancel, testId,
}) {
  const close = onCancel ?? onConfirm
  return (
    <div className="modal-overlay" onClick={busy ? undefined : close}>
      <div
        className="modal" style={{ maxWidth: 420 }} role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title"
        data-testid={testId} onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape' && !busy) close() }}
      >
        <h2 id="confirm-dialog-title">{title}</h2>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: '0.75rem 0 1.25rem', lineHeight: 1.5 }}>{children}</div>
        <div className="modal-actions">
          {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>{cancelLabel}</button>}
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy} autoFocus>
            {busy ? 'Please wait…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
