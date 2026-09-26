/**
 * VibeCode Studio - Terminal Service (CORE-005)
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Role } from '../identity/permissions.js';
import { assertPermission } from '../identity/permissions.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { ProjectStore } from '../identity/project.js';
import { AuditStore } from '../observability/audit.js';
import { logger } from '../logger.js';
import { validateAndParseCommand } from './whitelist.js';
import type { CommandInput, CommandResult } from './types.js';

/**
 * Commandes qui ne dépendent PAS des fichiers d'un projet (juste la version d'un outil
 * installé sur le serveur). Celles-ci peuvent être exécutées réellement sans risque,
 * puisqu'elles ne touchent à rien d'autre qu'à l'outil lui-même.
 */
function isProjectIndependent(binary: string, subcommand: string | undefined): boolean {
  return subcommand === '--version' || subcommand === '-v';
}

export class TerminalService {
  constructor(
    private projectStore: ProjectStore,
    private auditStore?: AuditStore
  ) {}

  /**
   * ÉTAPE 6 — répertoire disque où les fichiers du projet sont matérialisés
   * (même convention que file-explorer/store.ts materializeFile).
   */
  private resolveWorkspaceDir(tenantId: string, projectId: string): string | null {
    const base = process.env.VOLACO_DATA_DIR || join(process.cwd(), '.volaco-data');
    const segment = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(base, 'workspace', segment(tenantId), segment(projectId));
  }

  public executeCommand(
    tenantId: string,
    projectId: string,
    input: CommandInput,
    userRole: Role = 'ENGINEER',
    requestId?: string
  ): CommandResult {
    const startTime = performance.now();

    if (!tenantId) {
      throw new ValidationError('Le tenantId est obligatoire', { field: 'tenantId' }, requestId);
    }
    if (!projectId) {
      throw new ValidationError('Le projectId est obligatoire', { field: 'projectId' }, requestId);
    }

    // 1. Vérification d'accès projet et permissions RBAC
    const project = this.projectStore.getProject(tenantId, projectId);
    if (!project) {
      throw new NotFoundError(`Projet ${projectId} introuvable pour le tenant ${tenantId}`, requestId);
    }
    assertPermission(userRole, 'PROJECT_UPDATE', requestId);

    // 2. Validation stricte de la commande contre la whitelist (aucun caractère shell,
    // binaire et sous-commande limités à une liste fermée). La whitelist bloque
    // désormais aussi `node -e`, `node --eval`, `node -p`, `npm run`, `pnpm run`,
    // `pnpm install`, etc. — ce sont des RCE potentielles.
    const parsed = validateAndParseCommand(input.command);

    let stdout = '';
    let stderr = '';
    let exitCode = 0;

    const fullCmd = input.command.trim();

    if (isProjectIndependent(parsed.binary, parsed.subcommand)) {
      // 4a. Commande indépendante du projet (ex: "git --version") : exécution réelle,
      // sans invocation de shell (execFile n'interprète aucun caractère spécial).
      try {
        stdout = execFileSync(parsed.binary, parsed.args, {
          timeout: input.timeoutMs ?? 10_000,
          encoding: 'utf8',
          windowsHide: true
        });
      } catch (err) {
        const e = err as { status?: number; stdout?: string; stderr?: string; code?: string; message: string };
        exitCode = typeof e.status === 'number' ? e.status : 1;
        stdout = e.stdout ?? '';
        if (e.code === 'ENOENT') {
          // Sur Windows, npm/pnpm sont des wrappers .cmd : Node refuse de les
          // spawner sans shell (CVE-2024-27980) — et un shell est justement
          // ce que ce service s'interdit. On l'explique au lieu de renvoyer
          // un "spawnSync npm ENOENT" cryptique.
          stderr =
            `Binaire "${parsed.binary}" introuvable ou non exécutable directement sur ce système. ` +
            `Sur Windows, npm/pnpm sont des wrappers .cmd que Node bloque sans shell pour raisons de sécurité ; ` +
            `seuls les binaires natifs (node, git) sont exécutables réellement ici.`;
        } else {
          stderr = e.stderr || e.message;
        }
        logger.warn('Échec d\'exécution d\'une commande terminal indépendante du projet', {
          component: 'terminal',
          binary: parsed.binary,
          subcommand: parsed.subcommand,
          exitCode,
          stderr: e.stderr ?? null,
          message: e.message
        });
      }
    } else {
      // 4b. Commande liée au contenu d'un projet — ÉTAPE 6 : si les fichiers
      // du projet sont matérialisés sur disque (workspace/<projectId>/), la
      // commande est exécutée RÉELLEMENT dans ce dossier (sans shell). Sinon,
      // message honnête (comportement conservé).
      const workspacePath = this.resolveWorkspaceDir(tenantId, projectId);
      if (workspacePath && existsSync(workspacePath)) {
        try {
          stdout = execFileSync(parsed.binary, parsed.args, {
            cwd: workspacePath,
            timeout: input.timeoutMs ?? 10_000,
            encoding: 'utf8',
            windowsHide: true
          });
        } catch (err) {
          const e = err as { status?: number; stdout?: string; stderr?: string; message: string };
          exitCode = typeof e.status === 'number' ? e.status : 1;
          stdout = e.stdout ?? '';
          stderr = e.stderr || e.message;
        }
      } else {
        stdout = '';
        stderr = `[${parsed.binary} ${parsed.subcommand ?? ''}] non exécuté : les fichiers de ce projet ne sont pas matérialisés sur disque (stockage virtuel). Générez ou modifiez l'application pour créer workspace/${projectId}.`;
        exitCode = 1;
      }
    }

    const durationMs = Math.round(performance.now() - startTime);

    // 5. Audit de sécurité
    if (this.auditStore) {
      this.auditStore.record({
        tenantId,
        userId: 'user',
        action: 'TERMINAL_EXECUTE',
        resourceType: 'terminal',
        resourceId: `${projectId}:${parsed.binary}`,
        status: exitCode === 0 ? 'SUCCESS' : 'FAILURE',
        metadata: {
          command: fullCmd,
          binary: parsed.binary,
          exitCode,
          durationMs
        },
        requestId: requestId ?? 'req_term_auto'
      });
    }

    return {
      tenantId,
      projectId,
      command: fullCmd,
      binary: parsed.binary,
      exitCode,
      stdout,
      stderr,
      durationMs,
      executedAt: new Date()
    };
  }
}
