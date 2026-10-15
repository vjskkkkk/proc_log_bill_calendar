import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Category } from '@shared/categories';
import type { CatalogItemDto, CreateCatalogItemInput } from '@shared/schemas/plan';
import { api } from './client';
import { toast } from '../lib/toast';

const key = ['catalog'] as const;

export function useCatalog() {
  return useQuery({ queryKey: key, queryFn: () => api<{ items: CatalogItemDto[] }>('/api/catalog').then((r) => r.items), staleTime: 60_000 });
}

function useCatalogMutation<V>(fn: (v: V) => Promise<{ items: CatalogItemDto[] }>, quiet = false) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => qc.setQueryData(key, r.items),
    onError: (e) => {
      if (!quiet) toast((e as Error).message, { tone: 'error' });
    },
  });
}

export function useCreateCatalogItem() {
  return useCatalogMutation((input: CreateCatalogItemInput) => api<{ item: CatalogItemDto; items: CatalogItemDto[] }>('/api/catalog', { method: 'POST', json: input }));
}
export function usePatchCatalogItem() {
  return useCatalogMutation(({ id, ...patch }: { id: string; name?: string; category?: Category }) => api<{ items: CatalogItemDto[] }>(`/api/catalog/${id}`, { method: 'PATCH', json: patch }));
}
export function useDeleteCatalogItem() {
  return useCatalogMutation((id: string) => api<{ items: CatalogItemDto[] }>(`/api/catalog/${id}`, { method: 'DELETE' }));
}
export function useReorderCatalog() {
  return useCatalogMutation((ids: string[]) => api<{ items: CatalogItemDto[] }>('/api/catalog/reorder', { method: 'POST', json: { ids } }));
}
