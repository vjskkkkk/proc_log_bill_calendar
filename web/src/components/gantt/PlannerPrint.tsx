import { CATEGORY_COLOR, CATEGORY_LABEL, CATEGORY_SHORT, isCategory } from '@shared/categories';
import type { TaskDto } from '@shared/schemas/plan';
import { addDays, formatMedium, formatShort, isSunday, maxDate, minDate, parts, todayIST, WEEKDAYS, weekday, type IsoDate } from '@shared/schedule/dates';
import type { Span } from '@shared/schedule/spans';
import { dayCount, monthSegments, sundayOffset, weekStarts, xOf, type Zoom } from '@shared/schedule/timeline';
import { workingDays } from '@shared/schedule/workdays';
import type { usePeople } from '../../lib/people';
import type { Row } from './GanttContext';
import { depLabel } from './GanttRow';
import type { Col } from './layout';

/** A4 landscape with 10 mm margins is about 1,040 CSS px wide: the print is scaled down to fit it. */
const PAGE_W = 1040;
const ROW = 22;

interface Props {
  rows: Row[];
  from: IsoDate;
  to: IsoDate;
  zoom: Zoom;
  px: number;
  cols: Col[];
  people: ReturnType<typeof usePeople>;
  tasks: TaskDto[];
  today: IsoDate;
  note: string;
}

const clip = (s: Span | null, from: IsoDate, to: IsoDate): Span | null => {
  if (!s || s.end < from || s.start > to) return null;
  return { start: maxDate(s.start, from), end: minDate(s.end, to) };
};

/**
 * The planner as it is on screen, for printing / saving as PDF: the rows shown (tree, filters and collapsed rows as
 * they are), at the current zoom, for a chosen date window. Static markup (no virtualising, no sticky columns), so the
 * browser can flow it over pages; the table head repeats on every page.
 */
