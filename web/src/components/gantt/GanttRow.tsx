import { memo } from 'react';
import { CATEGORY_COLOR, isCategory } from '@shared/categories';
import type { CatalogItemDto, TaskDto } from '@shared/schemas/plan';
import { formatShort } from '@shared/schedule/dates';
import { dependencyCandidates } from '@shared/schedule/deps';
import type { Span } from '@shared/schedule/spans';
import { barGeometry } from '@shared/schedule/timeline';
import { workingDays } from '@shared/schedule/workdays';
import { CategoryDot } from '../ui';
import { CategoryCell, DateCell, DaysCell, DependencyCell, DoneCell, OwnerCell, type DepOption } from './cells';
import { useGantt, type DragMode, type Row } from './GanttContext';
import { cellId, ROW_H, type ColKey } from './layout';
import { TitleCombobox } from './TitleCombobox';

export interface RowPreview {
  span: Span;
  label: string;
}

/** Working days (Sundays off). */
const days = (s: Span | null) => (s ? workingDays(s.start, s.end) : null);

/** "Task › Sub-task" for a dependency label. */
export function depLabel(tasks: TaskDto[], id: string | null): string | null {
  if (!id) return null;
  const t = tasks.find((x) => x.id === id);
  if (!t) return null;
  const parent = t.parentId ? tasks.find((x) => x.id === t.parentId) : null;
  return parent ? `${parent.title} › ${t.title}` : t.title;
}

