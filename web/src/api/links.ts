import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { BoqQuoteLines, BoqQuoteSummary, CrmLeadSummary, LinkList } from '@shared/schemas/plan';
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

/** One quote's line items (names, units, quantities) for drafting tasks; `unavailable` when BOQ Maker can't say. */
export function useQuoteLines(quoteId: string | null) {
  return useQuery({
    queryKey: ['links', 'boq-lines', quoteId],
    queryFn: () => api<BoqQuoteLines>(`/api/links/boq-quotes/${encodeURIComponent(quoteId!)}/lines`),
    enabled: !!quoteId,
    staleTime: 60_000,
  });
}
