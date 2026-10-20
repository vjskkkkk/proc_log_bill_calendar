import { useMemo, useState, type FormEvent } from 'react';
import { CATEGORIES, CATEGORY_LABEL, isCategory, type Category } from '@shared/categories';
import type { CatalogItemDto, TaskDto } from '@shared/schemas/plan';
import { quantityIn, RULE_UNITS, ruleDays, UNIT_LABEL, type DurationRule, type RuleUnit } from '@shared/schedule/rules';
import { useCreateCatalogItem } from '../../api/catalog';
import { Modal } from '../ui';
import type { NewTaskRequest } from './GanttContext';

export interface NewTaskResult {
  title: string;
  category: Category;
  catalogItemId: string | null;
  plannedDays: number;
  /** For a new task (not a sub-task) with a per-quantity rule: the quantity it was sized from. */
  quantities: Partial<Record<RuleUnit, number>> | undefined;
  /** For a new sub-task: wait for this sibling. */
  dependsOnId: string | null;
}

const num = (s: string) => {
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

/**
 * A task or sub-task that is not in the Task Lists yet: is it a fixed number of days, or so many days per quantity?
 * Saves it to the Task Lists (by default) and gives the planner row its planned days.
 */
export function NewTaskDialog({ req, tasks, catalog, onDone, onClose }: { req: NewTaskRequest; tasks: TaskDto[]; catalog: CatalogItemDto[]; onDone: (r: NewTaskResult) => void; onClose: () => void }) {
  const isSub = !!req.parent;
  const save = useCreateCatalogItem();
  const parentTemplate = isSub && req.parent!.catalogItemId ? catalog.find((c) => c.id === req.parent!.catalogItemId && !c.parentId) ?? null : null;
  const siblings = isSub ? tasks.filter((t) => t.parentId === req.parent!.id && t.id !== req.taskId).sort((a, b) => a.sortOrder - b.sortOrder) : [];
  const prev = siblings.at(-1) ?? null;
  const knownQty = isSub ? req.parent!.quantities : (tasks.find((t) => t.id === req.taskId)?.quantities ?? {});

  const [mode, setMode] = useState<'fixed' | 'per_qty'>('fixed');
  const [category, setCategory] = useState<Category>(isCategory(req.category) ? req.category : 'material');
  const [fixedDays, setFixedDays] = useState('1');
  const [rate, setRate] = useState({ days: '1', perQty: '1000', unit: 'sqft' as RuleUnit, minDays: '1' });
  const [qty, setQty] = useState(() => String(Math.round(quantityIn(knownQty, 'sqft') ?? 0) || ''));
  const [saveToList, setSaveToList] = useState(!isSub || !!parentTemplate);
  const [afterPrev, setAfterPrev] = useState(!!prev);

  const rule: DurationRule | null = useMemo(() => {
    if (mode === 'fixed') {
      const d = num(fixedDays);
      return d > 0 ? { mode: 'fixed', days: d, perQty: null, unit: null, minDays: 1 } : null;
    }
    const d = num(rate.days);
    const per = num(rate.perQty);
    const min = Math.round(num(rate.minDays));
    return d > 0 && per > 0 && min >= 1 ? { mode: 'per_qty', days: d, perQty: per, unit: rate.unit, minDays: min } : null;
  }, [mode, fixedDays, rate]);
  const q = num(qty);
  const days = rule ? ruleDays(rule, mode === 'per_qty' && q > 0 ? { [rate.unit]: q } : {}).days : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!rule || !days) return;
    let catalogItemId: string | null = null;
    if (saveToList) {
      const prevStep = afterPrev && prev?.catalogItemId && catalog.some((c) => c.id === prev.catalogItemId && c.parentId === parentTemplate?.id) ? prev.catalogItemId : null;
      const r = await save.mutateAsync({ category, parentId: parentTemplate?.id ?? null, name: req.name, rule, dependsOnId: prevStep });
      catalogItemId = (r as { item?: CatalogItemDto }).item?.id ?? null;
    }
    onDone({
      title: req.name,
      category,
      catalogItemId,
      plannedDays: days,
      quantities: !isSub && mode === 'per_qty' && q > 0 ? { [rate.unit]: q } : undefined,
      dependsOnId: isSub && afterPrev && prev ? prev.id : null,
    });
  };

  const radio = (value: 'fixed' | 'per_qty', title: string, body: React.ReactNode) => (
    <label className={`block cursor-pointer rounded-lg border p-3 ${mode === value ? 'border-brand-purple bg-brand-purple/5 ring-1 ring-brand-purple' : 'border-line-strong hover:bg-surface-2'}`}>
      <span className="flex items-center gap-2 font-medium">
        <input type="radio" name="mode" className="accent-brand-purple" checked={mode === value} onChange={() => setMode(value)} />
        {title}
      </span>
      <span className="mt-2 flex flex-wrap items-center gap-1.5 pl-6 text-sm text-muted-strong">{body}</span>
    </label>
  );
  const small = 'input min-h-8 px-2 py-0.5 text-right tabular-nums';

  return (
    <Modal
      title={`Add “${req.name}”`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="new-task" className="btn-primary" disabled={!rule || save.isPending}>
            {save.isPending ? 'Saving…' : req.taskId ? 'Save' : `Add ${isSub ? 'sub-task' : 'task'}`}
          </button>
        </>
      }
    >
      <form id="new-task" onSubmit={submit} className="space-y-3 text-sm">
        <p className="text-muted-strong">
          This {isSub ? 'sub-task' : 'task'} isn't in the Task Lists yet. Does it take a fixed number of days, or does it depend on the quantity?
        </p>
        {!isSub && (
          <label className="flex items-center gap-2">
            <span className="w-20 text-muted-strong">Category</span>
            <select className="input min-h-8 w-56 py-0.5" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
        )}
        {radio(
          'fixed',
          'A fixed number of days',
          <>
            <input className={`${small} w-16`} inputMode="decimal" value={fixedDays} onChange={(e) => setFixedDays(e.target.value)} onFocus={() => setMode('fixed')} aria-label="Days" />
            working days, whatever the quantity
          </>,
        )}
        {radio(
          'per_qty',
          'Days per quantity',
          <>
            <input className={`${small} w-14`} inputMode="decimal" value={rate.days} onChange={(e) => setRate({ ...rate, days: e.target.value })} onFocus={() => setMode('per_qty')} aria-label="Days" />
            day(s) per
            <input className={`${small} w-20`} inputMode="decimal" value={rate.perQty} onChange={(e) => setRate({ ...rate, perQty: e.target.value })} onFocus={() => setMode('per_qty')} aria-label="Quantity" />
            <select
              className="input min-h-8 w-20 px-1 py-0.5"
              value={rate.unit}
              onChange={(e) => {
                const unit = e.target.value as RuleUnit;
                setRate({ ...rate, unit });
                const known = quantityIn(knownQty, unit);
                if (known) setQty(String(Math.round(known)));
              }}
              onFocus={() => setMode('per_qty')}
              aria-label="Unit"
            >
              {RULE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABEL[u]}
                </option>
              ))}
            </select>
            , at least
            <input className={`${small} w-12`} inputMode="numeric" value={rate.minDays} onChange={(e) => setRate({ ...rate, minDays: e.target.value })} onFocus={() => setMode('per_qty')} aria-label="Minimum days" />
            days
            <span className="mt-1 flex w-full items-center gap-1.5">
              This project:
              <input className={`${small} w-24`} inputMode="decimal" value={qty} placeholder="0" onChange={(e) => setQty(e.target.value)} onFocus={() => setMode('per_qty')} aria-label="Quantity in this project" />
              {UNIT_LABEL[rate.unit]}
            </span>
          </>,
        )}
        <p className="rounded-md bg-surface-2 px-3 py-2">
          {days ? (
            <>
              → <b>{days} working days</b> here{mode === 'per_qty' && !(q > 0) ? ' (the minimum: no quantity given)' : ''}.
            </>
          ) : (
            <span className="text-brand-red">Enter days above 0{mode === 'per_qty' ? ', a quantity and a minimum of 1' : ''}.</span>
          )}
        </p>
        {isSub && prev && (
          <label className="flex items-center gap-2">
            <input type="checkbox" className="accent-brand-purple" checked={afterPrev} onChange={(e) => setAfterPrev(e.target.checked)} />
            Starts after “{prev.title}” ends (dependent)
          </label>
        )}
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5 accent-brand-purple" checked={saveToList} disabled={isSub && !parentTemplate} onChange={(e) => setSaveToList(e.target.checked)} />
          <span>
            Save to the Task Lists{' '}
            {isSub ? (parentTemplate ? `as a sub-task of “${parentTemplate.name}”` : '') : `under ${CATEGORY_LABEL[category]}`}
            {isSub && !parentTemplate && <span className="block text-xs text-muted">Its task isn't from the Task Lists, so this sub-task is for this project only.</span>}
          </span>
        </label>
      </form>
    </Modal>
  );
}