/** What a row may wait for: the project's other tasks and sub-tasks that don't make a loop, grouped by task. */
export function depOptions(tasks: TaskDto[], task: TaskDto): DepOption[] {
  const mine = tasks.filter((t) => t.projectId === task.projectId);
  const ok = new Set(dependencyCandidates(mine, task.id));
  const tops = mine.filter((t) => !t.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  const out: DepOption[] = [];
  for (const top of tops) {
    if (ok.has(top.id)) out.push({ id: top.id, label: `${top.title} (whole task)`, group: top.title });
    for (const s of mine.filter((x) => x.parentId === top.id).sort((a, b) => a.sortOrder - b.sortOrder)) if (ok.has(s.id)) out.push({ id: s.id, label: s.title, group: top.title });
  }
  return out;
}

function Label({ text, inside, done, color }: { text: string; inside: boolean; done?: boolean; color?: string }) {
  return (
    <span
      className={`pointer-events-none truncate text-[11px] font-medium leading-5 ${inside ? 'px-2' : 'absolute left-full ml-1.5 whitespace-nowrap text-muted-strong'} ${done ? 'line-through' : ''}`}
      style={inside ? { color } : undefined}
    >
      {done && '✓ '}
      {text}
    </span>
  );
}

/** A task/sub-task bar: drag the middle to move, the ends to resize. */
function LeafBar({ row, task, span, overdue, ghost }: { row: Row; task: TaskDto; span: Span; overdue: boolean; ghost?: boolean }) {
  const g = useGantt();
  const { left, width } = barGeometry(span, g.origin, g.px);
  const c = isCategory(task.category) ? CATEGORY_COLOR[task.category] : { bg: '#717272', text: '#fff' };
  const inside = width >= 110 && !ghost;
  const down = (mode: DragMode) => (e: React.PointerEvent) => g.actions.startDrag(e, row, mode);
  return (
    <div
      className={`absolute top-1.5 flex h-5 items-center rounded-md ${ghost ? 'border border-dashed' : 'shadow-sm'} ${overdue ? 'ring-2 ring-brand-red ring-offset-1 ring-offset-surface' : ''} ${
        task.done ? 'opacity-40' : ''
      } ${g.editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
      style={{ left, width, backgroundColor: ghost ? 'transparent' : c.bg, borderColor: ghost ? c.bg : undefined }}
      onPointerDown={down('move')}
      title={`${task.title}\n${formatShort(span.start)} → ${formatShort(span.end)} · ${days(span)} working d${ghost ? " (task's dates)" : ''}${task.dependsOnId ? `\nStarts after: ${depLabel(g.tasks, task.dependsOnId)}` : ''}${overdue ? ' · OVERDUE' : ''}`}
      data-bar={task.id}
    >
      <Label text={task.title} inside={inside} done={task.done} color={c.text} />
      {task.dependsOnId && !ghost && <span className="pointer-events-none absolute -left-2 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 border-r-2 border-t-2" style={{ borderColor: c.bg }} aria-hidden="true" />}
      {g.editable && !ghost && (
        <>
          {!task.dependsOnId && <span className="absolute -left-1 top-0 h-full w-2.5 cursor-ew-resize" onPointerDown={(e) => { e.stopPropagation(); down('start')(e); }} />}
          <span className="absolute -right-1 top-0 h-full w-2.5 cursor-ew-resize" onPointerDown={(e) => { e.stopPropagation(); down('end')(e); }} />
        </>
      )}
    </div>
  );
}

/** Bracket over a span (a task's sub-tasks, or a whole project). */
function Bracket({ span, tone, top }: { span: Span; tone: 'ink' | 'muted'; top: number }) {
  const g = useGantt();
  const { left, width } = barGeometry(span, g.origin, g.px);
  const color = tone === 'ink' ? 'var(--color-fg)' : 'var(--color-muted)';
  return (
    <div className="pointer-events-none absolute" style={{ left, width, top, height: 8 }}>
      <div className="absolute inset-x-0 top-0 h-1.5 rounded-sm" style={{ backgroundColor: color, opacity: tone === 'ink' ? 0.85 : 0.6 }} />
      <div className="absolute left-0 top-0 h-2.5 w-1 rounded-b-sm" style={{ backgroundColor: color }} />
      <div className="absolute right-0 top-0 h-2.5 w-1 rounded-b-sm" style={{ backgroundColor: color }} />
    </div>
  );
}

/** The own window of a task that has sub-tasks: dragging it moves the task with its sub-tasks. */
function SummaryOwnBar({ row, task, span }: { row: Row; task: TaskDto; span: Span }) {
  const g = useGantt();
  const { left, width } = barGeometry(span, g.origin, g.px);
  const c = isCategory(task.category) ? CATEGORY_COLOR[task.category].bg : '#717272';
  return (
    <div
      className={`absolute top-1 h-4 rounded-md border-2 ${task.done ? 'opacity-40' : ''} ${g.editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
      style={{ left, width, borderColor: c, backgroundColor: `${c}40` }}
      onPointerDown={(e) => g.actions.startDrag(e, row, 'shift')}
      title={`${task.title} (with its sub-tasks)\n${formatShort(span.start)} → ${formatShort(span.end)} · ${days(span)} d — drag to move all`}
      data-bar={task.id}
    >
      {width >= 110 && <span className="pointer-events-none block truncate px-2 text-[10px] font-semibold leading-3 text-fg">{task.title}</span>}
    </div>
  );
}

function Lane({ row, preview }: { row: Row; preview: RowPreview | undefined }) {
  const g = useGantt();
  const onLaneDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget || !g.editable) return;
    if ((row.kind === 'task' && !row.hasChildren && !row.own) || (row.kind === 'subtask' && !row.own)) g.actions.startDrag(e, row, 'draw');
  };
  let content: React.ReactNode = null;
  if (row.kind === 'project') {
    content = row.span && <Bracket span={row.span} tone="ink" top={12} />;
  } else if (row.kind === 'task') {
    if (row.hasChildren) {
      const own = preview?.span ?? row.own;
      content = (
        <>
          {own && <SummaryOwnBar row={row} task={row.task} span={own} />}
          {row.rollup && <Bracket span={row.rollup} tone="muted" top={22} />}
        </>
      );
    } else {
      const span = preview?.span ?? row.own;
      content = span && <LeafBar row={row} task={row.task} span={span} overdue={row.overdue && !preview} />;
    }
  } else if (row.kind === 'subtask') {
    const span = preview?.span ?? row.own;
    if (span) content = <LeafBar row={row} task={row.task} span={span} overdue={row.overdue && !preview} />;
    else if (row.inherited) content = <LeafBar row={row} task={row.task} span={row.inherited} overdue={row.overdue} ghost />;
  }
  const empty = (row.kind === 'task' && !row.hasChildren && !row.own) || (row.kind === 'subtask' && !row.own);
  return (
    <div
      className={`relative h-full ${row.kind === 'project' ? 'bg-surface-3/40' : ''} ${empty && g.editable ? 'cursor-crosshair' : ''}`}
      style={{ width: g.laneW }}
      onPointerDown={onLaneDown}
      title={empty && g.editable && !(row.kind === 'subtask' && row.inherited) ? 'Drag across the days to set dates' : undefined}
    >
      {content}
      {preview && (
        <div
          className="pointer-events-none absolute -top-7 z-20 whitespace-nowrap rounded-md bg-ink px-2 py-0.5 text-xs font-medium text-white shadow-lg"
          style={{ left: barGeometry(preview.span, g.origin, g.px).left }}
        >
          {preview.label}
        </div>
      )}
    </div>
  );
}

function Grip({ row }: { row: Row }) {
  const g = useGantt();
  if (!g.editable || row.kind === 'add') return <span className="w-4" />;
  return (
    <span
      className="flex w-4 cursor-grab select-none items-center justify-center text-muted opacity-0 group-hover:opacity-100 active:cursor-grabbing"
      onPointerDown={(e) => g.actions.startRowDrag(e, row)}
      title="Drag to reorder (or Alt+↑/↓ in the title)"
      aria-hidden="true"
    >
      ⋮⋮
    </span>
  );
}

function Chevron({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" tabIndex={-1} className="w-5 text-xs text-muted hover:text-fg" onClick={onClick} aria-expanded={open} aria-label={label}>
      {open ? '▾' : '▸'}
    </button>
  );
}

function stepParentCatalogId(row: Row): string | null {
  if (row.kind === 'subtask') return row.parent.catalogItemId;
  if (row.kind === 'add' && row.parent) return row.parent.catalogItemId;
  return null;
}

function TaskCells({ row }: { row: Extract<Row, { kind: 'task' | 'subtask' }> }) {
  const g = useGantt();
  const t = row.task;
  const isSub = row.kind === 'subtask';
  const a = g.actions;
  const arrow = (col: ColKey) => (d: -1 | 1) => a.moveFocus(row.key, col, d);
  const span = row.own;
  const shownDays = row.kind === 'task' && row.hasChildren ? days(row.rollup) : days(span ?? (isSub ? row.inherited : null));
  const inherited = isSub && !row.own && row.inherited;
  const cells: Record<ColKey, React.ReactNode> = {
    grip: null,
    title: (
      <div className={`flex h-full min-w-0 items-center ${isSub ? 'pl-5' : ''}`}>
        {isSub && <span className={`mr-1 h-full w-3 shrink-0 border-l border-line-strong ${row.isLast ? 'h-1/2 self-start border-b rounded-bl' : ''}`} aria-hidden="true" />}
        {row.kind === 'task' && row.hasChildren ? (
          <Chevron open={!row.collapsed} onClick={() => a.toggleTask(t.id)} label={row.collapsed ? 'Show sub-tasks' : 'Hide sub-tasks'} />
        ) : (
          !isSub && <span className="w-5" />
        )}
        <TitleCombobox
          value={t.title}
          level={isSub ? 'subtask' : 'task'}
          category={t.category}
          parentCatalogId={stepParentCatalogId(row)}
          catalog={g.catalog}
          editable={g.editable}
          cellId={cellId(row.key, 'title')}
          className={`cell-input ${row.kind === 'task' ? 'font-medium' : ''} ${t.done ? 'text-muted line-through' : ''}`}
          onCommit={(title) => a.patch(t.id, { title, catalogItemId: null })}
          onPick={(item: CatalogItemDto) => a.patch(t.id, { title: item.name, catalogItemId: item.id })}
          onSaveNew={(name) => a.askNew({ name, projectId: t.projectId, category: t.category, parent: isSub ? row.parent : null, taskId: t.id })}
          onEnter={(mod) => {
            if (mod && !isSub) a.focusCell(`a:${t.id}`, 'title');
            else a.focusCell(`a:${isSub ? row.parent.id : t.projectId}`, 'title');
          }}
          onArrow={arrow('title')}
          onAltArrow={(d) => a.reorder(row, d)}
        />
        {g.editable && (
          <span className="flex shrink-0 items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
            {!isSub && (
              <button type="button" tabIndex={-1} className="rounded px-1 text-xs text-brand-purple hover:bg-brand-purple/10" title="Add a sub-task (Ctrl+Enter)" onClick={() => a.focusCell(`a:${t.id}`, 'title')}>
                +sub
              </button>
            )}
            <button type="button" tabIndex={-1} className="rounded px-1 text-muted hover:bg-surface-3 hover:text-fg" title="Details, notes, delete" onClick={() => a.openDrawer(t.id)}>
              ⋯
            </button>
          </span>
        )}
      </div>
    ),
    cat: isSub ? (
      <span className="flex h-full items-center pl-2.5" title="Sub-tasks use their task's category">
        <CategoryDot category={t.category} className="opacity-50" />
      </span>
    ) : (
      <CategoryCell value={t.category} editable={g.editable} onChange={(category) => a.patch(t.id, { category: category as TaskDto['category'] })} cellId={cellId(row.key, 'cat')} onArrow={arrow('cat')} />
    ),
    owner: (
      <OwnerCell
        value={t.assigneeId}
        inheritedName={isSub && row.parent.assigneeId ? g.people.name(row.parent.assigneeId) : null}
        owners={g.people.owners}
        nameOf={g.people.name}
        editable={g.editable}
        onChange={(assigneeId) => a.patch(t.id, { assigneeId })}
        cellId={cellId(row.key, 'owner')}
        onArrow={arrow('owner')}
      />
    ),
    start: (
      <DateCell
        label="Start"
        value={inherited ? inherited.start : span?.start ?? null}
        muted={!!inherited || !!t.dependsOnId}
        editable={g.editable && !t.dependsOnId}
        onCommit={(startDate) => a.patch(t.id, { startDate })}
        cellId={cellId(row.key, 'start')}
        onArrow={arrow('start')}
      />
    ),
    end: (
      <DateCell
        label="End"
        value={inherited ? inherited.end : span?.end ?? null}
        muted={!!inherited}
        danger={row.overdue || (row.kind === 'task' && row.childOutside)}
        editable={g.editable}
        plusBase={span?.start ?? null}
        plusIsLength
        onCommit={(endDate) => a.patch(t.id, { endDate })}
        cellId={cellId(row.key, 'end')}
        onArrow={arrow('end')}
      />
    ),
    days:
      row.kind === 'task' && row.hasChildren ? (
        <span className="block px-2 text-right text-xs tabular-nums text-muted" title="Working days from the first to the last of its sub-tasks">{shownDays ?? ''}</span>
      ) : (
        <DaysCell
          value={span ? days(span) : t.plannedDays}
          muted={!span}
          editable={g.editable}
          title={span ? 'Working days (Sundays off). Type a new length to move the end.' : t.plannedDays ? 'Planned working days: they set the end once it has a start' : 'Working days'}
          onCommit={(plannedDays) => a.patch(t.id, { plannedDays })}
          cellId={cellId(row.key, 'days')}
          onArrow={arrow('days')}
        />
      ),
    dep: (
      <DependencyCell
        value={t.dependsOnId}
        valueLabel={depLabel(g.tasks, t.dependsOnId)}
        options={() => depOptions(g.tasks, t)}
        editable={g.editable}
        onChange={(dependsOnId) => a.patch(t.id, { dependsOnId })}
        cellId={cellId(row.key, 'dep')}
        onArrow={arrow('dep')}
      />
    ),
    done: (
      <DoneCell
        done={t.done}
        editable={g.editable}
        partial={row.kind === 'task' && row.hasChildren ? `${row.doneCount}/${row.childCount} sub-tasks done` : undefined}
        onChange={(done) => {
          if (row.kind === 'task' && row.hasChildren && !done && !window.confirm(`Reopen "${t.title}" and all ${row.childCount} of its sub-tasks?`)) return;
          a.patch(t.id, { done });
        }}
        cellId={cellId(row.key, 'done')}
        onArrow={arrow('done')}
      />
    ),
  };
  return (
    <>
      {g.cols.map((c) =>
        c.key === 'grip' ? (
          <div key="grip" className="flex shrink-0 items-center" style={{ width: c.w }}>
            <Grip row={row} />
          </div>
        ) : (
          <div key={c.key} className={`flex h-full shrink-0 items-center border-l border-line/70 *:w-full ${c.key === 'title' ? 'min-w-0 border-l-0' : ''}`} style={{ width: c.w }}>
            {cells[c.key]}
          </div>
        ),
      )}
    </>
  );
}

function ProjectCells({ row }: { row: Extract<Row, { kind: 'project' }> }) {
  const g = useGantt();
  const p = row.project;
  const rest = g.leftW - (g.cols[0]?.w ?? 0);
  return (
    <>
      <div className="flex shrink-0 items-center" style={{ width: g.cols[0]?.w }}>
        <Grip row={row} />
        <Chevron open={!row.collapsed} onClick={() => g.actions.toggleProject(p.id)} label={row.collapsed ? 'Expand project' : 'Collapse project'} />
      </div>
      <div className="flex min-w-0 items-center gap-2 pr-2" style={{ width: rest }}>
        <button type="button" tabIndex={-1} className="truncate text-left text-sm font-semibold hover:text-brand-purple" onClick={() => g.actions.toggleProject(p.id)} title={p.notes || p.name}>
          {p.name}
        </button>
        {p.status === 'on_hold' && <span className="chip bg-brand-yellow/30 text-warn-fg">On hold</span>}
        <span className="truncate text-xs text-muted">{[p.client, p.location].filter(Boolean).join(' · ')}</span>
        <span className="ml-auto shrink-0 text-xs text-muted tabular-nums">
          {row.taskCount} {row.taskCount === 1 ? 'item' : 'items'}
          {row.overdueCount > 0 && <span className="ml-1.5 font-semibold text-brand-red">{row.overdueCount} overdue</span>}
        </span>
        {g.editable && (
          <>
            <button
              type="button"
              tabIndex={-1}
              className="shrink-0 rounded px-1.5 text-xs font-medium text-brand-purple opacity-0 hover:bg-brand-purple/10 group-hover:opacity-100"
              onClick={() => g.actions.importQuote(p)}
              title={p.boqQuoteNo ? `Add tasks from quote ${p.boqQuoteNo}` : 'Add tasks from a BOQ quote'}
            >
              ⇣ From quote
            </button>
            <button
              type="button"
              tabIndex={-1}
              className="shrink-0 rounded px-1.5 text-xs font-medium text-brand-purple opacity-0 hover:bg-brand-purple/10 group-hover:opacity-100"
              onClick={() => g.actions.focusCell(`a:${p.id}`, 'title')}
            >
              + Task
            </button>
          </>
        )}
      </div>
    </>
  );
}

function AddCells({ row }: { row: Extract<Row, { kind: 'add' }> }) {
  const g = useGantt();
  const isSub = !!row.parent;
  const a = g.actions;
  const title = g.cols.find((c) => c.key === 'title')!;
  const before = g.cols[0]!.w;
  const free = (text: string) => {
    // Typed, not picked: an exact Task List name is used as if picked; anything new asks how its days work.
    const name = text.trim().toLowerCase();
    const known = isSub
      ? g.catalog.find((c) => c.parentId && c.parentId === row.parent!.catalogItemId && c.name.toLowerCase() === name)
      : g.catalog.find((c) => !c.parentId && c.name.toLowerCase() === name);
    if (known) return create(known.name, known.id, known.category);
    a.askNew({ name: text.trim(), projectId: row.project.id, category: isSub ? row.parent!.category : a.lastCategory(), parent: row.parent });
  };
  const create = (title: string, catalogItemId: string | null, category?: string) => {
    a.create({
      projectId: row.project.id,
      parentId: row.parent?.id ?? null,
      title,
      catalogItemId,
      ...(isSub ? {} : { category: (category ?? a.lastCategory()) as TaskDto['category'] }),
    });
  };
  return (
    <>
      <div className="shrink-0" style={{ width: before }} />
      <div className={`flex h-full min-w-0 items-center ${isSub ? 'pl-5' : 'pl-5'}`} style={{ width: title.w }}>
        {isSub && <span className="mr-1 h-1/2 w-3 shrink-0 self-start rounded-bl border-b border-l border-dashed border-line-strong" aria-hidden="true" />}
        <TitleCombobox
          value=""
          level={isSub ? 'subtask' : 'task'}
          category={isSub ? row.parent!.category : a.lastCategory()}
          parentCatalogId={stepParentCatalogId(row)}
          catalog={g.catalog}
          editable
          clearOnCommit
          placeholder={isSub ? '+ Add sub-task' : '+ Add task (type, or pick from the Task Lists)'}
          className="cell-input text-sm placeholder:text-brand-purple/80"
          cellId={cellId(row.key, 'title')}
          onCommit={free}
          onPick={(item) => create(item.name, item.id, item.category)}
          onSaveNew={free}
          onArrow={(d) => a.moveFocus(row.key, 'title', d)}
        />
      </div>
    </>
  );
}

export const GanttRowView = memo(function GanttRowView({ row, top, preview, flash }: { row: Row; top: number; preview: RowPreview | undefined; flash: boolean }) {
  const g = useGantt();
  const bg = row.kind === 'project' ? 'bg-surface-3' : 'bg-surface';
  return (
    <div className={`group absolute left-0 flex border-b border-line ${flash ? 'row-flash' : ''}`} style={{ top, height: ROW_H, width: g.leftW + g.laneW }} data-row={row.key}>
      <div className={`sticky left-0 z-10 flex h-full shrink-0 items-center border-r border-line-strong ${bg} group-hover:bg-surface-2 ${flash ? 'row-flash' : ''}`} style={{ width: g.leftW }}>
        {row.kind === 'project' && <ProjectCells row={row} />}
        {(row.kind === 'task' || row.kind === 'subtask') && <TaskCells row={row} />}
        {row.kind === 'add' && <AddCells row={row} />}
      </div>
      <Lane row={row} preview={preview} />
    </div>
  );
});
