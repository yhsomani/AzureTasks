import React from 'react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

export function Toast({
  toasts,
  onDismiss,
}: {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      id="viewStatus"
      className="toast-container fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-md w-full pointer-events-none"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast pointer-events-auto p-4 rounded-lg border shadow-lg flex items-center justify-between text-sm transition-all ${
            t.type === 'error'
              ? 'bg-rose-950/90 border-rose-800 text-rose-200'
              : t.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-800 text-emerald-200'
              : 'bg-surface border-border text-text'
          }`}
        >
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="font-bold">
              {t.type === 'error' ? '✕' : t.type === 'success' ? '✓' : 'ℹ'}
            </span>
            <span>{t.message}</span>
          </div>
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss notification"
            className="text-text-muted hover:text-text ml-4 p-1 rounded min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
