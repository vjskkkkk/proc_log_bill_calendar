import { useEffect, useMemo, useState } from 'react';
import { CATEGORIES, CATEGORY_LABEL } from '@shared/categories';
import type { PlanDto, TaskDto } from '@shared/schemas/plan';
import { formatMedium, istDateOf } from '@shared/schedule/dates';
import { describeQuantities } from '@shared/schedule/rules';
import { workingDays } from '@shared/schedule/workdays';
import { useCommittedInput } from '../../lib/autosave';
import type { usePeople } from '../../lib/people';
import { CategoryDot, Seg } from '../ui';
import { depLabel, depOptions } from './GanttRow';

interface Props {
  task: TaskDto;
  plan: PlanDto;
  editable: boolean;
  people: ReturnType<typeof usePeople>;
  onPatch: (patch: Partial<TaskDto>) => void;
  onDelete: () => void;
  onOpen: (id: string) => void;
  onAddSubtask: () => void;
  onClose: () => void;
}

/** Everything about one task/sub-task, on the right of the planner: fields, notes (autosaved), history, delete. */
export function TaskDrawer({ task, plan, editable, people, onPatch, onDelete, onOpen, onAddSubtask, onClose }: Props) {
  const parent = task.parentId ? plan.tasks.find((t) => t.id === task.parentId) ?? null : null;
  const children = plan.tasks.filter((t) => t.parentId === task.id).sort((a, b) => a.sortOrder - b.sortOrder);
  const project = plan.projects.find((p) => p.id === task.projectId);
  const title = useCommittedInput(task.title, (v) => v.trim() && v.trim() !== task.title && onPatch({ title: v.trim(), catalogItemId: null }), 0);
  const notes = useCommittedInput(task.notes, (v) => onPatch({ notes: v }), 800);
  const [choosing, setChoosing] = useState(false);
  const options = useMemo(() => (choosing || task.dependsOnId ? depOptions(plan.tasks, task) : []), [choosing, task, plan.tasks]);
  const dependent = !!task.dependsOnId || choosing;
  const qty = describeQuantities(task.quantities);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const n = task.startDate && task.endDate ? workingDays(task.startDate, task.endDate) : null;
  return (
    <aside className="absolute inset-y-0 right-0 z-40 flex w-[400px] flex-col border-l border-line-strong bg-surface shadow-2xl" aria-label="Task details">
      <div className="flex items-start gap-2 border-b border-line p-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs text-muted">
            {project?.name}
            {parent && (
              <>
                {' › '}
                <button type="button" className="hover:text-brand-purple hover:underline" onClick={() => onOpen(parent.id)}>
                  {parent.title}
                </button>
              </>
            )}
          </div>
          <input
            className="mt-1 w-full rounded-md bg-transparent px-1 py-0.5 text-lg font-semibold outline-none focus:ring-2 focus:ring-brand-purple/40 disabled:cursor-default"
            value={title.value}
            disabled={!editable}
            onChange={(e) => title.onChange(e.target.value)}
            onBlur={title.flush}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            aria-label="Title"
          />
        </div>
        <button type="button" className="text-muted hover:text-fg" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">Start</span>
            <input
              type="date"
              className="input min-h-9 py-1"
              value={task.startDate ?? ''}
              disabled={!editable || !!task.dependsOnId}
              title={task.dependsOnId ? 'Set by what it waits for' : undefined}
              onChange={(e) => onPatch({ startDate: e.target.value || null })}
            />
          </label>
          <label className="block">
            <span className="label">End {n ? <span className="text-muted">· {n} working d</span> : null}</span>
            <input type="date" className="input min-h-9 py-1" value={task.endDate ?? ''} disabled={!editable} onChange={(e) => onPatch({ endDate: e.target.value || null })} />
          </label>
          <label className="block">
            <span className="label">Category</span>
            <select className="input min-h-9 py-1" value={task.category} disabled={!editable || !!parent} onChange={(e) => onPatch({ category: e.target.value as TaskDto['category'] })}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Owner</span>
            <select className="input min-h-9 py-1" value={task.assigneeId ?? ''} disabled={!editable} onChange={(e) => onPatch({ assigneeId: e.target.value || null })}>
              <option value="">{parent?.assigneeId ? `${people.name(parent.assigneeId)} (task owner)` : 'Unassigned'}</option>
              {people.owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!task.startDate && parent?.startDate && <p className="text-xs text-muted">No dates of its own: it follows the task's dates ({formatMedium(parent.startDate)} – {formatMedium(parent.endDate!)}).</p>}
        <div>
          <span className="label">Waits for</span>
          <div className="flex flex-wrap items-center gap-2">
            {editable ? (
              <Seg
                label="Independent or dependent"
                value={dependent ? 'dep' : 'ind'}
                onChange={(v) => {
                  if (v === 'ind') {
                    setChoosing(false);
                    if (task.dependsOnId) onPatch({ dependsOnId: null });
                  } else setChoosing(true);
                }}
                options={[
                  { value: 'ind', label: 'Independent' },
                  { value: 'dep', label: 'Dependent' },
                ]}
              />
            ) : (
              <span>{task.dependsOnId ? 'Dependent' : 'Independent'}</span>
            )}
            {dependent && editable && (
              <select
                className="input min-h-9 flex-1 py-1"
                value={task.dependsOnId ?? ''}
                autoFocus={choosing && !task.dependsOnId}
                onChange={(e) => {
                  if (!e.target.value) return;
                  setChoosing(false);
                  onPatch({ dependsOnId: e.target.value });
                }}
                aria-label="The task or sub-task it waits for"
              >
                {!task.dependsOnId && <option value="">Choose what it waits for…</option>}
                {[...new Set(options.map((o) => o.group))].map((g) => (
                  <optgroup key={g} label={g}>
                    {options.filter((o) => o.group === g).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
          </div>
          <p className="mt-1 text-xs text-muted">
            {task.dependsOnId
              ? `Starts the working day after “${depLabel(plan.tasks, task.dependsOnId)}” ends, and moves when it moves.`
              : choosing
                ? 'Pick the task or sub-task this one waits for. Tasks that would make a loop are not listed.'
                : 'Its dates are its own.'}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">Working days</span>
            <input
              type="number"
              min={1}
              className="input min-h-9 py-1"
              key={`${task.plannedDays}|${n}`}
              defaultValue={n ?? task.plannedDays ?? ''}
              disabled={!editable || (!parent && children.length > 0)}
              title={!parent && children.length > 0 ? 'Set by its sub-tasks' : task.startDate ? 'A new length moves the end' : 'Used for its end once it has a start'}
              onBlur={(e) => {
                const v = Math.round(Number(e.target.value));
                if (v >= 1 && v !== (n ?? task.plannedDays)) onPatch({ plannedDays: v });
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </label>
          <div>
            <span className="label">From the quote</span>
            <p className="pt-2 tabular-nums">{qty || <span className="text-muted">—</span>}</p>
          </div>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4 accent-brand-green" checked={task.done} disabled={!editable} onChange={(e) => onPatch({ done: e.target.checked })} />
          <span className="font-medium">Done</span>
          {task.done && task.doneAt && (
            <span className="text-xs text-muted">
              {formatMedium(istDateOf(task.doneAt))}
              {task.doneById ? ` by ${people.name(task.doneById)}` : ''}
            </span>
          )}
        </label>
        <label className="block">
          <span className="label">Notes</span>
          <textarea
            className="input min-h-28"
            value={notes.value}
            disabled={!editable}
            placeholder={editable ? 'PO number, vendor, vehicle no., invoice no., anything useful…' : ''}
            onChange={(e) => notes.onChange(e.target.value)}
            onBlur={notes.flush}
            maxLength={5000}
          />
        </label>
        {!parent && (
          <div>
            <div className="mb-1 flex items-center">
              <span className="label mb-0">Sub-tasks</span>
              {editable && (
                <button type="button" className="ml-auto text-xs font-medium text-brand-purple hover:underline" onClick={onAddSubtask}>
                  + Add sub-task
                </button>
              )}
            </div>
            {children.length ? (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {children.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-2" onClick={() => onOpen(c.id)}>
                      <CategoryDot category={c.category} />
                      <span className={`truncate ${c.done ? 'text-muted line-through' : ''}`}>{c.title}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted">{c.assigneeId ? people.name(c.assigneeId) : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">None.</p>
            )}
          </div>
        )}
        <p className="text-xs text-muted">
          Added {formatMedium(istDateOf(task.createdAt))}
          {task.createdById ? ` by ${people.name(task.createdById)}` : ''} · last changed {formatMedium(istDateOf(task.updatedAt))}
          {task.updatedById ? ` by ${people.name(task.updatedById)}` : ''}
        </p>
      </div>
      {editable && (
        <div className="border-t border-line p-4">
          <button
            type="button"
            className="text-sm text-brand-red hover:underline"
            onClick={() => window.confirm(children.length ? `Delete "${task.title}" and its ${children.length} sub-tasks?` : `Delete "${task.title}"?`) && onDelete()}
          >
            Delete {parent ? 'sub-task' : 'task'}
          </button>
        </div>
      )}
    </aside>
  );
}
