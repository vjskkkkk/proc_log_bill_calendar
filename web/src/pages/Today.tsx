import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PlanDto, TaskDto } from '@shared/schemas/plan';
import type { UserPublic } from '@shared/types';
import { canEdit } from '@shared/types';
import { addDays, formatLong, formatShort, istDateOf, todayIST, type IsoDate } from '@shared/schedule/dates';
import { selectToday, type TodayItem, type TodayScope } from '@shared/schedule/today';
import { usePatchTask, usePlan } from '../api/plan';
import { Avatar, CategoryDot, CategoryPill, Seg } from '../components/ui';
import { BOQ_URL } from '../components/Shell';
import { usePeople } from '../lib/people';
import { readPref, writePref } from '../lib/prefs';
import { projectColorMap } from '../lib/projectColors';

type Layout = 'cards' | 'list';

/** IST today, re-read every minute and on focus so the page rolls over at midnight. */
export function useTodayIST(): IsoDate {
  const [today, setToday] = useState(todayIST());
  useEffect(() => {
    const tick = () => setToday(todayIST());
    const t = setInterval(tick, 60_000);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', tick);
    };
  }, []);
  return today;
}

function greeting(): string {
  const h = new Date(Date.now() + 330 * 60_000).getUTCHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function statusText(item: TodayItem<TaskDto>, date: IsoDate): { text: string; tone: 'red' | 'amber' | 'plain' } {
  if (item.kind === 'overdue') {
    const days = item.overdueDays === 1 ? '1 day' : `${item.overdueDays} days`;
    const later = item.done && item.task.doneAt ? ` · done ${formatShort(istDateOf(item.task.doneAt))}` : '';
    return { text: `Overdue ${days} · was due ${formatShort(item.span.end)}${later}`, tone: 'red' };
  }
  if (item.dayCount === 1) return { text: item.span.start === date ? 'Today only' : formatShort(item.span.start), tone: 'plain' };
  if (item.span.end === date) return { text: `Due today · day ${item.dayIndex} of ${item.dayCount}`, tone: 'amber' };
  return { text: `Day ${item.dayIndex} of ${item.dayCount} · ends ${formatShort(item.span.end)}`, tone: 'plain' };
}

export default function TodayPage({ user }: { user: UserPublic }) {
  const plan = usePlan('open');
  const today = useTodayIST();
  const [date, setDate] = useState<IsoDate>(today);
  const [scope, setScope] = useState<TodayScope>(() => readPref<TodayScope>('today.scope', user.role === 'viewer' ? 'all' : 'mine'));
  const [hideDone, setHideDone] = useState(() => readPref('today.hideDone', false));
  const [layout, setLayout] = useState<Layout>(() => readPref<Layout>('today.layout', 'cards'));
  const changeLayout = (l: Layout) => {
    setLayout(l);
    writePref('today.layout', l);
  };
  const people = usePeople(plan.data?.people);
  const patch = usePatchTask(user.id);
  const editable = canEdit(user.role);

  // Follow the day forward if the page was left open on "today".
  const [lastToday, setLastToday] = useState(today);
  useEffect(() => {
    if (today !== lastToday) {
      if (date === lastToday) setDate(today);
      setLastToday(today);
    }
  }, [today, lastToday, date]);

  const result = useMemo(() => {
    if (!plan.data) return null;
    return selectToday(plan.data.projects, plan.data.tasks, { date, today, userId: user.id, scope });
  }, [plan.data, date, today, user.id, scope]);

  const tasksById = useMemo(() => new Map((plan.data?.tasks ?? []).map((t) => [t.id, t])), [plan.data]);
  const projectColors = useMemo(() => projectColorMap((plan.data?.projects ?? []).map((p) => p.id)), [plan.data?.projects]);

  // Each project's groups with done items dropped when "Hide done" is on; projects left empty are skipped.
  const shown = useMemo(
    () =>
      (result?.projects ?? [])
        .map(({ project, groups }) => ({
          project: plan.data!.projects.find((p) => p.id === project.id)!,
          groups: groups.map((g) => ({ ...g, items: hideDone ? g.items.filter((i) => !i.done) : g.items })).filter((g) => g.items.length),
        }))
        .filter((p) => p.groups.length),
    [result, hideDone, plan.data],
  );

  const changeScope = (s: TodayScope) => {
    setScope(s);
    writePref('today.scope', s);
  };
  const toggleHideDone = () => {
    setHideDone(!hideDone);
    writePref('today.hideDone', !hideDone);
  };

  const tick = (t: TaskDto, done: boolean) => patch.mutate({ id: t.id, patch: { done } });
  const isToday = date === today;
  const c = result?.counts;

  return (
    <div className="space-y-5">
      <section className="relative h-32 overflow-hidden border border-line bg-ink no-print">
        <img src="/brand/app_banner-web.jpg" alt="" className="absolute inset-0 h-full w-full object-cover object-[50%_45%]" />
        <div className="absolute inset-0 bg-linear-to-r from-ink/90 via-ink/60 via-45% to-ink/10" />
        <div className="relative flex h-full flex-col justify-center px-8 text-white">
          <h1 className="text-2xl font-semibold">
            {greeting()}, {user.name.split(' ')[0]}
          </h1>
          <p className="text-white/80">
            {isToday ? "Here's what's on today" : 'Viewing'} — {formatLong(date)}
          </p>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-1 bg-brand-green" />
      </section>

      <div className="flex flex-wrap items-center gap-3 no-print">
        <div className="flex items-center gap-1">
          <button type="button" className="btn-secondary min-h-9 px-2.5 py-1" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day" title="Previous day">
            ‹
          </button>
          <input type="date" className="input min-h-9 w-40 py-1" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" />
          <button type="button" className="btn-secondary min-h-9 px-2.5 py-1" onClick={() => setDate(addDays(date, 1))} aria-label="Next day" title="Next day">
            ›
          </button>
          <button type="button" className="btn-ghost min-h-9 py-1" onClick={() => setDate(today)} disabled={isToday}>
            Today
          </button>
        </div>
        <Seg label="Whose tasks" value={scope} onChange={changeScope} options={[{ value: 'mine', label: 'My tasks' }, { value: 'all', label: 'Everyone' }]} />
        <Seg label="Show as" value={layout} onChange={changeLayout} options={[{ value: 'cards', label: 'Cards' }, { value: 'list', label: 'List' }]} />
        <label className="inline-flex items-center gap-2 text-sm text-muted-strong">
          <input type="checkbox" className="h-4 w-4 accent-brand-purple" checked={hideDone} onChange={toggleHideDone} />
          Hide done
        </label>
        {c && (
          <div className="ml-auto flex items-center gap-2 text-sm">
            {c.overdue > 0 && <span className="chip bg-brand-red/15 text-brand-red">{c.overdue} overdue</span>}
            <span className="chip bg-surface-3 text-muted-strong">{c.active} to do</span>
            <span className="chip bg-brand-green/20 text-ok">
              {c.done} done
            </span>
            <button type="button" className="btn-ghost min-h-9 py-1" onClick={() => window.print()} title="Print this list">
              Print
            </button>
          </div>
        )}
      </div>

      {c && (c.unassigned > 0 || c.overdueNow > 0 || c.unscheduled > 0) && (
        <div className="flex flex-wrap gap-2 text-sm no-print">
          {c.overdueNow > 0 && (
            <button type="button" className="chip bg-brand-red/10 text-brand-red hover:underline" onClick={() => setDate(today)}>
              {c.overdueNow} overdue now → today's list
            </button>
          )}
          {scope === 'mine' && c.unassigned > 0 && (
            <button type="button" className="chip bg-brand-yellow/25 text-warn-fg hover:underline" onClick={() => changeScope('all')}>
              {c.unassigned} unassigned {c.unassigned === 1 ? 'item' : 'items'} on this day → show everyone's
            </button>
          )}
          {c.unscheduled > 0 && (
            <Link to="/planner?unscheduled=1" className="chip bg-surface-3 text-muted-strong hover:underline">
              {c.unscheduled} {c.unscheduled === 1 ? 'item has' : 'items have'} no dates yet → plan them
            </Link>
          )}
        </div>
      )}

      {plan.isLoading && <p className="text-muted">Loading…</p>}
      {plan.isError && <p className="text-brand-red">Could not load the plan: {(plan.error as Error).message}</p>}

      {result && result.projects.length === 0 && (
        <div className="card py-12 text-center">
          <div className="text-lg font-semibold">{scope === 'mine' ? 'Nothing on your list for this day' : 'Nothing scheduled for this day'}</div>
          <p className="mt-1 text-sm text-muted">
            Tasks appear here when their dates cover the day, and stay (in red) until they are ticked done.{' '}
            <Link to="/planner" className="text-brand-purple hover:underline">
              Open the planner
            </Link>
          </p>
        </div>
      )}

      {layout === 'list' && shown.length > 0 && (
        <div className="overflow-x-auto border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line-strong bg-surface-3 text-left">
              <tr className="col-head">
                <th className="w-10 px-3 py-2" aria-label="Done" />
                <th className="px-2 py-2">Task</th>
                <th className="px-2 py-2">Project</th>
                <th className="px-2 py-2">Category</th>
                <th className="px-2 py-2">When</th>
                {scope === 'all' && <th className="px-2 py-2">Owner</th>}
                <th className="w-20 px-2 py-2 no-print" />
              </tr>
            </thead>
            <tbody>
              {shown.flatMap(({ project: full, groups }) =>
                groups.flatMap((g) =>
                  g.items.map((item) => {
                    const t = tasksById.get(item.task.id) ?? item.task;
                    const st = statusText(item, date);
                    const pc = projectColors.get(full.id);
                    return (
                      <tr key={t.id} className="group border-b border-line last:border-b-0 hover:bg-surface-2">
                        <td className="px-3 py-1.5 align-top" style={{ boxShadow: `inset 4px 0 0 ${pc}` }}>
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 accent-brand-green"
                            checked={t.done}
                            disabled={!editable}
                            onChange={(e) => tick(t, e.target.checked)}
                            aria-label={`Mark "${t.title}" ${t.done ? 'not done' : 'done'}`}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          {g.isHeader && <span className="text-muted">{g.task.title} › </span>}
                          <span className={t.done ? 'text-muted line-through' : 'font-medium'}>{t.title}</span>
                        </td>
                        <td className="max-w-56 truncate px-2 py-1.5" title={full.name}>
                          {full.name}
                        </td>
                        <td className="px-2 py-1.5">
                          <CategoryPill category={t.category} />
                        </td>
                        <td className={`whitespace-nowrap px-2 py-1.5 text-xs ${st.tone === 'red' ? 'font-medium text-brand-red' : st.tone === 'amber' ? 'font-medium text-warn-fg' : 'text-muted-strong'}`}>
                          {st.text}
                        </td>
                        {scope === 'all' && <td className="whitespace-nowrap px-2 py-1.5 text-xs text-muted-strong">{item.owner ? people.name(item.owner) : '—'}</td>}
                        <td className="px-2 py-1.5 text-right no-print">
                          <Link to={`/planner?focus=${t.id}`} className="text-xs text-brand-purple opacity-0 hover:underline group-hover:opacity-100 focus:opacity-100" title="Show in the planner">
                            Planner ↗
                          </Link>
                        </td>
                      </tr>
                    );
                  }),
                ),
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className={`grid items-start gap-4 xl:grid-cols-2 ${layout === 'list' ? 'hidden' : ''}`}>
        {shown.map(({ project: full, groups: visible }) => {
          return (
            <section key={full.id} className="card overflow-hidden border-l-4 p-0" style={{ borderLeftColor: projectColors.get(full.id) }}>
              <header className="flex items-start gap-3 border-b border-line bg-surface-2 px-4 py-3">
                <div className="min-w-0">
                  <h2 className="truncate font-semibold">{full.name}</h2>
                  <div className="truncate text-xs text-muted">{[full.client, full.location].filter(Boolean).join(', ') || '—'}</div>
                </div>
                {full.boqQuoteId && (
                  <a href={`${BOQ_URL}/quotes/${full.boqQuoteId}`} target="_blank" rel="noopener" className="chip ml-auto shrink-0 bg-brand-purple/10 text-brand-purple hover:underline" title="Open the quote in BOQ Maker">
                    {full.boqQuoteNo || 'BOQ quote'} ↗
                  </a>
                )}
              </header>
              <ul className="divide-y divide-line">
                {visible.map((g) => (
                  <li key={g.task.id} className="px-4 py-2">
                    {g.isHeader && (
                      <div className="flex items-center gap-2 py-1 text-sm">
                        <CategoryDot category={g.task.category} />
                        <span className="font-semibold">{g.task.title}</span>
                        <span className="text-xs text-muted tabular-nums">
                          {g.progress.done}/{g.progress.total} done
                        </span>
                        {scope === 'all' && g.task.assigneeId && <span className="ml-auto text-xs text-muted">{people.name(g.task.assigneeId)}</span>}
                      </div>
                    )}
                    <ul className={g.isHeader ? 'ml-1 border-l-2 border-line pl-3' : ''}>
                      {g.items.map((item) => {
                        const t = tasksById.get(item.task.id) ?? item.task;
                        const st = statusText(item, date);
                        return (
                          <li key={t.id} className="group flex items-start gap-3 py-1.5">
                            <input
                              type="checkbox"
                              className="mt-0.5 h-4.5 w-4.5 shrink-0 accent-brand-green"
                              checked={t.done}
                              disabled={!editable}
                              onChange={(e) => tick(t, e.target.checked)}
                              aria-label={`Mark "${t.title}" ${t.done ? 'not done' : 'done'}`}
                              title={editable ? (t.done ? 'Mark not done' : 'Mark done') : 'Viewers cannot change tasks'}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                <span className={`text-sm ${t.done ? 'text-muted line-through' : 'font-medium'}`}>{t.title}</span>
                                {!g.isHeader && <CategoryPill category={t.category} />}
                              </div>
                              <div className={`text-xs ${st.tone === 'red' ? 'font-medium text-brand-red' : st.tone === 'amber' ? 'font-medium text-warn-fg' : 'text-muted'}`}>
                                {st.text}
                                {item.inheritedDates && <span className="text-muted"> · task's dates</span>}
                              </div>
                            </div>
                            {scope === 'all' && item.owner && <Avatar name={people.name(item.owner)} muted={item.inheritedOwner} size="xs" />}
                            <Link
                              to={`/planner?focus=${t.id}`}
                              className="shrink-0 text-xs text-brand-purple opacity-0 hover:underline group-hover:opacity-100 focus:opacity-100 no-print"
                              title="Show in the planner"
                            >
                              Planner ↗
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export type { PlanDto };
