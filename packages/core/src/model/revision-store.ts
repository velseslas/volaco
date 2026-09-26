import { randomUUID } from 'node:crypto';
import type { ApplicationRevision, FileArtifact, TechnicalDecision, ModificationProvenance } from './revision.js';
import { createFileArtifact } from './revision.js';
import { ValidationError, NotFoundError } from '../errors.js';
import { dataFilePath, readJsonFile, writeJsonFileSync } from '../persistence/json-disk-cache.js';

export interface CreateRevisionInput {
  message: string;
  author: string;
  files: Record<string, string>; // path -> content
  decisions?: TechnicalDecision[] | undefined;
  provenance: ModificationProvenance;
}

function reviveRevision(raw: ApplicationRevision): ApplicationRevision {
  return {
    ...raw,
    createdAt: new Date(raw.createdAt),
    decisions: (raw.decisions || []).map((d) => ({ ...d, timestamp: new Date(d.timestamp) }))
  };
}

export class RevisionStore {
  // Clef composite : tenantId:projectId -> revisions[]
  private revisions = new Map<string, ApplicationRevision[]>();
  private readonly filePath: string | undefined;

  constructor(options?: { persist?: boolean }) {
    if (options?.persist) {
      this.filePath = dataFilePath('revisions');
      const raw = readJsonFile<Record<string, ApplicationRevision[]>>(this.filePath, {});
      for (const [key, revisions] of Object.entries(raw)) {
        this.revisions.set(key, revisions.map(reviveRevision));
      }
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    const obj: Record<string, ApplicationRevision[]> = {};
    for (const [key, revisions] of this.revisions.entries()) {
      obj[key] = revisions;
    }
    writeJsonFileSync(this.filePath, obj);
  }

  private getProjectKey(tenantId: string, projectId: string): string {
    return `${tenantId}:${projectId}`;
  }

  public createRevision(tenantId: string, projectId: string, input: CreateRevisionInput): ApplicationRevision {
    if (!tenantId || !projectId) {
      throw new ValidationError('tenantId et projectId sont obligatoires pour crÃ©er une rÃ©vision');
    }
    if (!input.message || input.message.trim().length === 0) {
      throw new ValidationError('Le message de rÃ©vision est obligatoire');
    }

    const key = this.getProjectKey(tenantId, projectId);
    const existing = this.revisions.get(key) || [];
    const parentRevision = existing.length > 0 ? existing[existing.length - 1] : undefined;

    const revisionNumber = (parentRevision?.revisionNumber || 0) + 1;
    const revisionId = 'rev_' + randomUUID().replace(/-/g, '').slice(0, 16);

    const fileArtifacts: Record<string, FileArtifact> = {};
    for (const [path, content] of Object.entries(input.files)) {
      const mime = path.endsWith('.html') ? 'text/html' : path.endsWith('.js') ? 'application/javascript' : 'text/plain';
      fileArtifacts[path] = createFileArtifact(path, content, mime);
    }

    const revision: ApplicationRevision = {
      id: revisionId,
      tenantId,
      projectId,
      ...(parentRevision ? { parentRevisionId: parentRevision.id } : {}),
      revisionNumber,
      message: input.message.trim(),
      author: input.author || 'system',
      createdAt: new Date(),
      files: fileArtifacts,
      decisions: input.decisions || [],
      provenance: input.provenance
    };

    existing.push(revision);
    this.revisions.set(key, existing);
    this.persist();
    return revision;
  }

  public listRevisions(tenantId: string, projectId: string): ApplicationRevision[] {
    const key = this.getProjectKey(tenantId, projectId);
    return [...(this.revisions.get(key) || [])];
  }

  public getRevision(tenantId: string, projectId: string, revisionId: string): ApplicationRevision | null {
    const revisions = this.listRevisions(tenantId, projectId);
    return revisions.find(r => r.id === revisionId) || null;
  }

  public rollbackTo(
    tenantId: string,
    projectId: string,
    targetRevisionId: string,
    author: string,
    triggerRequestId?: string
  ): ApplicationRevision {
    const target = this.getRevision(tenantId, projectId, targetRevisionId);
    if (!target) {
      throw new NotFoundError(`RÃ©vision cible pour rollback introuvable : ${targetRevisionId}`);
    }

    const rawFiles: Record<string, string> = {};
    for (const [path, artifact] of Object.entries(target.files)) {
      rawFiles[path] = artifact.content;
    }

    return this.createRevision(tenantId, projectId, {
      message: `Rollback vers la révision #${target.revisionNumber} (${target.id})`,
      author,
      files: rawFiles,
      decisions: [
        {
          id: 'dec_' + randomUUID().slice(0, 8),
          title: 'Rollback Technique',
          rationale: `Restauration de l'Ã©tat fonctionnel de la rÃ©vision #${target.revisionNumber}`,
          timestamp: new Date(),
          impact: 'Restauration complÃ¨te des fichiers'
        }
      ],
      provenance: {
        source: 'SYSTEM_REPAIR',
        prompt: `Rollback to revision ${targetRevisionId}`,
        triggerRequestId
      }
    });
  }

  public clear(): void {
    this.revisions.clear();
    this.persist();
  }
}

export const revisionStore = new RevisionStore({ persist: true });
