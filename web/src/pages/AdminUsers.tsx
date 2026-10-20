import { useState, type FormEvent } from 'react';
import { useCreateUser, useResetPassword, useUpdateUser, useUsers } from '../api/users';
import { ErrorText, Field, SelectField } from '../components/Field';
import { ROLES, type Role } from '@shared/types';

export default function AdminUsersPage() {
  const users = useUsers();
  const create = useCreateUser();
  const update = useUpdateUser();
  const reset = useResetPassword();
  const [form, setForm] = useState({ name: '', email: '', role: 'editor' as Role, temporaryPassword: '' });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(form, { onSuccess: () => setForm({ name: '', email: '', role: 'editor', temporaryPassword: '' }) });
  };

  const doReset = (id: string) => {
    const pw = window.prompt('Temporary password for this user (min 8 characters):');
    if (pw) reset.mutate({ id, temporaryPassword: pw });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="text-sm text-muted">
          New users sign in with the temporary password and must choose their own. <b>admin</b>: everything ·{' '}
          <b>editor</b>: projects, plans, Task Lists · <b>viewer</b>: read-only.
        </p>
      </div>
      <form onSubmit={submit} className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end">
        <Field label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <Field label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <SelectField label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </SelectField>
        <Field label="Temporary password" value={form.temporaryPassword} onChange={(e) => setForm({ ...form, temporaryPassword: e.target.value })} required minLength={8} />
        <button className="btn-primary" disabled={create.isPending}>Add user</button>
        <div className="sm:col-span-2 lg:col-span-5"><ErrorText error={create.error ?? update.error ?? reset.error} /></div>
      </form>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-surface-3 text-left">
            <tr><th className="p-3">Name</th><th className="p-3">Email</th><th className="p-3">Role</th><th className="p-3">Status</th><th className="p-3"></th></tr>
          </thead>
          <tbody>
            {users.data?.map((u) => (
              <tr key={u.id} className="border-t border-line">
                <td className="p-3 font-medium">{u.name}</td>
                <td className="p-3">{u.email}</td>
                <td className="p-3">
                  <select className="input py-1 min-h-9" value={u.role} onChange={(e) => update.mutate({ id: u.id, role: e.target.value as Role })}>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td className="p-3">{u.active ? (u.mustChangePassword ? 'Temp password' : 'Active') : 'Deactivated'}</td>
                <td className="p-3 whitespace-nowrap space-x-2">
                  <button className="btn-secondary min-h-9 py-1" onClick={() => doReset(u.id)}>Reset password</button>
                  <button className="btn-secondary min-h-9 py-1" onClick={() => update.mutate({ id: u.id, active: !u.active })}>
                    {u.active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.isLoading && <p className="p-3 text-muted">Loading…</p>}
      </div>
    </div>
  );
}
