import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  CreateProjectInput,
  CreateTaskInput,
  ImportQuoteInput,
  PatchProjectInput,
  PatchTaskInput,
  PlanDto,
  ProjectDto,
  ProjectStatus,
  TaskChanges,
  TaskDto,
} from '@shared/schemas/plan';
import { propagate } from '@shared/schedule/deps';
import { normalisePair } from '@shared/schedule/pair';
import { endAfter, workingDays } from '@shared/schedule/workdays';
import { api } from './client';
import { toast } from '../lib/toast';

/** 'open' = active + on-hold projects (Today, Planner); 'all' adds completed + archived (Projects page). */
export type PlanScope = 'open' | 'all';
const STATUSES: Record<PlanScope, ProjectStatus[]> = { open: ['active', 'on_hold'], all: ['active', 'on_hold', 'completed', 'archived'] };
export const planKey = (scope: PlanScope) => ['plan', scope] as const;

export function usePlan(scope: PlanScope = 'open') {
  return useQuery({
    queryKey: planKey(scope),
    queryFn: () => api<PlanDto>(`/api/plan?statuses=${STATUSES[scope].join(',')}`),
    staleTime: 15_000,
  });
}

/** Polls the cheap version number; refetches the plan only when someone changed it (CLAUDE.md rule 6). */
export function usePlanVersionPoll(enabled = true) {
  const qc = useQueryClient();
  const v = useQuery({
    queryKey: ['plan-version'],
    queryFn: () => api<{ version: string }>('/api/plan/version'),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    enabled,
  });
  useEffect(() => {
    if (!v.data) return;
    for (const scope of ['open', 'all'] as PlanScope[]) {
      const plan = qc.getQueryData<PlanDto>(planKey(scope));
      if (plan && plan.version !== v.data.version && !qc.isMutating()) qc.invalidateQueries({ queryKey: planKey(scope) });
    }
  }, [v.data, qc]);
}

function eachPlan(qc: QueryClient, fn: (plan: PlanDto) => PlanDto) {
  for (const scope of ['open', 'all'] as PlanScope[]) {
    qc.setQueryData<PlanDto>(planKey(scope), (old) => (old ? fn(old) : old));
  }
}

/** Patches cached plans with what the server says changed. */
export function applyTaskChanges(qc: QueryClient, ch: TaskChanges) {
  eachPlan(qc, (plan) => {
    const projectIds = new Set(plan.projects.map((p) => p.id));
    const gone = new Set(ch.deletedIds);
    const byId = new Map(plan.tasks.filter((t) => !gone.has(t.id) && !(t.parentId && gone.has(t.parentId))).map((t) => [t.id, t]));
    for (const t of ch.tasks) if (projectIds.has(t.projectId)) byId.set(t.id, t);
    return { ...plan, tasks: [...byId.values()], version: ch.version || plan.version };
  });
  if (ch.version) qc.setQueryData(['plan-version'], { version: ch.version });
}

function snapshot(qc: QueryClient) {
  return (['open', 'all'] as PlanScope[]).map((s) => [planKey(s), qc.getQueryData<PlanDto>(planKey(s))] as const);
}
function restore(qc: QueryClient, snap: ReturnType<typeof snapshot>) {
  for (const [key, data] of snap) qc.setQueryData(key, data);
}

const now = () => new Date().toISOString();

/** Re-applies dependencies in one project after a local edit (the same shared/schedule/deps.ts as the Worker). */
function withPropagation(tasks: TaskDto[], projectId: string): TaskDto[] {
  const moved = new Map(propagate(tasks.filter((t) => t.projectId === projectId)).map((c) => [c.id, c]));
  if (!moved.size) return tasks;
  return tasks.map((t) => {
    const m = moved.get(t.id);
    return m ? { ...t, startDate: m.startDate, endDate: m.endDate, plannedDays: workingDays(m.startDate, m.endDate) } : t;
  });
}

