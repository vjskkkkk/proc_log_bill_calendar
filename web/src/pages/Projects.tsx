import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { PROJECT_STATUSES, PROJECT_STATUS_LABEL, type ProjectDto, type ProjectStatus } from '@shared/schemas/plan';
import { formatShort } from '@shared/schedule/dates';
import { childrenIndex, effectiveSpan, isOverdue, ownSpan, union } from '@shared/schedule/spans';
import { canEdit, type UserPublic } from '@shared/types';
import { useDeleteProject, usePatchProject, usePlan } from '../api/plan';
import { ErrorText, Field, SelectField } from '../components/Field';
import { NewProjectDialog } from '../components/projects/NewProjectDialog';
import { ImportQuoteDialog } from '../components/projects/QuoteImport';
import { BOQ_URL, CRM_URL } from '../components/Shell';
import { Modal, Seg } from '../components/ui';
import { useTodayIST } from './Today';

type View = 'open' | 'completed' | 'archived' | 'all';
const VIEW_STATUSES: Record<View, ProjectStatus[]> = {
  open: ['active', 'on_hold'],
  completed: ['completed'],
  archived: ['archived'],
  all: [...PROJECT_STATUSES],
};

const STATUS_CHIP: Record<ProjectStatus, string> = {
  active: 'bg-brand-green/20 text-ok',
  on_hold: 'bg-brand-yellow/30 text-warn-fg',
  completed: 'bg-brand-purple/15 text-brand-purple',
  archived: 'bg-surface-3 text-muted-strong',
};

function EditProjectDialog({ project, onClose }: { project: ProjectDto; onClose: () => void }) {
  const patch = usePatchProject();
  const [f, setF] = useState({ name: project.name, client: project.client, location: project.location, notes: project.notes, status: project.status });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    patch.mutate({ id: project.id, patch: f }, { onSuccess: onClose });
  };
  return (
    <Modal
      title="Edit project"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="edit-project" className="btn-primary" disabled={patch.isPending}>
            Save
          </button>
        </>
      }
    >
      <form id="edit-project" onSubmit={submit} className="space-y-3">
        <Field label="Project name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={200} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Client" value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} maxLength={200} />
          <Field label="Site / location" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} maxLength={200} />
        </div>
        <SelectField label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as ProjectStatus })}>
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PROJECT_STATUS_LABEL[s]}
            </option>
          ))}
        </SelectField>
        <label className="block">
          <span className="label">Notes</span>
          <textarea className="input min-h-24" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={5000} />
        </label>
        {project.boqQuoteNo && <p className="text-xs text-muted">Started from BOQ quote {project.boqQuoteNo}.</p>}
        <ErrorText error={patch.error} />
      </form>
    </Modal>
  );
}

