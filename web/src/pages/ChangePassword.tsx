import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChangePassword } from '../api/auth';
import { ErrorText, Field } from '../components/Field';

export default function ChangePasswordPage({ forced }: { forced: boolean }) {
  const change = useChangePassword();
  const nav = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const mismatch = next !== confirm && confirm.length > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mismatch) return;
    change.mutate({ currentPassword: current, newPassword: next }, { onSuccess: () => nav('/', { replace: true }) });
  };

  return (
    <form onSubmit={submit} className="card max-w-sm mx-auto space-y-4">
      <h1 className="text-lg font-semibold">{forced ? 'Set a new password' : 'Change password'}</h1>
      {forced && <p className="text-sm text-muted-strong">You signed in with a temporary password. Choose your own to continue.</p>}
      <Field label="Current password" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
      <Field label="New password" type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} autoComplete="new-password" />
      <Field label="Confirm new password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required error={mismatch ? 'Passwords do not match' : undefined} autoComplete="new-password" />
      <ErrorText error={change.error} />
      <button className="btn-primary w-full" disabled={change.isPending || mismatch}>Save password</button>
    </form>
  );
}
