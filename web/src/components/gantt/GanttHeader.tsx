import { memo } from 'react';
import { addDays, isSunday, parts, WEEKDAYS, weekday, type IsoDate } from '@shared/schedule/dates';
import type { Span } from '@shared/schedule/spans';
import { dayCount, monthSegments, weekStarts, xOf, type Zoom } from '@shared/schedule/timeline';
import { HEADER_H, type Col } from './layout';

/** Month row + day (or week) row; sticky to the top of the planner, with the column titles stuck to the left. */
export const GanttHeader = memo(function GanttHeader({ range, px, zoom, today, cols, leftW }: { range: Span; px: number; zoom: Zoom; today: IsoDate; cols: Col[]; leftW: number }) {
  const months = monthSegments(range);
  const n = dayCount(range);
  const laneW = n * px;
  const todayX = today >= range.start && today <= range.end ? xOf(today, range.start, px) : null;
  return (
    <div className="sticky top-0 z-20 flex border-b border-line-strong bg-surface-3 text-xs" style={{ height: HEADER_H, width: leftW + laneW }}>
      <div className="sticky left-0 z-30 flex shrink-0 items-end border-r border-line-strong bg-surface-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-strong" style={{ width: leftW }}>
        {cols.map((c) => (
          <div key={c.key} className={`shrink-0 truncate ${c.key === 'days' ? 'px-1 text-right' : 'px-2'} ${c.key === 'done' ? 'text-center' : ''} ${c.key === 'title' ? 'pl-7' : ''}`} style={{ width: c.w }}>
            {c.label}
          </div>
        ))}
      </div>
      <div className="relative shrink-0" style={{ width: laneW }}>
        {months.map((m) => (
          <div
            key={m.start}
            className="absolute top-0 h-6 truncate border-l border-line-strong px-2 font-semibold leading-6 text-fg"
            style={{ left: xOf(m.start, range.start, px), width: m.days * px }}
          >
            {zoom === 'month' && m.days * px < 60 ? m.label.slice(0, 3) : m.label}
          </div>
        ))}
        {zoom === 'day' &&
          Array.from({ length: n }, (_, i) => {
            const d = addDays(range.start, i);
            const sun = isSunday(d);
            return (
              <div
                key={d}
                className={`absolute top-6 flex h-6 flex-col items-center justify-center border-l border-line leading-none ${sun ? 'bg-fg/6 text-muted' : 'text-muted-strong'}`}
                style={{ left: i * px, width: px }}
                title={d}
              >
                <span className="text-[10px] font-semibold">{parts(d).day}</span>
                <span className="text-[8px] uppercase">{WEEKDAYS[weekday(d)]![0]}</span>
              </div>
            );
          })}
        {zoom === 'week' &&
          weekStarts(range).map((d) => (
            <div key={d} className="absolute top-6 h-6 border-l border-line px-1 leading-6 text-muted-strong" style={{ left: xOf(d, range.start, px), width: 7 * px }}>
              {parts(d).day}
            </div>
          ))}
        {todayX !== null && (
          <div className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-full bg-brand-purple px-1.5 text-[10px] font-semibold leading-4 text-white shadow-sm" style={{ left: todayX + px / 2 }}>
            Today
          </div>
        )}
      </div>
    </div>
  );
});
