import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { UserPublic } from '@shared/types';
import type { CreateUserInput, UpdateUserInput } from '@shared/schemas/auth';

const key = ['users'] as const;

export function useUsers() {
  return useQuery({ queryKey: key, queryFn: () => api<{ users: UserPublic[] }>('/api/users').then((r) => r.users) });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserInput) => api<{ user: UserPublic }>('/api/users', { method: 'POST', json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateUserInput & { id: string }) => api<{ user: UserPublic }>(`/api/users/${id}`, { method: 'PATCH', json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
}

export function useResetPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, temporaryPassword }: { id: string; temporaryPassword: string }) =>
      api<{ ok: true }>(`/api/users/${id}/reset-password`, { method: 'POST', json: { temporaryPassword } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
}
