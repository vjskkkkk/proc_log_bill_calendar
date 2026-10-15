import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { BoqQuoteSummary, CrmLeadSummary, LinkList } from '@shared/schemas/plan';
import { api } from './client';

export function useBoqQuotes(q: string, enabled: boolean) {
  return useQuery({
    queryKey: ['links', 'boq', q],
    queryFn: () => api<LinkList<BoqQuoteSummary>>(`/api/links/boq-quotes?q=${encodeURIComponent(q)}`),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useCrmLeads(enabled: boolean, includeLost: boolean) {
  return useQuery({
    queryKey: ['links', 'crm', includeLost],
    queryFn: () => api<LinkList<CrmLeadSummary>>(`/api/links/crm-leads${includeLost ? '?lost=1' : ''}`),
    enabled,
    staleTime: 30_000,
  });
}