export default function ProjectsPage({ user }: { user: UserPublic }) {
  const plan = usePlan('all');
  const patch = usePatchProject();
  const del = useDeleteProject();
  const today = useTodayIST();
  const [view, setView] = useState<View>('open');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ProjectDto | null>(null);
  const [importing, setImporting] = useState<ProjectDto | null>(null);
  const editable = canEdit(user.role);

  const stats = useMemo(() => {
    const out = new Map<string, { span: ReturnType<typeof union>; tasks: number; done: number; overdue: number }>();
    if (!plan.data) return out;
    const kids = childrenIndex(plan.data.tasks);
    for (const p of plan.data.projects) out.set(p.id, { span: null, tasks: 0, done: 0, overdue: 0 });
    for (const t of kids.get(null) ?? []) {
      const s = out.get(t.projectId);
      if (!s) continue;
      const children = kids.get(t.id) ?? [];
      s.span = union([s.span, ownSpan(t), ...children.map(ownSpan)]);
      const leaves = children.length ? children.map((c) => ({ t: c, span: effectiveSpan(c, t) })) : [{ t, span: ownSpan(t) }];
      for (const l of leaves) {
        s.tasks++;
        if (l.t.done) s.done++;
        if (isOverdue(l.span, l.t.done, today)) s.overdue++;
      }
    }
    return out;
  }, [plan.data, today]);

  const rows = (plan.data?.projects ?? [])
    .filter((p) => VIEW_STATUSES[view].includes(p.status))
    .filter((p) => !q || `${p.name} ${p.client} ${p.location} ${p.boqQuoteNo}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <Seg
          label="Show"
          value={view}
          onChange={setView}
          options={[
            { value: 'open', label: 'Active & on hold' },
            { value: 'completed', label: 'Completed' },
            { value: 'archived', label: 'Archived' },
            { value: 'all', label: 'All' },
          ]}
        />
        <input className="input min-h-9 w-64 py-1" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        {editable && (
          <button type="button" className="btn-primary ml-auto" onClick={() => setCreating(true)}>
            + New project
          </button>
        )}
      </div>
      <p className="-mt-2 text-sm text-muted">Only active projects feed the Today list; on-hold ones stay on the planner. Completed and archived projects are kept here.</p>

      {plan.isLoading && <p className="text-muted">Loading…</p>}
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-surface-3 text-left col-head">
            <tr>
              <th className="p-3">Project</th>
              <th className="p-3">Client</th>
              <th className="p-3">Site</th>
              <th className="p-3">Linked to</th>
              <th className="p-3">Status</th>
              <th className="p-3">Dates</th>
              <th className="p-3 text-right">Done</th>
              <th className="p-3 text-right">Overdue</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const s = stats.get(p.id);
              return (
                <tr key={p.id} className="border-t border-line hover:bg-surface-2">
                  <td className="p-3 font-medium">
                    <Link to={`/planner?focus=project:${p.id}`} className="hover:text-brand-purple hover:underline">
                      {p.name}
                    </Link>
                  </td>
                  <td className="p-3">{p.client || <span className="text-muted">—</span>}</td>
                  <td className="p-3">{p.location || <span className="text-muted">—</span>}</td>
                  <td className="p-3 space-x-1.5 whitespace-nowrap">
                    {p.boqQuoteId && (
                      <a className="chip bg-brand-purple/10 text-brand-purple hover:underline" href={`${BOQ_URL}/quotes/${p.boqQuoteId}`} target="_blank" rel="noopener" title="Open in BOQ Maker">
                        {p.boqQuoteNo || 'BOQ'} ↗
                      </a>
                    )}
                    {p.crmLeadId && (
                      <a className="chip bg-surface-3 text-muted-strong hover:underline" href={CRM_URL} target="_blank" rel="noopener" title="Linked to a CRM lead">
                        CRM ↗
                      </a>
                    )}
                    {!p.boqQuoteId && !p.crmLeadId && <span className="text-muted">—</span>}
                  </td>
                  <td className="p-3">
                    {editable ? (
                      <select
                        className={`border-0 px-2 py-0.5 text-xs font-medium ${STATUS_CHIP[p.status]}`}
                        value={p.status}
                        onChange={(e) => patch.mutate({ id: p.id, patch: { status: e.target.value as ProjectStatus } })}
                        aria-label="Status"
                      >
                        {PROJECT_STATUSES.map((st) => (
                          <option key={st} value={st}>
                            {PROJECT_STATUS_LABEL[st]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className={`chip ${STATUS_CHIP[p.status]}`}>{PROJECT_STATUS_LABEL[p.status]}</span>
                    )}
                  </td>
                  <td className="p-3 whitespace-nowrap tabular-nums">{s?.span ? `${formatShort(s.span.start)} – ${formatShort(s.span.end)}` : <span className="text-muted">Not planned</span>}</td>
                  <td className="p-3 text-right tabular-nums">{s ? `${s.done}/${s.tasks}` : ''}</td>
                  <td className={`p-3 text-right tabular-nums ${s?.overdue ? 'font-semibold text-brand-red' : 'text-muted'}`}>{s?.overdue || '—'}</td>
                  <td className="p-3 whitespace-nowrap text-right space-x-2">
                    {editable && (
                      <>
                        <button
                          type="button"
                          className="text-sm text-brand-purple hover:underline"
                          onClick={() => setImporting(p)}
                          title={p.boqQuoteNo ? `Add tasks from quote ${p.boqQuoteNo}` : 'Add tasks from a BOQ quote'}
                        >
                          ⇣ From quote
                        </button>
                        <button type="button" className="btn-secondary min-h-8 py-0.5" onClick={() => setEditing(p)}>
                          Edit
                        </button>
                      </>
                    )}
                    {user.role === 'admin' && (
                      <button
                        type="button"
                        className="text-sm text-brand-red hover:underline"
                        onClick={() => {
                          if (window.confirm(`Delete "${p.name}" and all ${s?.tasks ?? 0} of its tasks? This cannot be undone. (Archiving keeps them.)`)) del.mutate(p.id);
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {plan.data && !rows.length && (
              <tr>
                <td colSpan={9} className="p-8 text-center text-muted">
                  {q ? 'No projects match.' : view === 'open' ? 'No active projects yet. Start one from an issued BOQ quote or a CRM lead.' : 'None.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
      {editing && <EditProjectDialog project={editing} onClose={() => setEditing(null)} />}
      {importing && <ImportQuoteDialog project={importing} onClose={() => setImporting(null)} />}
    </div>
  );
}
