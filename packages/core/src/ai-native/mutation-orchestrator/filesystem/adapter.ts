/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-006)
 * Mutable File Source Interface & FileStore Adapter
 */

import { createHash } from 'node:crypto';
import type { IReadOnlyFileSource } from '../../understanding/types.js';
import type { FileStore } from '../../../file-explorer/store.js';
import { sanitizePath } from '../../../file-explorer/store.js';
import { logger } from '../../../logger.js';
import { auditStore } from '../../../observability/audit.js';
// É51 — garde-fou d'exfiltration canonique : toute mutation IA de document
// HTML passant par cet adaptateur est validée AVANT sa persistance.
import { runExfiltrationGuard, describeExfiltrationBlocker } from '../../security/exfiltration-guard.js';

export interface IMutableFileSource extends IReadOnlyFileSource {
  computeTreeHash(tenantId: string, projectId: string): string;
  createFile(tenantId: string, projectId: string, filePath: string, content: string): void;
  updateFile(tenantId: string, projectId: string, filePath: string, content: string): void;
  deleteFile(tenantId: string, projectId: string, filePath: string): boolean;
  renameFile(tenantId: string, projectId: string, oldPath: string, newPath: string): void;
  moveFile(tenantId: string, projectId: string, oldPath: string, newPath: string): void;
  cloneState(tenantId: string, projectId: string): Record<string, string>;
}

/**
 * Adapter exposing FileStore as an IMutableFileSource.
 */
export class FileStoreAdapter implements IMutableFileSource {
  constructor(private readonly fileStore: FileStore) {}

  /**
   * É51 — VALIDATION DE SÉCURITÉ OBLIGATOIRE AVANT PERSISTANCE.
   *
   * Point de contrôle central unique : toute écriture de contenu par le
   * Mutation Orchestrator (agents routés, batch multi-agents, moteur du
   * stream, rollbacks) passe par createFile/updateFile, et le contenu reçu
   * est le contenu FINAL (les transformations du moteur — applyCodePatch —
   * ont déjà eu lieu avant l'appel). Rien ne transforme le contenu entre la
   * validation et l'écriture.
   *
   * Périmètre protégé : les documents HTML (chemin .html/.htm, ou enveloppe
   * HTML détectée dans le contenu) — l'artefact servi/exécutable du produit
   * (page single-file). Les écritures non-HTML (composants, JSON, README…)
   * ne sont pas des canaux exécutables dans l'artefact servi et restent
   * légitimes sans validation (preservation des usages légitimes).
   *
   * Refus par défaut : destination non whitelistée, non identifiable,
   * construite dynamiquement, encodée avec tracking → ERREUR, AUCUN appel de
   * persistance (createNode/saveFile jamais atteints), trace d'audit
   * (logger + auditStore MUTATION_SECURITY_REFUSED). L'erreur remonte au
   * moteur de mutation (MutationExecutionError) puis à executePlan qui
   * annule la transaction (rollback automatique + audit MUTATION_ROLLED_BACK)
   * et rejette honnêtement vers l'appelant.
   *
   * La validation est un scan textuel déterministe (regex + hash) : aucun
   * accès réseau, aucune dépendance à un prompt ou à la bonne volonté d'un
   * agent.
   */
  private guardAiWrite(tenantId: string, projectId: string, filePath: string, content: string): void {
    const lowerPath = filePath.toLowerCase();
    const isHtmlPath = lowerPath.endsWith('.html') || lowerPath.endsWith('.htm');
    const head = content.slice(0, 200);
    const isHtmlEnvelope = /<!DOCTYPE|<html[\s>]/i.test(head);
    if (!isHtmlPath && !isHtmlEnvelope) return;

    const report = runExfiltrationGuard(content, filePath);
    if (report.passed) {
      // Trace légère du passage (audit exploitable) — contenu légitime écrit.
      logger.info('Garde-fou exfiltration : contenu HTML autorisé (mutation orchestrator)', {
        component: 'mutation-orchestrator-adapter',
        tenantId,
        projectId,
        path: filePath,
        verdict: report.verdict,
        warnings: report.warnings.length,
        contentHash: report.contentHash
      });
      return;
    }

    const refusal = describeExfiltrationBlocker(report);
    logger.warn('Garde-fou exfiltration : ÉCRITURE REFUSÉE avant persistance (mutation orchestrator)', {
      component: 'mutation-orchestrator-adapter',
      tenantId,
      projectId,
      path: filePath,
      verdict: report.verdict,
      blockers: report.blockers,
      contentHash: report.contentHash,
      byteLength: report.byteLength
    });
    try {
      auditStore.record({
        tenantId,
        userId: 'system',
        action: 'MUTATION_SECURITY_REFUSED',
        resourceType: 'mutation_transaction',
        resourceId: filePath,
        status: 'FAILURE',
        // L'adaptateur n'a pas de requestId (contrat IMutableFileSource) :
        // marqueur stable identifiant la frontière émettrice ; le contexte
        // complet (projet, chemin, blockers, hash) est dans metadata.
        requestId: 'mutation-orchestrator-adapter',
        metadata: {
          projectId,
          path: filePath,
          blockers: report.blockers,
          warnings: report.warnings,
          contentHash: report.contentHash,
          byteLength: report.byteLength
        }
      });
    } catch {
      // L'audit ne doit jamais masquer le refus.
    }
    // Aucune fonction de persistance n'est appelée : le throw précède
    // createNode/saveFile. Message honnête pour l'appelant et le client.
    throw new Error(refusal);
  }

