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

export class ProjectStore {
  private projects = new Map<EntityId, Project>();
  private readonly filePath: string | undefined;

  /**
   * `persist: true` active la sauvegarde sur disque (utilisé par l'instance
   * unique du serveur réel). Sans cet argument, tout reste en mémoire comme
   * avant — notamment pour les tests, qui créent une instance fraîche à
   * chaque fois et ne doivent jamais lire les données d'une exécution précédente.
   */
  constructor(options?: { persist?: boolean }) {
    if (options?.persist) {
      this.filePath = dataFilePath('projects');
      const raw = readJsonFile<Record<string, Project>>(this.filePath, {});
      for (const [id, project] of Object.entries(raw)) {
        this.projects.set(id, reviveProject(project));
      }
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    const obj: Record<string, Project> = {};
    for (const [id, project] of this.projects.entries()) {
      obj[id] = project;
    }
    writeJsonFileSync(this.filePath, obj);
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
    this.persist();
    return project;
  }

  public updateStatus(tenantId: string, id: string, status: ProjectStatus): Project {
    const project = this.getProject(tenantId, id);
    if (!project) {
      throw new ValidationError(`Projet ${id} introuvable pour le tenant ${tenantId}`);
    }
    project.status = status;
    project.updatedAt = new Date();
    this.persist();
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
    if (deleted) this.persist();
    return deleted;
  }

  public clear(): void {
    this.projects.clear();
    this.persist();
  }
}

export const projectStore = new ProjectStore({ persist: true });
