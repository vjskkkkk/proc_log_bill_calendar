export type Role = 'admin' | 'editor' | 'viewer';
export const ROLES: readonly Role[] = ['admin', 'editor', 'viewer'] as const;

/** Roles that may change the plan, projects and catalogue. Viewers are read-only (enforced on the server). */
export const EDIT_ROLES: readonly Role[] = ['admin', 'editor'] as const;
export function canEdit(role: Role): boolean {
  return EDIT_ROLES.includes(role);
}

export interface UserPublic {
  id: string;
  email: string;
  name: string;
  role: Role;
  mustChangePassword: boolean;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface ApiError {
  error: string;
  details?: unknown;
}
