import { useState, type FormEvent } from 'react';
import { useLogin, useSetup } from '../api/auth';
import { ErrorText, Field } from '../components/Field';

export default function LoginPage({ mode }: { mode: 'login' | 'setup' }) {
  const login = useLogin();
  const setup = useSetup();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const busy = login.isPending || setup.isPending;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'setup') setup.mutate({ email, name, password });
    else login.mutate({ email, password });
  };

  return (
    <div className="min-h-screen flex flex-col">
      <div className="bg-ink py-8 flex justify-center">
        <img src="/brand/logo_white.svg" alt="Koochie Sports" className="h-12" />
      </div>
      <div className="flex-1 flex items-start justify-center px-4 py-8">
        <form onSubmit={submit} className="card w-full max-w-sm space-y-4">
          <div>
            <h1 className="text-lg font-semibold">{mode === 'setup' ? 'Create the first admin' : 'Sign in'}</h1>
            <p className="text-sm text-muted">
              {mode === 'setup' ? 'No users exist yet. This account becomes the administrator.' : 'Procurement · Logistics · Billing planner'}
            </p>
          </div>
          {mode === 'setup' && <Field label="Your name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />}
          <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" inputMode="email" />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === 'setup' ? 8 : 1}
            autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
          />
          <ErrorText error={login.error ?? setup.error} />
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'setup' ? 'Create admin' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
