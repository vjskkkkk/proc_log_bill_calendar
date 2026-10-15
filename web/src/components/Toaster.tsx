import { dismiss, useToasts } from '../lib/toast';

export function Toaster() {
  const toasts = useToasts();
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 flex flex-col items-center gap-2 no-print" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm shadow-lg ring-1 ${
            t.tone === 'error' ? 'bg-brand-red text-white ring-black/10' : 'bg-ink text-white ring-white/10'
          }`}
        >
          {t.tone === 'ok' && <span className="text-brand-green" aria-hidden="true">✓</span>}
          <span>{t.text}</span>
          {t.action && (
            <button
              type="button"
              className="font-semibold text-brand-yellow hover:underline"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" className="text-white/60 hover:text-white" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
