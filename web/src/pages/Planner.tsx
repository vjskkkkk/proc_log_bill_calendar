import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CATEGORIES, CATEGORY_COLOR, CATEGORY_SHORT, type Category } from '@shared/categories';
import type { CreateTaskInput, PatchTaskInput, ProjectDto, TaskDto } from '@shared/schemas/plan';
import { addDays, diffDays, formatShort, maxDate, minDate, type IsoDate } from '@shared/schedule/dates';
import { buildRows, filtersActive, type RowFilters } from '@shared/schedule/rows';
import { ownSpan, type Span } from '@shared/schedule/spans';
import { dateAtX, dayCount, sundayOffset, timelineRange, xOf, ZOOM_PX, type Zoom } from '@shared/schedule/timeline';
import { canEdit, type UserPublic } from '@shared/types';
import { useCatalog } from '../api/catalog';
import { useCreateTask, useDeleteTask, usePatchTask, usePlan, useReorderProjects, useReorderTasks, useShiftTask } from '../api/plan';
import { GanttContext, type DragMode, type GanttActions, type GanttCtx, type NewTaskRequest, type Row } from '../components/gantt/GanttContext';
import { GanttHeader } from '../components/gantt/GanttHeader';
import { depLabel, GanttRowView, type RowPreview } from '../components/gantt/GanttRow';
import { columns, HEADER_H, leftWidth, OVERSCAN, ROW_H, type ColKey } from '../components/gantt/layout';
import { NewTaskDialog } from '../components/gantt/NewTaskDialog';
import { TaskDrawer } from '../components/gantt/TaskDrawer';
import { NewProjectDialog } from '../components/projects/NewProjectDialog';
import { ImportQuoteDialog } from '../components/projects/QuoteImport';
import { Seg } from '../components/ui';
import { usePeople } from '../lib/people';
import { readPref, writePref } from '../lib/prefs';
import { projectColorMap } from '../lib/projectColors';
import { toast } from '../lib/toast';
import { useTodayIST } from './Today';

interface DragState {
  row: Row;
  taskId: string;
  mode: DragMode;
  /** A dependent row's start is set by what it waits for: only its end can be dragged. */
  locked: string | null;
  startClientX: number;
  startScroll: number;
  span: Span | null;
  anchor: IsoDate | null;
  moved: boolean;
  days: number;
  preview: Span | null;
  lastClientX: number;
}

interface RowDragState {
  row: Row;
  siblings: Row[];
  from: number;
  to: number;
  startY: number;
}

function siblingRows(rows: Row[], row: Row): Row[] {
  if (row.kind === 'project') return rows.filter((r) => r.kind === 'project');
  if (row.kind === 'task') return rows.filter((r) => r.kind === 'task' && r.project.id === row.project.id);
  if (row.kind === 'subtask') return rows.filter((r) => r.kind === 'subtask' && r.parent.id === row.parent.id);
  return [];
}

const label = (s: Span) => `${formatShort(s.start)} → ${formatShort(s.end)} · ${diffDays(s.start, s.end) + 1} d`;

