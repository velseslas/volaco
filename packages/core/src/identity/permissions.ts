import { ForbiddenError } from '../errors.js';

export type Role = 'OWNER' | 'ADMIN' | 'ENGINEER' | 'VIEWER';

export type Permission =
  | 'PROJECT_CREATE'
  | 'PROJECT_READ'
  | 'PROJECT_UPDATE'
  | 'PROJECT_DELETE'
  | 'TENANT_MANAGE'
  /**
   * C3.2-B (décision D1) — Appel d'outils MCP DISTANTS uniquement
   * (sortie réseau vers un tiers via un connecteur du tenant). Accorder
   * OWNER + ADMIN ; ENGINEER/VIEWER exclus par défaut (réversibles ici).
   * La GESTION des connecteurs reste TENANT_MANAGE (OWNER seul).
   */
  | 'MCP_REMOTE_INVOKE'
  /**
   * MCP-C3.6 Lot A — Exécution d'outils MCP INTÉGRÉS (stdio de la
   * plateforme : serveurs « project » / « browser ») via la gouvernance
   * unifiée : préparation + confirmation + journal (figure P1-01 fermée).
   * La découverte (GET /api/v1/mcp/servers) reste PROJECT_READ.
   * OWNER + ADMIN par défaut (aligné sur MCP_REMOTE_INVOKE).
   */
  | 'MCP_BUILTIN_INVOKE'
  | 'PROJECT_MUTATE';

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: ['PROJECT_CREATE', 'PROJECT_READ', 'PROJECT_UPDATE', 'PROJECT_DELETE', 'TENANT_MANAGE', 'MCP_REMOTE_INVOKE', 'MCP_BUILTIN_INVOKE', 'PROJECT_MUTATE'],
  ADMIN: ['PROJECT_CREATE', 'PROJECT_READ', 'PROJECT_UPDATE', 'PROJECT_DELETE', 'MCP_REMOTE_INVOKE', 'MCP_BUILTIN_INVOKE', 'PROJECT_MUTATE'],
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
