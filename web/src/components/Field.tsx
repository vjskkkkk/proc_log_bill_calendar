import type { InputHTMLAttributes, SelectHTMLAttributes } from 'react';

export function Field({ label, error, ...props }: { label: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input" {...props} />
      {error && <span className="text-xs text-brand-red">{error}</span>}
    </label>
  );
}

export function SelectField({ label, children, ...props }: { label: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <select className="input" {...props}>{children}</select>
    </label>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return <p className="text-sm text-brand-red">{msg}</p>;
}
