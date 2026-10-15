import { useSyncExternalStore } from 'react';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error' | 'ok';
  action?: { label: string; run: () => void };
}

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string, opts: { tone?: Toast['tone']; action?: Toast['action']; ms?: number } = {}): number {
  const t: Toast = { id: ++seq, text, tone: opts.tone ?? 'info', ...(opts.action ? { action: opts.action } : {}) };
  toasts = [...toasts.slice(-3), t];
  emit();
  setTimeout(() => dismiss(t.id), opts.ms ?? (opts.action ? 8000 : 4000));
  return t.id;
}

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
  );
}
