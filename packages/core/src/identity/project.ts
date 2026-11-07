import type { Project, EntityId, ProjectStatus } from '../types/index.js';
import { ValidationError } from '../errors.js';
import { dataFilePath, readJsonFile, writeJsonFileSync } from '../persistence/json-disk-cache.js';

function reviveProject(raw: Project): Project {
  return {
    ...raw,
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt)
  };
}

// CAP-01 (audit maître backend) — ÉCRITURES COALESCÉES.
// `persist()` réécrivait le document COMPLET (JSON.stringify de TOUS les
// projets + UPSERT SQLite) à CHAQUE mutation : coût O(n) par écriture. Sous
// concurrence, la file d'écriture saturait l'event loop — mesuré sur le banc
// : création de projet 345 req/s (c=5) → 86 req/s (c=50), p95 816 ms, et par
// effet de bord les LECTURES dégradaient (3 800 → 76 req/s).
// Même arbitrage documenté que AuditStore (n°2) : au plus 1 écriture physique
// par fenêtre (défaut 500 ms) ou tous les N enregistrements (défaut 20). La
// mémoire reste l'unique source de vérité (`listProjects`/`getProject` sont
// exacts en permanence) ; sur crash brutal, la queue non flushée (≤ 1 fenêtre)
// est perdue. `flush()` force l'écriture, `clear()`/`deleteProject()` restent
// immédiats (actes destructifs). Seuils surchargeables pour l'opérateur ou
// les tests (`VOLACO_PROJECT_FLUSH_MS=0` restaure l'ancien comportement
// synchrone pur).
function resolveProjectFlushMs(): number {
  const raw = Number.parseInt(process.env.VOLACO_PROJECT_FLUSH_MS || '', 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : 500;
}

function resolveProjectFlushEvery(): number {
  const raw = Number.parseInt(process.env.VOLACO_PROJECT_FLUSH_EVERY || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 20;
}

export class ProjectStore {
  private projects = new Map<EntityId, Project>();
  private readonly filePath: string | undefined;
  private readonly flushMs: number;
  private readonly flushEvery: number;
  private lastFlushAt = 0;
  private pendingSinceFlush = 0;
  private flushTimer: NodeJS.Timeout | null = null;

  /**
   * `persist: true` active la sauvegarde sur disque (utilisé par l'instance
   * unique du serveur réel). Sans cet argument, tout reste en mémoire comme
   * avant — notamment pour les tests, qui créent une instance fraîche à
   * chaque fois et ne doivent jamais lire les données d'une exécution précédente.
   */
  constructor(options?: { persist?: boolean; flushMs?: number; flushEvery?: number }) {
    this.flushMs = options?.flushMs !== undefined && options.flushMs >= 0
      ? options.flushMs
      : resolveProjectFlushMs();
    this.flushEvery = options?.flushEvery !== undefined && options.flushEvery > 0
      ? options.flushEvery
      : resolveProjectFlushEvery();
    if (options?.persist) {
      this.filePath = dataFilePath('projects');
      const raw = readJsonFile<Record<string, Project>>(this.filePath, {});
      for (const [id, project] of Object.entries(raw)) {
        this.projects.set(id, reviveProject(project));
      }
    }
  }

  /**
   * Marque le document comme sale et écrit si le seuil est atteint.
   * Ancre de durabilité : `lastFlushAt` démarre à 0, donc la PREMIÈRE
   * mutation après le chargement est écrite aussitôt (faible trafic :
   * 1 création = durable immédiatement), les suivantes sont coalescées.
   * Sans mutation suivante, un timer DÉBORDEMENT (trailing, unref) garantit
   * que la queue part dans les `flushMs` ms — sinon la dernière écriture
   * d'une rafale resterait en mémoire jusqu'au prochain arrêt.
   */
  private markDirty(options?: { immediate?: boolean }): void {
    if (!this.filePath) return;
    this.pendingSinceFlush += 1;
    const due = options?.immediate === true
      || this.flushMs === 0
      || this.pendingSinceFlush >= this.flushEvery
      || Date.now() - this.lastFlushAt >= this.flushMs;
    if (due) {
      this.cancelFlushTimer();
      this.writeNow();
      return;
    }
    if (!this.flushTimer) {
      const delay = Math.max(1, this.flushMs - (Date.now() - this.lastFlushAt));
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        if (this.pendingSinceFlush > 0) this.writeNow();
      }, delay);
      // Ne retient jamais le processus ouvert (tests, arrêt propre).
      this.flushTimer.unref();
    }
  }

  private cancelFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /** Écriture physique du document complet (même chemin qu'avant). */
  private writeNow(): void {
    if (!this.filePath) return;
    const obj: Record<string, Project> = {};
    for (const [id, project] of this.projects.entries()) {
      obj[id] = project;
    }
    writeJsonFileSync(this.filePath, obj);
    this.lastFlushAt = Date.now();
    this.pendingSinceFlush = 0;
    this.cancelFlushTimer();
  }

  /**
   * Force l'écriture de la queue (no-op si rien en attente). À appeler avant
   * l'arrêt du processus pour ne rien perdre de la fenêtre de coalescence.
   */
  public flush(): void {
    if (!this.filePath || this.pendingSinceFlush === 0) {
      this.cancelFlushTimer();
      return;
    }
    this.writeNow();
  }

  public createProject(tenantId: string, name: string, description?: string): Project {
    if (!tenantId) {
      throw new ValidationError('Un tenantId valide est obligatoire pour créer un projet');
    }
    if (!name || name.trim().length === 0) {
      throw new ValidationError('Le nom du projet est obligatoire');
    }

    const id = 'proj_' + Math.random().toString(36).substring(2, 11);
    const now = new Date();
    const project: Project = {
      id,
      tenantId,
      name: name.trim(),
      ...(description ? { description: description.trim() } : {}),
      status: 'CREATED',
      createdAt: now,
      updatedAt: now
    };

    this.projects.set(id, project);
    this.markDirty();
    return project;
  }

  public updateStatus(tenantId: string, id: string, status: ProjectStatus): Project {
    const project = this.getProject(tenantId, id);
    if (!project) {
      throw new ValidationError(`Projet ${id} introuvable pour le tenant ${tenantId}`);
    }
    project.status = status;
    project.updatedAt = new Date();
    this.markDirty();
    return project;
  }

  public listProjects(tenantId: string): Project[] {
    const results: Project[] = [];
    for (const project of this.projects.values()) {
      if (project.tenantId === tenantId) {
        results.push(project);
      }
    }
    return results;
  }

  public getProject(tenantId: string, id: string): Project | null {
    const project = this.projects.get(id);
    if (!project || project.tenantId !== tenantId) {
      return null;
    }
    return project;
  }

  /** Tous les ids du registre (tous locataires) — ménage des orphelins. */
  public listAllIds(): string[] {
    return [...this.projects.keys()];
  }

  public deleteProject(tenantId: string, id: string): boolean {
    const project = this.getProject(tenantId, id);
    if (!project) {
      return false;
    }
    const deleted = this.projects.delete(id);
    // Acte destructif : durable aussitôt (jamais dans la fenêtre de
    // coalescence — un crash ne doit pas faire réapparaître le projet).
    if (deleted) this.markDirty({ immediate: true });
    return deleted;
  }

  public clear(): void {
    this.projects.clear();
    this.markDirty({ immediate: true });
  }
}

export const projectStore = new ProjectStore({ persist: true });
