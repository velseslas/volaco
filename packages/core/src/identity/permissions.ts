import { ForbiddenError } from '../errors.js';

export type Role = 'OWNER' | 'ADMIN' | 'ENGINEER' | 'VIEWER';

export type Permission =
  | 'PROJECT_CREATE'
  | 'PROJECT_READ'
  | 'PROJECT_UPDATE'
  | 'PROJECT_DELETE'
  | 'TENANT_MANAGE'
  | 'PROJECT_MUTATE';

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: ['PROJECT_CREATE', 'PROJECT_READ', 'PROJECT_UPDATE', 'PROJECT_DELETE', 'TENANT_MANAGE', 'PROJECT_MUTATE'],
  ADMIN: ['PROJECT_CREATE', 'PROJECT_READ', 'PROJECT_UPDATE', 'PROJECT_DELETE', 'PROJECT_MUTATE'],
  ENGINEER: ['PROJECT_CREATE', 'PROJECT_READ', 'PROJECT_UPDATE', 'PROJECT_MUTATE'],
  VIEWER: ['PROJECT_READ']
};

export function hasPermission(role: Role, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  return permissions !== undefined && permissions.includes(permission);
}

export function assertPermission(role: Role, permission: Permission, requestId?: string): void {
  if (!hasPermission(role, permission)) {
    throw new ForbiddenError(
      `Le rÃ´le '${role}' ne possÃ¨de pas la permission requise '${permission}'`,
      requestId
    );
  }
}
