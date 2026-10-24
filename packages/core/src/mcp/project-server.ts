/**
 * VibeCode Core — Serveur MCP « projet » (P3)
 *
 * Serveur MCP stdio exposant les outils RÉELS du projet généré :
 * - fs_list    : liste les fichiers du projet
 * - fs_read    : lit un fichier (workspace)
 * - fs_write   : écrit un fichier (confiné src/ + racine projet, FileStore)
 * - app_build  : reconstruit le bundle React (vite, < 2 s)
 *
 * Confinement : les outils opèrent UNIQUEMENT dans le workspace du projet
 * passé en argument de processus (--tenant/--project) — un agent connecté à
 * ce serveur ne peut jamais sortir du projet.
 *
 * Transport : JSON-RPC 2.0 newline-delimited sur stdio (protocole MCP).
 */

import {
  MCP_ERROR,
  MCP_PROTOCOL_VERSION,
  decodeMessage,
  encodeError,
  encodeSuccess,
  type McpToolDefinition
} from './protocol.js';
import {
  buildApp,
  listAppFiles,
  readAppFile,
  writeAppFile
} from '../app-pipeline.js';
import { fileStore } from '../file-explorer/index.js';
import {
  formatImageViolations,
  inspectAppImageSources,
  type AppImageInspection
} from '../image/app-policy.js';
import { adoptedImageIds } from '../image/image-adoptions.js';

const tenantId = process.argv[2] ?? 'default-tenant';
const projectId = process.argv[3] ?? 'default-project';

const TOOLS: readonly McpToolDefinition[] = [
  {
    name: 'fs_list',
    description: 'Liste les fichiers du projet React généré.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'fs_read',
    description: 'Lit un fichier du projet (workspace).',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Chemin relatif (ex: src/App.tsx)' } },
      required: ['path']
    }
  },
  {
    name: 'fs_write',
    description: 'Écrit un fichier du projet (confiné à src/ et la racine projet) et le persiste dans le FileStore.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'app_build',
    description: 'Reconstruit le bundle React du projet (vite) et retourne le résultat du build.',
    inputSchema: { type: 'object', properties: {} }
  }
];

/**
 * PATCH-R3-A — porte d'images sur les outils de publication MCP.
 *
 * Ce serveur était le SEUL chemin de la plateforme écrivant le workspace ET
 * publiant (app_build → bundle servi sur /preview-bundle) sans aucun contrôle
 * de politique d'images. Désormais :
 *  - fs_write    : le contenu candidat est inspecté AVANT toute écriture
 *                  (workspace + FileStore). Violation → refus, aucune
 *                  écriture ; erreur d'inspection → refus fermé ; le contenu
 *                  n'est jamais réécrit ni « réparé » silencieusement.
 *  - app_build   : TOUTES les sources réellement construites sont relues du
 *                  workspace et inspectées immédiatement avant build.
 *                  Violation ou erreur → build refusé, le dernier bundle
 *                  valide n'est pas remplacé (échange atomique de buildApp).
 *
 * Les références indéterminées (src={expression}) suivent la politique du
 * pipeline existant (génération/édition) : seules les VIOLATIONS explicites
 * bloquent — le undetermined n'est jamais déclaré conforme, il traverse
 * exactement comme le pipeline l'a déjà accepté ailleurs.
 */

function mcpGuardSafeReason(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 120);
}

function mcpGuardFirstViolations(inspection: AppImageInspection): string {
  return formatImageViolations(inspection).slice(0, 3).join(' | ').slice(0, 320);
}

/** Exhaustif : chaque fichier source du workspace que buildApp consommerait. */
export function collectMcpInspectSources(projectId: string): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = [];
  for (const f of listAppFiles(projectId)) {
    const content = readAppFile(projectId, f.path);
    if (content !== null && content.length > 0) out.push({ path: f.path, content });
  }
  return out;
}

/**
 * Juge un contenu candidat à l'écriture. Retourne null si l'écriture est
 * autorisée, sinon le texte de refus court (≤ ~400 chars, borne du message
 * HTTP renvoyé par la route /api/v1/mcp/call).
 */
export function mcpGuardInspectCandidate(path: string, content: string): string | null {
  let inspection: AppImageInspection;
  try {
    inspection = inspectAppImageSources([{ path, content }], { adoptedIds: adoptedImageIds() });
  } catch (err) {
    return 'ERREUR: inspection des images en échec (' + mcpGuardSafeReason(err) + ') — écriture refusée par précaution, aucun fichier créé.';
  }
  if (inspection.violations.length > 0) {
    return 'REFUSÉ par la politique des images : ' + mcpGuardFirstViolations(inspection) + ' — aucune écriture effectuée.';
  }
  return null;
}

/**
 * Juge l'état réel du workspace juste avant un build. Retourne null si le
 * build est autorisé, sinon le texte de refus (fail-closed : tout incident
 * de collection ou d'inspection refuse le build).
 */