export function PlannerPrint({ rows, from, to, zoom, px, cols, people, tasks, today, note }: Props) {
  const left = cols.filter((c) => c.key !== 'grip');
  const leftW = left.reduce((s, c) => s + c.w, 0);
  const range: Span = { start: from, end: to };
  const laneW = dayCount(range) * px;
  const scale = Math.min(1, PAGE_W / (leftW + laneW));
  const sun = sundayOffset(from) * px;
  const grid = {
    backgroundImage: [
      `linear-gradient(to right, #ececec 0 ${px}px, transparent ${px}px)`,
      zoom === 'day' ? 'linear-gradient(to right, #e2e2e2 0 1px, transparent 1px)' : '',
    ]
      .filter(Boolean)
      .join(', '),
    backgroundSize: [`${7 * px}px 100%`, zoom === 'day' ? `${px}px 100%` : ''].filter(Boolean).join(', '),
    backgroundPosition: [`${sun}px 0`, zoom === 'day' ? '0 0' : ''].filter(Boolean).join(', '),
  };
  const todayX = today >= from && today <= to ? xOf(today, from, px) + px / 2 : null;

  const bar = (s: Span | null, color: string, opts: { ghost?: boolean; done?: boolean; overdue?: boolean; label?: string; bracket?: boolean } = {}) => {
    const c = clip(s, from, to);
    if (!c) return null;
    const x = xOf(c.start, from, px);
    const w = Math.max(3, (xOf(c.end, from, px) - x) + px);
    if (opts.bracket) return <div className="absolute top-[7px] h-[5px]" style={{ left: x, width: w, backgroundColor: color }} />;
    return (
      <div
        className="absolute top-[4px] flex h-[14px] items-center overflow-hidden whitespace-nowrap"
        style={{
          left: x,
          width: w,
          backgroundColor: opts.ghost ? 'transparent' : color,
          border: opts.ghost ? `1px dashed ${color}` : undefined,
          outline: opts.overdue ? '1.5px solid #ea2227' : undefined,
          outlineOffset: 1,
          opacity: opts.done ? 0.4 : 1,
        }}
      >
        {opts.label && w > 70 && !opts.ghost && <span className="px-1 text-[8px] font-semibold text-white mix-blend-normal">{opts.label}</span>}
      </div>
    );
  };

  const cell = (c: Col, row: Row): React.ReactNode => {
    if (row.kind !== 'task' && row.kind !== 'subtask') return null;
    const t = row.task;
    const span = row.kind === 'subtask' ? row.own ?? row.inherited : row.kind === 'task' && row.hasChildren ? row.rollup : row.own;
    switch (c.key) {
      case 'title':
        return (
          <span className={`block truncate ${row.kind === 'task' ? 'pl-[18px] font-semibold' : 'pl-[36px]'} ${t.done ? 'text-neutral-500 line-through' : ''}`}>
            {row.kind === 'subtask' && <span className="text-neutral-400">└ </span>}
            {t.title}
          </span>
        );
      case 'cat':
        return row.kind === 'task' && isCategory(t.category) ? CATEGORY_SHORT[t.category] : '';
      case 'owner':
        return row.kind === 'subtask' ? (row.owner ? people.name(row.owner) : '') : t.assigneeId ? people.name(t.assigneeId) : '';
      case 'start':
        return span ? formatShort(span.start) : '';
      case 'end':
        return span ? formatShort(span.end) : '';
      case 'days':
        return span ? workingDays(span.start, span.end) : t.plannedDays ?? '';
      case 'dep':
        return t.dependsOnId ? `↳ ${depLabel(tasks, t.dependsOnId) ?? ''}` : '';
      case 'done':
        return t.done ? '✓' : '';
      default:
        return null;
    }
  };

  const lane = (row: Row) => {
    if (row.kind === 'project') return row.span && bar(row.span, '#231f20', { bracket: true });
    if (row.kind === 'section') return row.span && bar(row.span, '#8a8a8a', { bracket: true });
    if (row.kind !== 'task' && row.kind !== 'subtask') return null;
    const color = isCategory(row.task.category) ? CATEGORY_COLOR[row.task.category].bg : '#717272';
    if (row.kind === 'task' && row.hasChildren) return row.rollup && bar(row.rollup, '#8a8a8a', { bracket: true });
    if (row.kind === 'subtask' && !row.own) return row.inherited && bar(row.inherited, color, { ghost: true });
    return bar(row.own, color, { done: row.task.done, overdue: row.overdue, label: row.task.title });
  };

  return (
    <div className="planner-print bg-white text-[10px] text-[#231f20]" style={{ zoom: scale }}>
      <style>{'@page { size: A4 landscape; margin: 10mm; }'}</style>
      <div className="mb-2 flex items-baseline gap-3" style={{ width: leftW + laneW }}>
        <span className="text-[16px] font-bold">Koochie Calendar — Planner</span>
        <span className="text-[11px]">
          {formatMedium(from)} – {formatMedium(to)}, {zoom === 'day' ? 'by day' : zoom === 'week' ? 'by week' : 'by month'}
          {note ? `, ${note}` : ''}
        </span>
        <span className="ml-auto text-[10px] text-neutral-500">Printed {formatMedium(todayIST())}</span>
      </div>
      <table className="border-collapse" style={{ width: leftW + laneW, tableLayout: 'fixed' }}>
        <colgroup>
          {left.map((c) => (
            <col key={c.key} style={{ width: c.w }} />
          ))}
          <col style={{ width: laneW }} />
        </colgroup>
        <thead>
          <tr className="border-y border-[#231f20] bg-[#efefef]">
            {left.map((c) => (
              <th key={c.key} className={`h-[34px] px-1.5 text-left align-bottom font-semibold ${c.key === 'days' ? 'text-right' : ''}`}>
                {c.key === 'title' ? 'Task / sub-task' : c.label}
              </th>
            ))}
            <th className="relative h-[34px] border-l border-[#231f20] p-0">
              {monthSegments(range).map((m) => (
                <span key={m.start} className="absolute top-0 h-[17px] truncate border-l border-[#bbb] px-1 text-left font-semibold leading-[17px]" style={{ left: xOf(m.start, from, px), width: m.days * px }}>
                  {zoom === 'month' && m.days * px < 50 ? m.label.slice(0, 3) : m.label}
                </span>
              ))}
              {zoom === 'day' &&
                Array.from({ length: dayCount(range) }, (_, i) => {
                  const d = addDays(from, i);
                  return (
                    <span key={d} className={`absolute top-[17px] h-[17px] border-l border-[#ddd] text-center text-[8px] leading-[17px] font-normal ${isSunday(d) ? 'text-neutral-400' : ''}`} style={{ left: i * px, width: px }}>
                      {parts(d).day}
                      {px >= 24 ? ` ${WEEKDAYS[weekday(d)]![0]}` : ''}
                    </span>
                  );
                })}
              {zoom === 'week' &&
                weekStarts(range).map((d) => (
                  <span key={d} className="absolute top-[17px] h-[17px] border-l border-[#ddd] px-0.5 text-left text-[8px] leading-[17px] font-normal" style={{ left: xOf(d, from, px), width: 7 * px }}>
                    {parts(d).day}
                  </span>
                ))}
            </th>
          </tr>
        </thead>
        {rows.map((row) => {
          if (row.kind === 'add') return null;
          const isProject = row.kind === 'project';
          const isSection = row.kind === 'section';
          return (
            <tbody key={row.key} style={{ breakInside: 'avoid' }}>
              <tr className={`${isProject ? 'border-t-2 border-[#231f20] bg-[#efefef]' : isSection ? 'border-t border-[#c9c9c9] bg-[#f8f8f8]' : 'border-t border-[#e8e8e8]'}`} style={{ height: ROW }}>
                {isProject || isSection ? (
                  <td colSpan={left.length} className="truncate px-1.5">
                    {isProject ? (
                      <>
                        <b className="text-[11px]">{row.project.name}</b>
                        <span className="ml-2 text-neutral-500">{[row.project.client, row.project.location].filter(Boolean).join(', ')}</span>
                        {row.span && <span className="ml-2">{formatShort(row.span.start)} – {formatShort(row.span.end)}</span>}
                      </>
                    ) : (
                      <span className="pl-[6px]">
                        <span className="mr-1 inline-block h-[7px] w-[7px]" style={{ backgroundColor: isCategory(row.category) ? CATEGORY_COLOR[row.category].bg : '#717272' }} />
                        <b>{isCategory(row.category) ? CATEGORY_LABEL[row.category] : row.category}</b>
                        <span className="ml-1.5 text-neutral-500">
                          {row.taskCount} {row.taskCount === 1 ? 'task' : 'tasks'}
                        </span>
                      </span>
                    )}
                  </td>
                ) : (
                  left.map((c) => (
                    <td key={c.key} className={`truncate px-1.5 ${c.key === 'days' ? 'text-right tabular-nums' : ''} ${c.key === 'done' ? 'text-center' : ''}`}>
                      {cell(c, row)}
                    </td>
                  ))
                )}
                <td className="relative border-l border-[#231f20] p-0">
                  <div className="absolute inset-0" style={grid} />
                  {todayX !== null && <div className="absolute inset-y-0 w-px bg-[#7d51a0]" style={{ left: todayX }} />}
                  {lane(row)}
                </td>
              </tr>
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