/** The local guess of a patch (the server answer replaces it). Mirrors worker/services/tasks.ts. */
function optimisticPatch(tasks: TaskDto[], id: string, p: PatchTaskInput, userId: string | undefined): TaskDto[] {
  const task = tasks.find((t) => t.id === id);
  if (!task) return tasks;
  const out = tasks.map((t) => ({ ...t }));
  const me = out.find((t) => t.id === id)!;
  if (p.dependsOnId !== undefined) me.dependsOnId = p.dependsOnId;
  if (p.title !== undefined) me.title = p.title;
  if (p.notes !== undefined) me.notes = p.notes;
  if (p.assigneeId !== undefined) me.assigneeId = p.assigneeId;
  if (p.catalogItemId !== undefined) me.catalogItemId = p.catalogItemId;
  if (p.category !== undefined && !me.parentId) {
    me.category = p.category;
    out.forEach((t) => t.parentId === id && (t.category = p.category!));
  }
  if (p.startDate !== undefined || p.endDate !== undefined) {
    if (me.plannedDays && !me.startDate && p.startDate && p.endDate === undefined) Object.assign(me, { startDate: p.startDate, endDate: endAfter(p.startDate, me.plannedDays) });
    else Object.assign(me, normalisePair(me, { ...(p.startDate !== undefined ? { startDate: p.startDate } : {}), ...(p.endDate !== undefined ? { endDate: p.endDate } : {}) }));
  } else if (p.plannedDays && me.startDate) {
    me.endDate = endAfter(me.startDate, p.plannedDays);
  }
  if (p.plannedDays !== undefined) me.plannedDays = p.plannedDays;
  if (me.startDate && me.endDate) me.plannedDays = workingDays(me.startDate, me.endDate);
  if (p.done !== undefined) {
    const mark = (t: TaskDto) => {
      t.done = p.done!;
      t.doneAt = p.done ? now() : null;
      t.doneById = p.done ? userId ?? null : null;
    };
    mark(me);
    out.forEach((t) => t.parentId === id && mark(t));
    if (me.parentId) {
      const parent = out.find((t) => t.id === me.parentId);
      const sibs = out.filter((t) => t.parentId === me.parentId);
      if (parent && sibs.length) {
        const all = sibs.every((s) => s.done);
        if (parent.done !== all) {
          parent.done = all;
          parent.doneAt = all ? now() : null;
        }
      }
    }
  }
  return withPropagation(out, me.projectId);
}

export function errorText(e: unknown): string {
  return (e as Error)?.message || 'Something went wrong';
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTaskInput) => api<TaskChanges>('/api/tasks', { method: 'POST', json: input }),
    onMutate: (input) => {
      const snap = snapshot(qc);
      eachPlan(qc, (plan) => {
        if (!plan.projects.some((p) => p.id === input.projectId)) return plan;
        const parent = input.parentId ? plan.tasks.find((t) => t.id === input.parentId) : null;
        const sibs = plan.tasks.filter((t) => t.projectId === input.projectId && t.parentId === (input.parentId ?? null));
        const after = input.afterId ? sibs.find((t) => t.id === input.afterId) : undefined;
        const sortOrder = after ? after.sortOrder + 0.5 : Math.max(0, ...sibs.map((s) => s.sortOrder)) + 1;
        const pair = normalisePair({ startDate: null, endDate: null }, { startDate: input.startDate ?? null, endDate: input.endDate ?? null });
        const t: TaskDto = {
          id: input.id,
          projectId: input.projectId,
          parentId: input.parentId ?? null,
          title: input.title,
          category: parent?.category ?? input.category ?? 'material',
          catalogItemId: input.catalogItemId ?? null,
          ...pair,
          assigneeId: input.assigneeId ?? null,
          done: false,
          doneAt: null,
          doneById: null,
          notes: input.notes ?? '',
          sortOrder,
          dependsOnId: input.dependsOnId ?? null,
          plannedDays: input.plannedDays ?? null,
          quantities: input.quantities ?? {},
          createdById: null,
          updatedById: null,
          createdAt: now(),
          updatedAt: now(),
        };
        return { ...plan, tasks: withPropagation([...plan.tasks, t], input.projectId) };
      });
      return { snap };
    },
    onError: (e, _v, ctx) => {
      if (ctx) restore(qc, ctx.snap);
      toast(errorText(e), { tone: 'error' });
    },
    onSuccess: (ch) => applyTaskChanges(qc, ch),
  });
}