export function mcpGuardInspectWorkspace(projectId: string): string | null {
  let inputs: Array<{ path: string; content: string }>;
  try {
    inputs = collectMcpInspectSources(projectId);
  } catch (err) {
    return 'ERREUR: inspection des images en échec (' + mcpGuardSafeReason(err) + ') — build refusé par précaution, bundle précédent inchangé.';
  }
  let inspection: AppImageInspection;
  try {
    inspection = inspectAppImageSources(inputs, { adoptedIds: adoptedImageIds() });
  } catch (err) {
    return 'ERREUR: inspection des images en échec (' + mcpGuardSafeReason(err) + ') — build refusé par précaution, bundle précédent inchangé.';
  }
  if (inspection.violations.length > 0) {
    return 'BUILD REFUSÉ par la politique des images : ' + mcpGuardFirstViolations(inspection) + ' — bundle précédent inchangé.';
  }
  return null;
}

async function dispatchTool(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string }> {
  switch (name) {
    case 'fs_list': {
      const files = listAppFiles(projectId);
      return { ok: true, text: files.map((f) => f.path + ' (' + f.size + ' o)').join('\n') || '(projet vide)' };
    }
    case 'fs_read': {
      const path = String(args.path ?? '');
      const content = readAppFile(projectId, path);
      if (content === null) return { ok: false, text: 'ERREUR: fichier introuvable : ' + path };
      return { ok: true, text: content };
    }
    case 'fs_write': {
      const path = String(args.path ?? '');
      const content = String(args.content ?? '');
      // PATCH-R3-A — inspection AVANT écriture (workspace + FileStore).
      const refusal = mcpGuardInspectCandidate(path, content);
      if (refusal !== null) {
        return { ok: false, text: refusal };
      }
      const res = writeAppFile(projectId, path, content);
      if (!res.ok) return { ok: false, text: 'ERREUR: ' + res.reason };
      try {
        fileStore.saveFile(tenantId, projectId, 'app/' + path, content);
      } catch (err) {
        return { ok: true, text: 'Fichier écrit dans le workspace (persistance FileStore en échec : ' + (err instanceof Error ? err.message : String(err)).slice(0, 100) + ')' };
      }
      return { ok: true, text: 'Fichier ' + path + ' écrit et persisté (' + content.length + ' caractères).' };
    }
    case 'app_build': {
      // PATCH-R3-A — inspecter le contenu RÉELLEMENT construit (tout le
      // workspace), immédiatement avant le build.
      const refusal = mcpGuardInspectWorkspace(projectId);
      if (refusal !== null) {
        return { ok: false, text: refusal };
      }
      const result = await buildApp(projectId);
      return {
        ok: result.ok,
        text: result.ok
          ? 'Build réussi en ' + result.durationMs + ' ms (buildId: ' + result.buildId + ')'
          : 'ERREUR de build :\n' + result.errors.join('\n')
      };
    }
    default:
      return { ok: false, text: 'ERREUR: outil inconnu : ' + name };
  }
}

function main(): void {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line.length === 0) continue;

      const msg = decodeMessage(line);
      if (!msg || !('method' in msg)) continue;

      const params = (msg.params as Record<string, unknown>) ?? {};

      // tools/call : asynchrone (app_build peut prendre ~2 s)
      if (msg.method === 'tools/call' && typeof msg.id === 'number') {
        const callId: number = msg.id;
        const name = String(params.name ?? '');
        const args = (params.arguments as Record<string, unknown>) ?? {};
        dispatchTool(name, args)
          .then((r) => {
            process.stdout.write(encodeSuccess(callId, { content: [{ type: 'text', text: r.text }], isError: !r.ok } as unknown as Record<string, unknown>) + '\n');
          })
          .catch((err) => {
            process.stdout.write(encodeError(callId, MCP_ERROR.INTERNAL, err instanceof Error ? err.message : String(err)) + '\n');
          });
        continue;
      }

      // méthodes synchrones du protocole
      if (typeof msg.id !== 'number') continue; // notification (ex: initialized) — pas de réponse
      if (msg.method === 'initialize') {
        process.stdout.write(encodeSuccess(msg.id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'volaco-project', version: '1.0.0', projectId }
        }) + '\n');
      } else if (msg.method === 'tools/list') {
        process.stdout.write(encodeSuccess(msg.id, { tools: TOOLS }) + '\n');
      } else {
        process.stdout.write(encodeError(msg.id, MCP_ERROR.METHOD_NOT_FOUND, 'Méthode inconnue : ' + msg.method) + '\n');
      }
    }
  });
  process.stdin.on('end', () => process.exit(0));
}

// Exécution directe : node project-server.js <tenantId> <projectId>
if (process.argv[1] && /project-server\.(js|mjs)$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main();
}
