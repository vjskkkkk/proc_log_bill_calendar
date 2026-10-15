import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { UserPublic } from '@shared/types';
import type { ChangePasswordInput, LoginInput, SetupInput } from '@shared/schemas/auth';

export interface AuthStatus {
  needsSetup: boolean;
  user: UserPublic | null;
  appName: string;
}

export const authKeys = { status: ['auth', 'status'] as const };

export function useAuthStatus() {
  return useQuery({ queryKey: authKeys.status, queryFn: () => api<AuthStatus>('/api/auth/status'), staleTime: 60_000 });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api<{ user: UserPublic }>('/api/auth/login', { method: 'POST', json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: authKeys.status }),
  });
}

export function useSetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SetupInput) => api<{ user: UserPublic }>('/api/auth/setup', { method: 'POST', json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: authKeys.status }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
    onSuccess: () => qc.clear(),
  });
}

export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ChangePasswordInput) => api<{ ok: true }>('/api/auth/change-password', { method: 'POST', json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: authKeys.status }),
  });
}