export default function PlannerPage({ user }: { user: UserPublic }) {
  const plan = usePlan('open');
  const catalog = useCatalog();
  const today = useTodayIST();
  const editable = canEdit(user.role);
  const people = usePeople(plan.data?.people);
  const [params, setParams] = useSearchParams();

  // ---- view state (remembered per browser) ----
  const [zoom, setZoomState] = useState<Zoom>(() => readPref('planner.zoom', 'day'));
  const [compact, setCompact] = useState<boolean>(() => readPref('planner.compact', false));
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => new Set(readPref<string[]>('planner.collapsedProjects', [])));
  const [collapsedTasks, setCollapsedTasks] = useState<Set<string>>(() => new Set(readPref<string[]>('planner.collapsedTasks', [])));
  const [activeOnly, setActiveOnly] = useState<boolean>(() => readPref('planner.activeOnly', false));
  const [filters, setFilters] = useState<RowFilters>(() => ({ unscheduledOnly: params.get('unscheduled') === '1' }));
  const [forcedAdd, setForcedAdd] = useState<Set<string>>(new Set());
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [newTask, setNewTask] = useState<NewTaskRequest | null>(null);
  const [importing, setImporting] = useState<ProjectDto | null>(null);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const lastCategory = useRef<string>(readPref('planner.lastCategory', 'material'));

  const setZoom = (z: Zoom) => {
    const el = scroller.current;
    // Keep the date at the centre of the view when zooming.
    const centre = el ? dateAtX(el.scrollLeft + (el.clientWidth - leftW) / 2, range.start, px) : null;
    setZoomState(z);
    writePref('planner.zoom', z);
    if (centre) pendingCentre.current = centre;
  };
  useEffect(() => writePref('planner.compact', compact), [compact]);
  useEffect(() => writePref('planner.collapsedProjects', [...collapsedProjects]), [collapsedProjects]);
  useEffect(() => writePref('planner.collapsedTasks', [...collapsedTasks]), [collapsedTasks]);
  useEffect(() => writePref('planner.activeOnly', activeOnly), [activeOnly]);

  const px = ZOOM_PX[zoom];
  const cols = useMemo(() => columns(compact), [compact]);
  const leftW = leftWidth(cols);

  // ---- rows ----
  const projects = useMemo(() => (plan.data?.projects ?? []).filter((p) => !activeOnly || p.status === 'active'), [plan.data, activeOnly]);
  const rows: Row[] = useMemo(() => {
    if (!plan.data) return [];
    const built = buildRows<ProjectDto, TaskDto>(projects, plan.data.tasks, { today, collapsedProjects, collapsedTasks, filters, addRows: editable });
    if (!forcedAdd.size || filtersActive(filters)) return built;
    // "+sub" on a task without sub-tasks opens an add-sub-task row right under it.
    const out: Row[] = [];
    for (const r of built) {
      out.push(r);
      if (r.kind === 'task' && !r.hasChildren && forcedAdd.has(r.task.id)) out.push({ kind: 'add', key: `a:${r.task.id}`, project: r.project, parent: r.task });
    }
    return out;
  }, [plan.data, projects, today, collapsedProjects, collapsedTasks, filters, editable, forcedAdd]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const range = useMemo(() => {
    const spans: (Span | null)[] = [];
    for (const t of plan.data?.tasks ?? []) spans.push(ownSpan(t));
    return timelineRange(spans, today);
  }, [plan.data, today]);
  const laneW = dayCount(range) * px;

  // ---- scrolling & virtualisation ----
  const scroller = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 800 });
  const pendingCentre = useRef<IsoDate | null>(null);
  const didInitialScroll = useRef(false);
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const top = el.scrollTop;
    setViewport((v) => (Math.abs(v.top - top) >= ROW_H * 4 || v.height !== el.clientHeight ? { top, height: el.clientHeight } : v));
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport({ top: el.scrollTop, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scrollToDate = useCallback(
    (d: IsoDate, at = 0.25) => {
      const el = scroller.current;
      if (!el) return;
      el.scrollLeft = Math.max(0, xOf(d, range.start, px) - (el.clientWidth - leftW) * at);
    },
    [range.start, px, leftW],
  );
  useLayoutEffect(() => {
    if (pendingCentre.current) {
      scrollToDate(pendingCentre.current, 0.5);
      pendingCentre.current = null;
    }
  }, [px, scrollToDate]);
  useLayoutEffect(() => {
    if (!didInitialScroll.current && plan.data && scroller.current) {
      didInitialScroll.current = true;
      if (!params.get('focus')) scrollToDate(today);
    }
  }, [plan.data, scrollToDate, today, params]);

  const first = Math.max(0, Math.floor((viewport.top - HEADER_H) / ROW_H) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((viewport.top + viewport.height) / ROW_H) + OVERSCAN);

  // ---- focus ----
  const focusCell = useCallback((rowKey: string, col: ColKey) => {
    const el = scroller.current;
    let idx = rowsRef.current.findIndex((r) => r.key === rowKey);
    if (idx < 0 && rowKey.startsWith('a:')) {
      // The add row may not exist yet: a collapsed project, or a task without sub-tasks.
      const id = rowKey.slice(2);
      setCollapsedProjects((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : s));
      setCollapsedTasks((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : s));
      setForcedAdd((s) => new Set(s).add(id));
    }
    const attempt = (tries: number) => {
      idx = rowsRef.current.findIndex((r) => r.key === rowKey);
      if (el && idx >= 0) {
        const top = HEADER_H + idx * ROW_H;
        if (top < el.scrollTop + HEADER_H || top + ROW_H > el.scrollTop + el.clientHeight) {
          el.scrollTop = Math.max(0, top - el.clientHeight / 3);
          setViewport({ top: el.scrollTop, height: el.clientHeight });
        }
      }
      requestAnimationFrame(() => {
        const input = document.querySelector<HTMLElement>(`[data-cell="${CSS.escape(`${rowKey}|${col}`)}"]`);
        if (input) input.focus();
        else if (tries > 0) setTimeout(() => attempt(tries - 1), 30);
      });
    };
    attempt(6);
  }, []);

  const moveFocus = useCallback(
    (rowKey: string, col: ColKey, delta: number) => {
      const list = rowsRef.current;
      let i = list.findIndex((r) => r.key === rowKey) + delta;
      while (i >= 0 && i < list.length) {
        const r = list[i]!;
        const has = r.kind === 'add' ? col === 'title' : r.kind === 'project' ? false : !(r.kind === 'subtask' && col === 'cat');
        if (has) return focusCell(r.key, col);
        i += delta;
      }
    },
    [focusCell],
  );

  // ---- mutations ----
  const patchTask = usePatchTask(user.id);
  const createTask = useCreateTask();
  const deleteTask = useDeleteTask();
  const shiftTask = useShiftTask();
  const reorderTasks = useReorderTasks();
  const reorderProjects = useReorderProjects();

  const reorderTo = useCallback(
    (row: Row, siblings: Row[], to: number) => {
      const from = siblings.findIndex((s) => s.key === row.key);
      if (from < 0 || to === from || to < 0 || to >= siblings.length) return;
      const order = [...siblings];
      order.splice(to, 0, ...order.splice(from, 1));
      if (row.kind === 'project') reorderProjects.mutate(order.map((r) => (r as Extract<Row, { kind: 'project' }>).project.id));
      else if (row.kind === 'task' || row.kind === 'subtask') {
        const ids = order.map((r) => (r as Extract<Row, { kind: 'task' | 'subtask' }>).task.id);
        reorderTasks.mutate({ projectId: row.task.projectId, parentId: row.task.parentId, ids });
      }
    },
    [reorderProjects, reorderTasks],
  );

  // ---- bar dragging ----
  const drag = useRef<DragState | null>(null);
  const [preview, setPreview] = useState<{ key: string; preview: RowPreview } | null>(null);
  const raf = useRef<number | null>(null);

  const laneX = (clientX: number) => {
    const el = scroller.current!;
    return clientX - el.getBoundingClientRect().left + el.scrollLeft - leftW;
  };

  const recompute = useCallback(() => {
    const s = drag.current;
    const el = scroller.current;
    if (!s || !el) return;
    const dx = s.lastClientX - s.startClientX + (el.scrollLeft - s.startScroll);
    if (!s.moved && Math.abs(dx) < 3) return;
    s.moved = true;
    if (s.locked) return;
    let next: Span | null = null;
    if (s.mode === 'draw') {
      const cur = dateAtX(laneX(s.lastClientX), range.start, px);
      next = { start: minDate(s.anchor!, cur), end: maxDate(s.anchor!, cur) };
    } else if (s.span) {
      const d = Math.round(dx / px);
      s.days = d;
      if (s.mode === 'move' || s.mode === 'shift') next = { start: addDays(s.span.start, d), end: addDays(s.span.end, d) };
      else if (s.mode === 'start') next = { start: minDate(addDays(s.span.start, d), s.span.end), end: s.span.end };
      else next = { start: s.span.start, end: maxDate(addDays(s.span.end, d), s.span.start) };
    }
    s.preview = next;
    if (next) setPreview({ key: s.row.key, preview: { span: next, label: label(next) } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.start, px, leftW]);

  const endDrag = useCallback(
    (commit: boolean) => {
      const s = drag.current;
      drag.current = null;
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = null;
      setPreview(null);
      document.body.style.userSelect = '';
      if (!s) return;
      if (!s.moved) {
        if (commit && s.mode !== 'draw') setDrawerId(s.taskId);
        return;
      }
      if (s.locked) {
        if (commit) toast(`"${s.row.kind === 'task' || s.row.kind === 'subtask' ? s.row.task.title : ''}" starts after "${s.locked}" ends. Drag its right end to change its length, or make it Independent (Waits for) to move it freely.`);
        return;
      }
      if (!commit || !editable || !s.preview) return;
      const p = s.preview;
      if (s.mode === 'shift') {
        if (s.days) shiftTask.mutate({ id: s.taskId, days: s.days });
      } else if (!s.span || p.start !== s.span.start || p.end !== s.span.end || (s.row.kind === 'subtask' && !s.row.own)) {
        patchTask.mutate({ id: s.taskId, patch: { startDate: p.start, endDate: p.end } });
      }
    },
    [editable, patchTask, shiftTask],
  );

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!drag.current) return;
      drag.current.lastClientX = e.clientX;
      recompute();
    };
    const up = () => drag.current && endDrag(true);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && drag.current && endDrag(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', key);
    };
  }, [recompute, endDrag]);

  const startDrag = useCallback(
    (e: React.PointerEvent, row: Row, mode: DragMode) => {
      if (e.button !== 0 || (row.kind !== 'task' && row.kind !== 'subtask')) return;
      if (!editable) {
        setDrawerId(row.task.id);
        return;
      }
      e.preventDefault();
      const span = row.kind === 'subtask' ? row.own ?? row.inherited : row.own;
      const waitsFor = row.task.dependsOnId && mode !== 'end' ? depLabel(plan.data?.tasks ?? [], row.task.dependsOnId) ?? 'another task' : null;
      drag.current = {
        row,
        taskId: row.task.id,
        mode,
        locked: waitsFor,
        startClientX: e.clientX,
        startScroll: scroller.current!.scrollLeft,
        span,
        anchor: mode === 'draw' ? dateAtX(laneX(e.clientX), range.start, px) : null,
        moved: false,
        days: 0,
        preview: null,
        lastClientX: e.clientX,
      };
      document.body.style.userSelect = 'none';
      // Auto-scroll near the edges while dragging.
      const tick = () => {
        const s = drag.current;
        const el = scroller.current;
        if (!s || !el) return;
        const r = el.getBoundingClientRect();
        const v = s.lastClientX > r.right - 48 ? 14 : s.lastClientX < r.left + leftW + 48 ? -14 : 0;
        if (v && s.moved) {
          el.scrollLeft += v;
          recompute();
        }
        raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [editable, range.start, px, leftW, recompute, plan.data],
  );

  // ---- row reordering (grip) ----
  const rowDrag = useRef<RowDragState | null>(null);
  const [dropLine, setDropLine] = useState<number | null>(null);
  const startRowDrag = useCallback(
    (e: React.PointerEvent, row: Row) => {
      if (!editable || filtersActive(filters)) {
        if (filtersActive(filters)) toast('Clear the filters to reorder rows');
        return;
      }
      e.preventDefault();
      const siblings = siblingRows(rowsRef.current, row);
      const from = siblings.findIndex((s) => s.key === row.key);
      rowDrag.current = { row, siblings, from, to: from, startY: e.clientY };
      document.body.style.userSelect = 'none';
      const bodyY = (clientY: number) => clientY - scroller.current!.getBoundingClientRect().top + scroller.current!.scrollTop - HEADER_H;
      const move = (ev: PointerEvent) => {
        const s = rowDrag.current;
        if (!s) return;
        const y = bodyY(ev.clientY);
        const idxOf = (r: Row) => rowsRef.current.findIndex((x) => x.key === r.key);
        let to = 0;
        s.siblings.forEach((sib, i) => {
          if (y > (idxOf(sib) + 0.5) * ROW_H) to = i + (i >= s.from ? 0 : 1);
        });
        to = Math.max(0, Math.min(s.siblings.length - 1, to));
        s.to = to;
        const target = s.siblings[to]!;
        const ti = idxOf(target);
        setDropLine((to > s.from ? ti + 1 : ti) * ROW_H);
      };
      const up = () => {
        const s = rowDrag.current;
        rowDrag.current = null;
        setDropLine(null);
        document.body.style.userSelect = '';
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (s && s.to !== s.from) reorderTo(s.row, s.siblings, s.to);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [editable, filters, reorderTo],
  );

  // ---- actions for rows ----
  const actions: GanttActions = useMemo(
    () => ({
      patch: (id: string, patch: PatchTaskInput) => {
        patchTask.mutate(
          { id, patch },
          {
            onSuccess: (ch) => {
              const added = ch.tasks.filter((t) => t.parentId === id && !rowsRef.current.some((r) => (r.kind === 'subtask' || r.kind === 'task') && r.task.id === t.id));
              if (patch.catalogItemId && added.length) toast(`Added ${added.length} standard sub-tasks`, { tone: 'ok' });
            },
          },
        );
        if (patch.category) {
          lastCategory.current = patch.category;
          writePref('planner.lastCategory', patch.category);
        }
      },
      create: (input: Omit<CreateTaskInput, 'id'>) => {
        const id = crypto.randomUUID();
        if (input.category) {
          lastCategory.current = input.category;
          writePref('planner.lastCategory', input.category);
        }
        createTask.mutate(
          { ...input, id },
          {
            onSuccess: (ch) => {
              const steps = ch.tasks.filter((t) => t.parentId === id).length;
              if (steps) toast(`Added "${input.title}" with ${steps} standard sub-tasks`, { tone: 'ok', action: { label: 'Undo', run: () => deleteTask.mutate(id) } });
              if (input.parentId) setForcedAdd((s) => (s.has(input.parentId!) ? new Set([...s].filter((x) => x !== input.parentId)) : s));
            },
          },
        );
        return id;
      },
      remove: (task: TaskDto) => deleteTask.mutate(task.id),
      toggleProject: (id: string) =>
        setCollapsedProjects((s) => {
          const n = new Set(s);
          if (n.has(id)) n.delete(id);
          else n.add(id);
          return n;
        }),
      toggleTask: (id: string) =>
        setCollapsedTasks((s) => {
          const n = new Set(s);
          if (n.has(id)) n.delete(id);
          else n.add(id);
          return n;
        }),
      openDrawer: (id: string) => setDrawerId(id),
      moveFocus,
      focusCell,
      reorder: (row: Row, delta: -1 | 1) => {
        if (filtersActive(filters)) return toast('Clear the filters to reorder rows');
        const sibs = siblingRows(rowsRef.current, row);
        const i = sibs.findIndex((s) => s.key === row.key);
        reorderTo(row, sibs, i + delta);
        setTimeout(() => focusCell(row.key, 'title'), 50);
      },
      startDrag,
      startRowDrag,
      lastCategory: () => lastCategory.current,
      askNew: setNewTask,
      importQuote: setImporting,
      jumpTo: (date: IsoDate) => scrollToDate(addDays(date, -2), 0.02),
    }),
    [patchTask, createTask, deleteTask, moveFocus, focusCell, filters, reorderTo, startDrag, startRowDrag, scrollToDate],
  );
  const projectColors = useMemo(() => projectColorMap((plan.data?.projects ?? []).map((p) => p.id)), [plan.data?.projects]);

  const ctx: GanttCtx = useMemo(
    () => ({ px, origin: range.start, today, cols, leftW, laneW, editable, people, catalog: catalog.data ?? [], tasks: plan.data?.tasks ?? [], projectColors, actions }),
    [px, range.start, today, cols, leftW, laneW, editable, people, catalog.data, plan.data, projectColors, actions],
  );

  // ---- ?focus=<taskId> | project:<id> (from Today / Projects) ----
  const focusParam = params.get('focus');
  useEffect(() => {
    if (!focusParam || !plan.data) return;
    let key: string | null = null;
    let date: IsoDate | null = null;
    if (focusParam.startsWith('project:')) {
      const id = focusParam.slice(8);
      setCollapsedProjects((s) => new Set([...s].filter((x) => x !== id)));
      key = `p:${id}`;
      const spans = plan.data.tasks.filter((t) => t.projectId === id).map(ownSpan).filter(Boolean) as Span[];
      date = spans.length ? spans.reduce((a, b) => (a.start < b.start ? a : b)).start : today;
    } else {
      const t = plan.data.tasks.find((x) => x.id === focusParam);
      if (t) {
        setCollapsedProjects((s) => new Set([...s].filter((x) => x !== t.projectId)));
        if (t.parentId) setCollapsedTasks((s) => new Set([...s].filter((x) => x !== t.parentId)));
        key = `${t.parentId ? 's' : 't'}:${t.id}`;
        const parent = t.parentId ? plan.data.tasks.find((x) => x.id === t.parentId) : null;
        date = t.startDate ?? parent?.startDate ?? today;
      }
    }
    setFilters({});
    const k = key;
    const d = date;
    setTimeout(() => {
      const idx = rowsRef.current.findIndex((r) => r.key === k);
      const el = scroller.current;
      if (el && idx >= 0) {
        el.scrollTop = Math.max(0, HEADER_H + idx * ROW_H - el.clientHeight / 3);
        setViewport({ top: el.scrollTop, height: el.clientHeight });
      }
      if (d) scrollToDate(addDays(d, -3), 0.1);
      setFlashKey(k);
      if (focusParam.startsWith('project:') && editable) setTimeout(() => focusCell(`a:${focusParam.slice(8)}`, 'title'), 120);
    }, 60);
    const next = new URLSearchParams(params);
    next.delete('focus');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusParam, plan.data]);
  useEffect(() => {
    if (!flashKey) return;
    const t = setTimeout(() => setFlashKey(null), 1700);
    return () => clearTimeout(t);
  }, [flashKey]);

  // Keyboard: "/" search, "t" today.
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === '/') {
        e.preventDefault();
        search.current?.focus();
      } else if (e.key === 't') scrollToDate(today);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scrollToDate, today]);

  const drawerTask = drawerId ? plan.data?.tasks.find((t) => t.id === drawerId) : undefined;
  const todayX = today >= range.start && today <= range.end ? xOf(today, range.start, px) : null;
  const catFilter = new Set(filters.categories ?? []);
  const toggleCat = (c: Category) => {
    const n = new Set(catFilter);
    if (n.has(c)) n.delete(c);
    else n.add(c);
    setFilters({ ...filters, categories: [...n] });
  };
  const anyFilter = filtersActive(filters);

  // Grid background: day lines (day zoom) or Monday lines (week zoom), and Sunday stripes.
  const sun = sundayOffset(range.start) * px;
  const lines =
    zoom === 'day'
      ? { image: 'linear-gradient(to right, var(--color-line) 0 1px, transparent 1px)', size: `${px}px 100%`, pos: '0 0' }
      : zoom === 'week'
        ? { image: 'linear-gradient(to right, var(--color-line) 0 1px, transparent 1px)', size: `${7 * px}px 100%`, pos: `${((sundayOffset(range.start) + 1) % 7) * px}px 0` }
        : null;
  const sundayBg = `linear-gradient(to right, color-mix(in srgb, var(--color-fg) 5%, transparent) 0 ${px}px, transparent ${px}px)`;
  const bgImage = [sundayBg, lines?.image].filter(Boolean).join(', ');
  const bgSize = [`${7 * px}px 100%`, lines?.size].filter(Boolean).join(', ');
  const bgPos = [`${sun}px 0`, lines?.pos].filter(Boolean).join(', ');

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line bg-surface px-4 py-2 no-print">
        <h1 className="sr-only">Planner</h1>
        <Seg label="Zoom" value={zoom} onChange={setZoom} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
        <button type="button" className="btn-secondary min-h-8 py-0.5" onClick={() => scrollToDate(today)} title="Scroll to today (t)">
          Today
        </button>
        <div className="mx-1 h-6 w-px bg-line" />
        <input
          ref={search}
          className="input min-h-8 w-36 py-0.5 text-sm"
          placeholder="Search…  ( / )"
          value={filters.search ?? ''}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
        />
        <div className="flex items-center gap-1" role="group" aria-label="Categories">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={catFilter.has(c)}
              onClick={() => toggleCat(c)}
              className={`chip border transition-colors ${catFilter.has(c) ? 'border-transparent text-white' : 'border-line-strong bg-surface text-muted-strong hover:bg-surface-3'}`}
              style={catFilter.has(c) ? { backgroundColor: CATEGORY_COLOR[c].bg, color: CATEGORY_COLOR[c].text } : undefined}
            >
              <span className="inline-block h-2.5 w-2.5" style={{ backgroundColor: CATEGORY_COLOR[c].bg }} />
              {CATEGORY_SHORT[c]}
            </button>
          ))}
        </div>
        <select
          className="input min-h-8 w-32 py-0.5 text-sm"
          value={filters.ownerId ?? '*'}
          onChange={(e) => setFilters({ ...filters, ownerId: e.target.value === '*' ? null : e.target.value })}
          aria-label="Owner"
        >
          <option value="*">Anyone</option>
          <option value={user.id}>Me</option>
          <option value="">Unassigned</option>
          {people.owners
            .filter((o) => o.id !== user.id)
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
        </select>
        <label className="inline-flex items-center gap-1.5 text-sm text-muted-strong">
          <input type="checkbox" className="accent-brand-purple" checked={!!filters.unscheduledOnly} onChange={(e) => setFilters({ ...filters, unscheduledOnly: e.target.checked })} />
          No dates
        </label>
        <label className="inline-flex items-center gap-1.5 text-sm text-muted-strong">
          <input type="checkbox" className="accent-brand-purple" checked={!!filters.hideDone} onChange={(e) => setFilters({ ...filters, hideDone: e.target.checked })} />
          Hide done
        </label>
        {anyFilter && (
          <button type="button" className="text-sm text-brand-purple hover:underline" onClick={() => setFilters({})}>
            Clear filters
          </button>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <label className="inline-flex items-center gap-1.5 text-sm text-muted-strong" title="Hide on-hold projects">
            <input type="checkbox" className="accent-brand-purple" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
            Active only
          </label>
          <button type="button" className="btn-ghost min-h-8 px-2 py-0.5" onClick={() => setCompact(!compact)} title={compact ? 'Show all columns' : 'Hide category, owner and days columns'} aria-label="Toggle columns">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d={compact ? 'M9 4v16M15 4v16' : 'M9 4v16'} />
            </svg>
          </button>
          <button
            type="button"
            className="btn-ghost min-h-8 px-2 py-0.5"
            onClick={() => (collapsedProjects.size ? setCollapsedProjects(new Set()) : setCollapsedProjects(new Set(projects.map((p) => p.id))))}
            title={collapsedProjects.size ? 'Expand all projects' : 'Collapse all projects'}
            aria-label={collapsedProjects.size ? 'Expand all projects' : 'Collapse all projects'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d={collapsedProjects.size ? 'M7 9l5 5 5-5M4 4h16M4 20h16' : 'M7 15l5-5 5 5M4 4h16M4 20h16'} />
            </svg>
          </button>
          {editable && (
            <button type="button" className="btn-primary min-h-8 py-0.5" onClick={() => setCreatingProject(true)}>
              + Project
            </button>
          )}
        </div>
      </div>

      <GanttContext.Provider value={ctx}>
        <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto bg-surface" onScroll={onScroll} data-gantt-scroller>
          <GanttHeader range={range} px={px} zoom={zoom} today={today} cols={cols} leftW={leftW} />
          <div className="relative" style={{ height: Math.max(rows.length * ROW_H, 240), minHeight: `calc(100% - ${HEADER_H}px)`, width: leftW + laneW }}>
            {/* The table side stays solid all the way down, so the chart's grid never shows through behind it. */}
            <div className="sticky left-0 z-[6] h-full border-r border-line-strong bg-surface" style={{ width: leftW }}>
              {plan.data && rows.length === 0 && (
                <div className="px-6 py-8 text-sm text-muted">
                  {anyFilter ? (
                    <>
                      Nothing matches these filters.{' '}
                      <button type="button" className="text-brand-purple hover:underline" onClick={() => setFilters({})}>
                        Clear filters
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-base font-semibold text-fg">No projects on the planner yet</p>
                      <p className="mt-1">Start a project from a BOQ quote (its tasks are drafted for you), a CRM lead, or a blank page.</p>
                      {editable && (
                        <button type="button" className="btn-primary mt-4 min-h-9 py-1" onClick={() => setCreatingProject(true)}>
                          New project
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="pointer-events-none absolute inset-y-0" style={{ left: leftW, width: laneW, backgroundImage: bgImage, backgroundSize: bgSize, backgroundPosition: bgPos, backgroundRepeat: 'repeat' }} />
            {todayX !== null && (
              <div className="pointer-events-none absolute inset-y-0 z-[5]" style={{ left: leftW + todayX, width: px }}>
                <div className="absolute inset-0 bg-brand-purple/8" />
                <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-brand-purple/70" />
              </div>
            )}
            {rows.slice(first, last).map((r, i) => (
              <GanttRowView key={r.key} row={r} top={(first + i) * ROW_H} preview={preview?.key === r.key ? preview.preview : undefined} flash={flashKey === r.key} />
            ))}
            {dropLine !== null && <div className="pointer-events-none absolute left-0 z-30 h-0.5 bg-brand-purple" style={{ top: dropLine - 1, width: leftW }} />}
          </div>
        </div>
      </GanttContext.Provider>

      {plan.isLoading && <div className="absolute inset-0 flex items-center justify-center text-muted">Loading the plan…</div>}
      {plan.isError && <div className="absolute inset-x-0 top-14 p-6 text-brand-red">Could not load the plan: {(plan.error as Error).message}</div>}

      {drawerTask && plan.data && (
        <TaskDrawer
          key={drawerTask.id}
          task={drawerTask}
          plan={plan.data}
          editable={editable}
          people={people}
          onPatch={(p) => actions.patch(drawerTask.id, p as PatchTaskInput)}
          onDelete={() => {
            deleteTask.mutate(drawerTask.id);
            setDrawerId(null);
          }}
          onOpen={setDrawerId}
          onAddSubtask={() => {
            setDrawerId(null);
            focusCell(`a:${drawerTask.id}`, 'title');
          }}
          onClose={() => setDrawerId(null)}
        />
      )}
      {creatingProject && <NewProjectDialog onClose={() => setCreatingProject(false)} />}
      {importing && <ImportQuoteDialog project={importing} onClose={() => setImporting(null)} />}
      {newTask && plan.data && (
        <NewTaskDialog
          req={newTask}
          tasks={plan.data.tasks}
          catalog={catalog.data ?? []}
          onClose={() => setNewTask(null)}
          onDone={(r) => {
            const req = newTask;
            setNewTask(null);
            if (req.taskId) {
              actions.patch(req.taskId, { title: r.title, catalogItemId: r.catalogItemId, plannedDays: r.plannedDays, ...(req.parent ? {} : { category: r.category }) });
              return;
            }
            const id = actions.create({
              projectId: req.projectId,
              parentId: req.parent?.id ?? null,
              title: r.title,
              catalogItemId: r.catalogItemId,
              plannedDays: r.plannedDays,
              dependsOnId: r.dependsOnId,
              addCatalogSteps: false,
              ...(req.parent ? {} : { category: r.category }),
              ...(r.quantities ? { quantities: r.quantities } : {}),
            });
            setTimeout(() => focusCell(`a:${req.parent?.id ?? req.projectId}`, 'title'), 80);
            void id;
          }}
        />
      )}
    </div>
  );
}