  public getFile(tenantId: string, projectId: string, filePath: string) {
    const f = this.fileStore.getFile(tenantId, projectId, filePath);
    if (!f) return null;
    if (f.hash !== undefined) {
      return {
        path: f.path,
        name: f.name,
        content: f.content,
        sizeBytes: f.sizeBytes,
        hash: f.hash,
        updatedAt: f.updatedAt
      };
    }
    return {
      path: f.path,
      name: f.name,
      content: f.content,
      sizeBytes: f.sizeBytes,
      updatedAt: f.updatedAt
    };
  }

  public getAllProjectFiles(tenantId: string, projectId: string): Record<string, string> {
    return this.fileStore.getAllProjectFiles(tenantId, projectId);
  }

  public computeTreeHash(tenantId: string, projectId: string): string {
    return this.fileStore.computeTreeHash(tenantId, projectId);
  }

  public createFile(tenantId: string, projectId: string, filePath: string, content: string): void {
    const clean = sanitizePath(filePath);
    // É51 — validation AVANT persistance (aucune écriture si refus).
    this.guardAiWrite(tenantId, projectId, clean, content);
    this.fileStore.createNode(tenantId, projectId, clean, 'file', content);
  }

  public updateFile(tenantId: string, projectId: string, filePath: string, content: string): void {
    const clean = sanitizePath(filePath);
    // É51 — validation AVANT persistance (aucune écriture si refus).
    this.guardAiWrite(tenantId, projectId, clean, content);
    this.fileStore.saveFile(tenantId, projectId, clean, content);
  }

  public deleteFile(tenantId: string, projectId: string, filePath: string): boolean {
    const clean = sanitizePath(filePath);
    return this.fileStore.deleteNode(tenantId, projectId, clean);
  }

  public renameFile(tenantId: string, projectId: string, oldPath: string, newPath: string): void {
    const cleanOld = sanitizePath(oldPath);
    const cleanNew = sanitizePath(newPath);
    this.fileStore.renameNode(tenantId, projectId, cleanOld, cleanNew);
  }

  public moveFile(tenantId: string, projectId: string, oldPath: string, newPath: string): void {
    const cleanOld = sanitizePath(oldPath);
    const cleanNew = sanitizePath(newPath);
    this.fileStore.moveNode(tenantId, projectId, cleanOld, cleanNew);
  }

  public cloneState(tenantId: string, projectId: string): Record<string, string> {
    return { ...this.fileStore.getAllProjectFiles(tenantId, projectId) };
  }
}

/**
 * Standalone in-memory mutable file source for isolated testing and verification.
 */
export class InMemoryMutableFileSource implements IMutableFileSource {
  private readonly files = new Map<string, Record<string, string>>();

  constructor(initialFiles?: Record<string, Record<string, string>>) {
    if (initialFiles) {
      for (const [key, map] of Object.entries(initialFiles)) {
        this.files.set(key, { ...map });
      }
    }
  }

  private key(tenantId: string, projectId: string): string {
    return `${tenantId}:${projectId}`;
  }

  private getMap(tenantId: string, projectId: string): Record<string, string> {
    const k = this.key(tenantId, projectId);
    let map = this.files.get(k);
    if (!map) {
      map = {};
      this.files.set(k, map);
    }
    return map;
  }

  public getFile(tenantId: string, projectId: string, filePath: string) {
    const map = this.getMap(tenantId, projectId);
    const clean = sanitizePath(filePath);
    const content = map[clean];
    if (content === undefined) return null;
    return {
      path: clean,
      name: clean.split('/').pop() ?? clean,
      content,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      hash: createHash('sha256').update(content).digest('hex'),
      updatedAt: new Date()
    };
  }

  public getAllProjectFiles(tenantId: string, projectId: string): Record<string, string> {
    return { ...this.getMap(tenantId, projectId) };
  }

  public computeTreeHash(tenantId: string, projectId: string): string {
    const map = this.getMap(tenantId, projectId);
    const entries = Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, content]) => `${path}:${createHash('sha256').update(content).digest('hex')}`);
    return createHash('sha256').update(entries.join('\n')).digest('hex');
  }

  public createFile(tenantId: string, projectId: string, filePath: string, content: string): void {
    const map = this.getMap(tenantId, projectId);
    const clean = sanitizePath(filePath);
    map[clean] = content;
  }

  public updateFile(tenantId: string, projectId: string, filePath: string, content: string): void {
    const map = this.getMap(tenantId, projectId);
    const clean = sanitizePath(filePath);
    map[clean] = content;
  }

  public deleteFile(tenantId: string, projectId: string, filePath: string): boolean {
    const map = this.getMap(tenantId, projectId);
    const clean = sanitizePath(filePath);
    if (map[clean] !== undefined) {
      delete map[clean];
      return true;
    }
    return false;
  }

  public renameFile(tenantId: string, projectId: string, oldPath: string, newPath: string): void {
    const map = this.getMap(tenantId, projectId);
    const cleanOld = sanitizePath(oldPath);
    const cleanNew = sanitizePath(newPath);
    const content = map[cleanOld];
    if (content !== undefined) {
      delete map[cleanOld];
      map[cleanNew] = content;
    }
  }

  public moveFile(tenantId: string, projectId: string, oldPath: string, newPath: string): void {
    this.renameFile(tenantId, projectId, oldPath, newPath);
  }

  public cloneState(tenantId: string, projectId: string): Record<string, string> {
    return { ...this.getMap(tenantId, projectId) };
  }
}
