import { useMemo } from 'react';
import type { PersonDto } from '@shared/schemas/plan';

export function usePeople(people: PersonDto[] | undefined) {
  return useMemo(() => {
    const byId = new Map((people ?? []).map((p) => [p.id, p]));
    const owners = (people ?? []).filter((p) => p.active && p.role !== 'viewer');
    return { byId, owners, name: (id: string | null | undefined) => (id ? byId.get(id)?.name ?? 'Former user' : '') };
  }, [people]);
}
