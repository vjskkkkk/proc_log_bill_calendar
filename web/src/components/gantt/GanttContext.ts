import { createContext, useContext } from 'react';
import type { CatalogItemDto, CreateTaskInput, PatchTaskInput, TaskDto } from '@shared/schemas/plan';
import type { IsoDate } from '@shared/schedule/dates';
import type { GanttRow } from '@shared/schedule/rows';
import type { ProjectDto } from '@shared/schemas/plan';
import type { usePeople } from '../../lib/people';
import type { Col, ColKey } from './layout';

export type Row = GanttRow<ProjectDto, TaskDto>;

/** A task or sub-task typed in that is not in the Task Lists: ask how its days work (NewTaskDialog). */
export interface NewTaskRequest {
  name: string;
  projectId: string;
  category: string;
  /** Set for a sub-task. */
  parent: TaskDto | null;
  /** Renaming an existing row to something new (else a new row is created). */
  taskId?: string;
}
export type DragMode = 'move' | 'start' | 'end' | 'shift' | 'draw';

export interface GanttActions {
  patch: (id: string, patch: PatchTaskInput) => void;
  /** Creates a task with a browser-made id and returns it. */
  create: (input: Omit<CreateTaskInput, 'id'>) => string;
  remove: (task: TaskDto) => void;
  toggleProject: (id: string) => void;
  toggleTask: (id: string) => void;
  openDrawer: (id: string) => void;
  /** Move focus to a column of the row `delta` rows away (skipping rows without that column). */
  moveFocus: (rowKey: string, col: ColKey, delta: number) => void;
  focusCell: (rowKey: string, col: ColKey) => void;
  reorder: (row: Row, delta: -1 | 1) => void;
  startDrag: (e: React.PointerEvent, row: Row, mode: DragMode) => void;
  startRowDrag: (e: React.PointerEvent, row: Row) => void;
  /** Remembered default category for new tasks. */
  lastCategory: () => string;
  askNew: (req: NewTaskRequest) => void;
  importQuote: (project: ProjectDto) => void;
}

export interface GanttCtx {
  px: number;
  origin: IsoDate;
  today: IsoDate;
  cols: Col[];
  leftW: number;
  laneW: number;
  editable: boolean;
  people: ReturnType<typeof usePeople>;
  catalog: CatalogItemDto[];
  /** Every task of the open plan (for "Waits for" labels and choices). */
  tasks: TaskDto[];
  actions: GanttActions;
}

export const GanttContext = createContext<GanttCtx | null>(null);

export function useGantt(): GanttCtx {
  const c = useContext(GanttContext);
  if (!c) throw new Error('GanttContext missing');
  return c;
}
