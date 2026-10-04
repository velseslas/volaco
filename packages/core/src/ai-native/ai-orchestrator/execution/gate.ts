/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-010)
 * ÉTAPE 36 — Gate de référence (FILE_MUTATION_GATE)
 *
 * Gate déterministe SANS LLM/MCP/réseau : il évalue les invariants de
 * mutation fichier en OBSERVANT la source de vérité (jamais le booléen du
 * composant qui a muté). L'implémentation des contrôles est celle de la
 * vérification É35, extraite ici pour n'exister qu'UNE fois :
 * l'exécuteur (première vérification) et la boucle de réparation (re-Gate)
 * utilisent le MÊME gate.
 *
 * Un Gate FAIL ne produit JAMAIS un succès : il fournit la classification
 * de l'échec au système de réparation.
 */

import type { IReadOnlyFileSource } from '../../understanding/types.js';
import type { AgentArtifact } from '../types.js';
import type { AgentExecutionVerificationCheck } from './agent-execution.js';

export type GateSeverity = 'BLOCKING' | 'WARNING';

export interface GateResult {
  readonly passed: boolean;
  /** Identifiant stable du gate (déterministe). */
  readonly gateId: string;
  /** Raison explicite en cas de FAIL. */
  readonly reason?: string | undefined;
  readonly severity: GateSeverity;
  readonly checks: readonly AgentExecutionVerificationCheck[];
  readonly executionId: string;
}

export const FILE_MUTATION_GATE_ID = 'FILE_MUTATION_GATE';

interface BeforeSnapshotEntry {
  readonly path: string;
  readonly existed: boolean;
  readonly content: string | undefined;
}

export interface GateEvaluationParams {
  readonly executionId: string;
  readonly tenantId: string;
  readonly projectId: string;
  /** Artifacts PROPOSED_FILE_CHANGE validés (post-exécution agent). */
  readonly fileChanges: readonly AgentArtifact[];
  /** État observé AVANT mutation (snapshot É35). */
  readonly beforeSnapshot: readonly BeforeSnapshotEntry[];
  /** Source de vérité read-only (LA même source que le mutateur). */
  readonly fileObserver: IReadOnlyFileSource;
}

/**
 * Évalue le gate en observant réellement la source. Ne suppose JAMAIS PASS :
 * si une opération n'est pas vérifiable, le contrôle échoue.
 */
export function evaluateFileMutationGate(params: GateEvaluationParams): GateResult {
  const checks: AgentExecutionVerificationCheck[] = [];
  const beforeOf = (path: string): BeforeSnapshotEntry | undefined =>
    params.beforeSnapshot.find((b) => b.path === path);
  const readNow = (path: string) => params.fileObserver.getFile(params.tenantId, params.projectId, path);

  try {
    for (const artifact of params.fileChanges) {
      const payload = artifact.payload as {
        filePath: string;
        operation: 'CREATE' | 'UPDATE' | 'DELETE' | 'RENAME' | 'MOVE';
        proposedContent?: string | undefined;
        newPath?: string | undefined;
      };
      const before = beforeOf(payload.filePath);

      if (payload.operation === 'CREATE') {
        checks.push({
          check: `CREATE ${payload.filePath} : fichier absent avant`,
          passed: before?.existed === false,
          ...(before?.existed === true ? { detail: 'le fichier existait déjà avant la mutation' } : {})
        });
        const after = readNow(payload.filePath);
        checks.push({
          check: `CREATE ${payload.filePath} : fichier présent après`,
          passed: after !== null,
          ...(after === null ? { detail: 'fichier toujours absent après mutation' } : {})
        });
        checks.push({
          check: `CREATE ${payload.filePath} : contenu identique a l artifact`,
          passed: after !== null && after.content === payload.proposedContent,
          ...(after !== null && after.content !== payload.proposedContent ? { detail: 'contenu divergent' } : {})
        });
      } else if (payload.operation === 'UPDATE') {
        checks.push({
          check: `UPDATE ${payload.filePath} : fichier présent avant`,
          passed: before?.existed === true,
          ...(before?.existed === false ? { detail: 'fichier absent avant' } : {})
        });
        const after = readNow(payload.filePath);
        checks.push({
          check: `UPDATE ${payload.filePath} : contenu identique a l artifact`,
          passed: after !== null && after.content === payload.proposedContent,
          ...(after === null ? { detail: 'fichier absent après' } : after !== null && after.content !== payload.proposedContent ? { detail: 'contenu divergent' } : {})
        });
      } else if (payload.operation === 'DELETE') {
        checks.push({
          check: `DELETE ${payload.filePath} : fichier présent avant`,
          passed: before?.existed === true,
          ...(before?.existed === false ? { detail: 'fichier déjà absent avant' } : {})
        });
        const after = readNow(payload.filePath);
        checks.push({
          check: `DELETE ${payload.filePath} : fichier absent après`,
          passed: after === null,
          ...(after !== null ? { detail: 'fichier toujours présent' } : {})
        });
      } else if (payload.operation === 'RENAME' || payload.operation === 'MOVE') {
        const newPath = payload.newPath as string;
        if (typeof newPath !== 'string' || newPath.trim().length === 0) {
          checks.push({
            check: `${payload.operation} ${payload.filePath} : nouvelle localisation identifiable`,
            passed: false,
            detail: 'newPath absent'
          });
          continue;
        }
        const beforeNew = beforeOf(newPath);
        const afterOld = readNow(payload.filePath);
        const afterNew = readNow(newPath);
        checks.push({
          check: `${payload.operation} ${payload.filePath} → ${newPath} : cible présente avant`,
          passed: before?.existed === true,
          ...(before?.existed === false ? { detail: 'cible absente avant' } : {})
        });
        checks.push({
          check: `${payload.operation} : nouvelle localisation libre avant`,
          passed: beforeNew?.existed === false,
          ...(beforeNew?.existed === true ? { detail: 'la destination existait déjà avant' } : {})
        });
        checks.push({
          check: `${payload.operation} : ancienne localisation absente après`,
          passed: afterOld === null,
          ...(afterOld !== null ? { detail: 'ancien fichier toujours présent' } : {})
        });
        checks.push({
          check: `${payload.operation} : nouvelle localisation présente après`,
          passed: afterNew !== null,
          ...(afterNew === null ? { detail: 'nouveau fichier absent' } : {})
        });
        checks.push({
          check: `${payload.operation} : contenu conservé`,
          passed: before?.existed === true && afterNew !== null && afterNew.content === before.content,
          ...(before?.existed === true && afterNew !== null && afterNew.content !== before.content ? { detail: 'contenu modifié durant le déplacement' } : {})
        });
      } else {
        // Opération non vérifiable → FAIL (jamais de PASS supposé).
        checks.push({
          check: `${payload.operation ?? 'inconnue'} ${payload.filePath} : opération vérifiable`,
          passed: false,
          detail: 'opération non supportée par le gate'
        });
      }
    }
  } catch (err: unknown) {
    checks.push({
      check: 'OBSERVATION_DE_LA_SOURCE',
      passed: false,
      detail: `VERIFICATION_ERROR: ${err instanceof Error ? err.message : String(err)}`
    });
  }

  const passed = checks.length > 0 && checks.every((c) => c.passed);
  return {
    passed,
    gateId: FILE_MUTATION_GATE_ID,
    ...(passed ? {} : { reason: `${checks.filter((c) => !c.passed).length} contrôle(s) de vérification en échec` }),
    severity: 'BLOCKING',
    checks,
    executionId: params.executionId
  };
}