export function usePatchTask(userId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: PatchTaskInput }) => api<TaskChanges>(`/api/tasks/${id}`, { method: 'PATCH', json: patch }),
    onMutate: ({ id, patch }) => {
      const snap = snapshot(qc);
      eachPlan(qc, (plan) => ({ ...plan, tasks: optimisticPatch(plan.tasks, id, patch, userId) }));
      return { snap };
    },
    onError: (e, _v, ctx) => {
      if (ctx) restore(qc, ctx.snap);
      toast(errorText(e), { tone: 'error' });
    },
    onSuccess: (ch) => applyTaskChanges(qc, ch),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<TaskChanges>(`/api/tasks/${id}`, { method: 'DELETE' }),
    onMutate: (id) => {
      const snap = snapshot(qc);
      eachPlan(qc, (plan) => ({ ...plan, tasks: plan.tasks.filter((t) => t.id !== id && t.parentId !== id) }));
      return { snap };
    },
    onError: (e, _v, ctx) => {
      if (ctx) restore(qc, ctx.snap);
      toast(errorText(e), { tone: 'error' });
    },
    onSuccess: (ch) => applyTaskChanges(qc, ch),
  });
}

export function useShiftTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, days }: { id: string; days: number }) => api<TaskChanges>(`/api/tasks/${id}/shift`, { method: 'POST', json: { days } }),
    onMutate: ({ id, days }) => {
      const snap = snapshot(qc);
      const shift = (d: string | null) => (d ? new Date(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10) : d);
      eachPlan(qc, (plan) => ({
        ...plan,
        tasks: (() => {
          const tasks = plan.tasks.map((t) => ((t.id === id || t.parentId === id) && t.startDate ? { ...t, startDate: shift(t.startDate), endDate: shift(t.endDate) } : t));
          const pid = tasks.find((t) => t.id === id)?.projectId;
          return pid ? withPropagation(tasks, pid) : tasks;
        })(),
      }));
      return { snap };
    },
    onError: (e, _v, ctx) => {
      if (ctx) restore(qc, ctx.snap);
      toast(errorText(e), { tone: 'error' });
    },
    onSuccess: (ch) => applyTaskChanges(qc, ch),
  });
}

export function useReorderTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { projectId: string; parentId: string | null; ids: string[] }) => api<TaskChanges>('/api/tasks/reorder', { method: 'POST', json: input }),
    onMutate: (input) => {
      const snap = snapshot(qc);
      const order = new Map(input.ids.map((id, i) => [id, i + 1]));
      eachPlan(qc, (plan) => ({ ...plan, tasks: plan.tasks.map((t) => (order.has(t.id) ? { ...t, sortOrder: order.get(t.id)! } : t)) }));
      return { snap };
    },
    onError: (e, _v, ctx) => {
      if (ctx) restore(qc, ctx.snap);
      toast(errorText(e), { tone: 'error' });
      qc.invalidateQueries({ queryKey: ['plan'] });
    },
    onSuccess: (ch) => applyTaskChanges(qc, ch),
  });
}

// ---- Projects ----

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) => api<{ project: ProjectDto; version: string }>('/api/projects', { method: 'POST', json: input }),
    onSuccess: (_r, input) => {
      qc.invalidateQueries({ queryKey: ['plan'] });
      if (input.import) qc.invalidateQueries({ queryKey: ['catalog'] });
    },
  });
}

/** Drafts tasks from a quote into an existing project (tasks arrive with the plan refetch). */
export function useImportQuote(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportQuoteInput) => api<{ project: ProjectDto; version: string; taskIds: string[] }>(`/api/projects/${projectId}/import`, { method: 'POST', json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plan'] });
      qc.invalidateQueries({ queryKey: ['catalog'] });
    },
  });
}

export function usePatchProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: PatchProjectInput }) => api<{ project: ProjectDto; version: string }>(`/api/projects/${id}`, { method: 'PATCH', json: patch }),
    onMutate: ({ id, patch }) => {
      const snap = snapshot(qc);
      eachPlan(qc, (plan) => ({ ...plan, projects: plan.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
      return { snap };
    },
    onError: (e, _v, ctx) => {
      if (ctx) restore(qc, ctx.snap);
      toast(errorText(e), { tone: 'error' });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['plan'] }),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ version: string }>(`/api/projects/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plan'] }),
    onError: (e) => toast(errorText(e), { tone: 'error' }),
  });
}

export function useReorderProjects() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api<{ version: string }>('/api/projects/reorder', { method: 'POST', json: { ids } }),
    onMutate: (ids) => {
      const snap = snapshot(qc);
      const order = new Map(ids.map((id, i) => [id, i + 1]));
      eachPlan(qc, (plan) => ({ ...plan, projects: plan.projects.map((p) => (order.has(p.id) ? { ...p, sortOrder: order.get(p.id)! } : p)) }));
      return { snap };
    },
    onError: (e, _v, ctx) => {
      if (ctx) restore(qc, ctx.snap);
      toast(errorText(e), { tone: 'error' });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['plan'] }),
  });
}
