/**
 * VibeCode Core — DNA Evolution Engine (CDC §31) — LOT MINIMUM RÉEL
 * (2026-11-03, audit moteurs).
 *
 * L'Application DNA est DÉRIVÉE du code (§13) : la « rollback » honnête ne
 * réécrit PAS le DNA (il serait immédiatement recalculé du code courant) —
 * elle restaure le CODE via la révision réelle archivée à la capture
 * (revisionStore est l'autorité). Chaque version porte donc :
 *   - hash RÉEL du DNA (dnaHash moteur, jamais un hash inventé),
 *   - provenance complète (requestId / sessionId / décision / déclencheur),
 *   - revisionId = la révision du code correspondant à ce DNA,
 *   - le payload ApplicationDNA intégral (diff réel possible).
 *
 * Borne honnête : une version est écrite UNIQUEMENT quand le hash du DNA a
 * changé (pas de spam de versions identiques) ; 25 versions / projet,
 * MAX_DNA_VERSIONS_TOTAL au total (document global borné, les plus anciennes
 * sortent d'abord). Persistance : document JSON unique (json-disk-cache →
 * SQLite documents) — 1 écriture par CHANGEMENT d'architecture réel, rare
 * par construction, donc pas de coalescence ici (contrairement au
 * ExecutionEventStore qui, lui, écrit à chaque événement).
 */

import { dataFilePath, readJsonFile, writeJsonFileSync } from '../../persistence/json-disk-cache.js';
import { ValidationError } from '../../errors.js';
import type { ApplicationDNA } from './types.js';

export const MAX_DNA_VERSIONS_PER_PROJECT = 25;
export const MAX_DNA_VERSIONS_TOTAL = 300;

export type DNAVersionTrigger = 'stream-mutation' | 'manual' | 'rollback' | 'merge';

/** Nom de branche honnête : court, sans surprise d'URL ni de JSON. */
export const DNA_BRANCH_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,23}$/;
export const DNA_MAIN_BRANCH = 'main';

interface DNABranchRecord {
  readonly name: string;
  /** Version de départ (point de branchement) — jamais une valeur inventée. */
  readonly fromVersion: number;
  readonly createdAt: number;
}

export interface DNAVersionMeta {
  readonly trigger: DNAVersionTrigger;
  readonly requestId: string;
  readonly sessionId?: string | undefined;
  readonly decisionId?: string | undefined;
  readonly revisionId?: string | undefined;
}

export interface DNAVersionRecord {
  readonly projectKey: string;
  readonly version: number;
  readonly hash: string;
  readonly capturedAt: number;
  readonly analyzerVersion: string;
  readonly trigger: DNAVersionTrigger;
  readonly requestId: string;
  readonly sessionId?: string | undefined;
  readonly decisionId?: string | undefined;
  readonly revisionId?: string | undefined;
  /**
   * Ligne d'évolution (§31 branches) : 'main' par défaut. Numérotation
   * GLOBALE et monotone (une seule chaîne de versions, chaque entrée porte
   * sa branche) — pas de renumérotation au merge, jamais d'écrasement.
   */
  readonly branch: string;
  /** Résumé compact melted pour lister vite (le payload complet reste disponible). */
  readonly summary: {
    readonly primaryLanguage: string;
    readonly primaryFramework: string;
    readonly totalFiles: number;
    readonly overallHealth: string;
    readonly components: number;
    readonly modules: number;
  };
  /** Payload DNA complet (stack/architecture/components/modules/graph). */
  readonly payload: ApplicationDNA;
}

export interface DNAVersionDiff {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly sameHash: boolean;
  readonly language: { readonly from: string; readonly to: string };
  readonly framework: { readonly from: string; readonly to: string };
  readonly totalFiles: { readonly from: number; readonly to: number };
  readonly overallHealth: { readonly from: string; readonly to: string };
  readonly componentsAdded: readonly string[];
  readonly componentsRemoved: readonly string[];
  readonly modulesAdded: readonly string[];
  readonly modulesRemoved: readonly string[];
}

interface DNAVersionProjectSlice {
  nextVersion: number;
  versions: DNAVersionRecord[];
  /** §31 branches — registre optionnel : champs absents = document ancien (main seule). */
  branches?: Record<string, DNABranchRecord>;
  activeBranch?: string;
}

interface DNAVersionDoc {
  projects: Record<string, DNAVersionProjectSlice>;
}

const EMPTY_DOC: DNAVersionDoc = { projects: {} };

function projectKey(tenantId: string, projectId: string): string {
  return tenantId + '::' + projectId;
}

function componentNames(dna: ApplicationDNA): string[] {
  return (dna.components ?? []).map((c) => String(c?.name ?? '')).filter(Boolean);
}

function moduleNames(dna: ApplicationDNA): string[] {
  return (dna.modules ?? []).map((m) => String(m?.name ?? '')).filter(Boolean);
}

export class DNAVersionStore {
  private doc: DNAVersionDoc = { ...EMPTY_DOC, projects: {} };
  private readonly filePath: string | undefined;

  constructor(persist: boolean = true) {
    if (persist) {
      this.filePath = dataFilePath('dna-versions');
      const raw = readJsonFile<DNAVersionDoc>(this.filePath, EMPTY_DOC);
      if (raw && typeof raw === 'object' && raw.projects && typeof raw.projects === 'object') {
        this.doc = raw;
      }
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    writeJsonFileSync(this.filePath, this.doc);
  }

  /**
   * Enregistre UNE version si (et seulement si) le hash du DNA a changé
   * depuis la dernière version du projet. Retourne `created:false` sinon —
   * jamais une version dupliquée.
   */
  public recordVersion(
    tenantId: string,
    projectId: string,
    dna: ApplicationDNA,
    meta: DNAVersionMeta
  ): { readonly created: boolean; readonly version: number; readonly versions: number } {
    if (!tenantId || !projectId) {
      throw new ValidationError('tenantId et projectId obligatoires pour archiver une version DNA');
    }
    if (!dna || typeof dna.dnaHash !== 'string' || dna.dnaHash.length === 0) {
      throw new ValidationError('dnaHash réel obligatoire (jamais un hash inventé)');
    }
    const key = projectKey(tenantId, projectId);
    const slice = this.doc.projects[key] ?? { nextVersion: 1, versions: [] };
    const activeBranch = slice.activeBranch ?? DNA_MAIN_BRANCH;
    const latest = slice.versions[slice.versions.length - 1];
    if (latest && latest.hash === dna.dnaHash) {
      return { created: false, version: latest.version, versions: slice.versions.length };
    }

    const version = slice.nextVersion;
    slice.nextVersion = version + 1;
    const record: DNAVersionRecord = {
      projectKey: key,
      version,
      hash: dna.dnaHash,
      capturedAt: Date.now(),
      analyzerVersion: dna.analyzerVersion,
      trigger: meta.trigger,
      requestId: meta.requestId,
      branch: activeBranch,
      ...(meta.sessionId ? { sessionId: meta.sessionId } : {}),
      ...(meta.decisionId ? { decisionId: meta.decisionId } : {}),
      ...(meta.revisionId ? { revisionId: meta.revisionId } : {}),
      summary: {
        primaryLanguage: dna.stack?.language?.name ?? '',
        primaryFramework: dna.stack?.framework?.name ?? '',
        totalFiles: dna.summary?.totalFiles ?? 0,
        overallHealth: dna.summary?.overallHealth ?? '',
        components: (dna.components ?? []).length,
        modules: (dna.modules ?? []).length
      },
      payload: dna
    };
    slice.versions.push(record);

    // Bornes : 25 / projet (les plus anciennes sortent), et borne globale
    // sur le document (les plus anciennes de TOUS les projets sortent).
    if (slice.versions.length > MAX_DNA_VERSIONS_PER_PROJECT) {
      slice.versions.splice(0, slice.versions.length - MAX_DNA_VERSIONS_PER_PROJECT);
    }
    let total = 0;
    for (const entry of Object.values(this.doc.projects)) {
      total += entry.versions.length;
    }
    while (total > MAX_DNA_VERSIONS_TOTAL) {
      // Éviction déterministe : la plus ancienne version du projet le plus
      // ancien (plus petit capturedAt en tête) sort en premier.
      let oldestKey: string | null = null;
      let oldestAt = Number.MAX_SAFE_INTEGER;
      for (const [k, entry] of Object.entries(this.doc.projects)) {
        const first = entry.versions[0];
        if (first && first.capturedAt < oldestAt) {
          oldestAt = first.capturedAt;
          oldestKey = k;
        }
      }
      if (!oldestKey) break;
      const losing = this.doc.projects[oldestKey];
      if (!losing) break;
      const dropped = losing.versions.shift();
      total -= dropped ? 1 : 0;
      if (losing.versions.length === 0) delete this.doc.projects[oldestKey];
    }
    this.doc.projects[key] = slice;
    this.persist();
    return { created: true, version, versions: slice.versions.length };
  }

  public getVersions(tenantId: string, projectId: string): readonly DNAVersionRecord[] {
    const slice = this.doc.projects[projectKey(tenantId, projectId)];
    if (!slice) return [];
    // Plus récentes D'ABORD pour l'UI (les versions s'empilent).
    return [...slice.versions].reverse();
  }

  /** Anciennes entrées sans `branch` (document antérieur au lot) = main. */
  private normalizeBranchName(v: DNAVersionRecord): string {
    return (typeof v.branch === 'string' && v.branch.length > 0) ? v.branch : DNA_MAIN_BRANCH;
  }

  public getVersion(tenantId: string, projectId: string, version: number): DNAVersionRecord | null {
    const slice = this.doc.projects[projectKey(tenantId, projectId)];
    return slice?.versions.find((v) => v.version === version) ?? null;
  }

  public diffVersions(tenantId: string, projectId: string, from: number, to: number): DNAVersionDiff | null {
    const a = this.getVersion(tenantId, projectId, from);
    const b = this.getVersion(tenantId, projectId, to);
    if (!a || !b) return null;
    const aComponents = new Set(componentNames(a.payload));
    const bComponents = new Set(componentNames(b.payload));
    const aModules = new Set(moduleNames(a.payload));
    const bModules = new Set(moduleNames(b.payload));
    return {
      fromVersion: a.version,
      toVersion: b.version,
      sameHash: a.hash === b.hash,
      language: {
        from: a.summary.primaryLanguage,
        to: b.summary.primaryLanguage
      },
      framework: {
        from: a.summary.primaryFramework,
        to: b.summary.primaryFramework
      },
      totalFiles: {
        from: a.summary.totalFiles,
        to: b.summary.totalFiles
      },
      overallHealth: {
        from: a.summary.overallHealth,
        to: b.summary.overallHealth
      },
      componentsAdded: [...bComponents].filter((n) => !aComponents.has(n)),
      componentsRemoved: [...aComponents].filter((n) => !bComponents.has(n)),
      modulesAdded: [...bModules].filter((n) => !aModules.has(n)),
      modulesRemoved: [...aModules].filter((n) => !bModules.has(n))
    };
  }

  // ---------------------------------------------------------------------------
  // §31 — BRANCHES & MERGE (versionnement linéaire + registre de lignes)
  // ---------------------------------------------------------------------------
  //
  // Modèle honnête : la numérotation des versions est GLOBALE et monotone ;
  // chaque entrée porte sa branche (`branch`, 'main' par défaut). Une
  // branche est un registre {name, fromVersion, createdAt} sur le slice du
  // projet ; `activeBranch` décide sur quelle ligne atterrit la PROCHAINE
  // capture (le hook capture lit/écrit le store sans aucune modification —
  // recordVersion se borne à lire activeBranch).
  //
  // Le MERGE ne réécrit jamais l'historique (aucune version supprimée, aucun
  // hash fabriqué) : il ARCHIVE une version 'merge' avec le payload EXACT de
  // la version source (dont elle adopte le code via sa révision — le rollback
  // de cette entrée restaure ce code) et referme la branche (on ne branchera
  // jamais une ligne deux fois).

  public getBranches(tenantId: string, projectId: string): readonly DNABranchRecord[] {
    const slice = this.doc.projects[projectKey(tenantId, projectId)];
    const branches = slice?.branches;
    const base: DNABranchRecord[] = [{ name: DNA_MAIN_BRANCH, fromVersion: 1, createdAt: slice?.versions[0]?.capturedAt ?? 0 }];
    if (!branches) return base;
    return [...base, ...Object.values(branches)];
  }

  public getActiveBranch(tenantId: string, projectId: string): string {
    const slice = this.doc.projects[projectKey(tenantId, projectId)];
    return slice?.activeBranch ?? DNA_MAIN_BRANCH;
  }

  public branchExists(tenantId: string, projectId: string, name: string): boolean {
    if (name === DNA_MAIN_BRANCH) return true;
    const slice = this.doc.projects[projectKey(tenantId, projectId)];
    return !!slice?.branches?.[name];
  }

  /**
   * Crée une ligne d'évolution à partir de `fromVersion` (compétence
   * opérateur, permission PROJECT_UPDATE côté route). Refuse honnêtement :
   * nom invalide (pattern strict), branche déjà existante, ou version
   * d'origine introuvable. La création N'ÉCRIT AUCUNE VERSION (une branche
   * n'est qu'un curseur : la première mutation sur la ligne archiver la
   * capture gardée au hash réel).
   */
  public createBranch(tenantId: string, projectId: string, name: string, fromVersion: number): DNABranchRecord {
    const branchName = String(name ?? '').trim();
    if (!DNA_BRANCH_NAME_PATTERN.test(branchName) || branchName === DNA_MAIN_BRANCH) {
      throw new ValidationError(`Nom de branche invalide : "${branchName}" (${DNA_BRANCH_NAME_PATTERN})`);
    }
    const key = projectKey(tenantId, projectId);
    const slice = this.doc.projects[key];
    if (!slice || slice.versions.length === 0) {
      throw new ValidationError('Aucune version archivée : impossible de brancher sur du vide.');
    }
    if (slice.branches?.[branchName]) {
      throw new ValidationError(`Branche "${branchName}" déjà existante (les lignes ne se réutilisent jamais).`);
    }
    const origin = slice.versions.find((v) => v.version === fromVersion);
    if (!origin) {
      throw new ValidationError(`Version d'origine v${fromVersion} introuvable pour ce projet (les versions évincées ne branchent pas).`);
    }
    const record: DNABranchRecord = { name: branchName, fromVersion: origin.version, createdAt: Date.now() };
    slice.branches = { ...(slice.branches ?? {}), [branchName]: record };
    this.persist();
    return record;
  }

  /**
   * Bascule la ligne sur laquelle atterrissent les captures suivantes.
   * C'est toute l'« édition » d'une branche : switcher, générer (le moteur
   * code écrit ce qu'il écrit, la capture assigne la ligne active), switcher
   * en retour. Refuse honnêtement les lignes inexistantes.
   */
  public setActiveBranch(tenantId: string, projectId: string, name: string): string {
    const key = projectKey(tenantId, projectId);
    const slice = this.doc.projects[key];
    if (!slice) {
      throw new ValidationError('Aucune version archivée pour ce projet.');
    }
    const exists = name === DNA_MAIN_BRANCH || !!slice.branches?.[name];
    if (!exists) {
      throw new ValidationError(`Branche "${name}" introuvable.`);
    }
    slice.activeBranch = name;
    this.persist();
    return name;
  }

  /**
   * Les entrées d'une ligne, en ordre chronologique. Sert le Studio
   * (paramètre `branch` de la liste) — main = toutes celles sans autre ligne.
   */
  public getVersionsOnBranch(tenantId: string, projectId: string, branch: string): readonly DNAVersionRecord[] {
    return this.getVersions(tenantId, projectId).filter((v) => this.normalizeBranchName(v) === branch);
  }

  public isBranchMerged(tenantId: string, projectId: string, branch: string): boolean {
    const slice = this.doc.projects[projectKey(tenantId, projectId)];
    return !!slice?.versions.some((v) => v.trigger === 'merge' && v.sessionId === `merge-of:${branch}`);
  }

  /**
   * MERGE honnête : archive une version 'merge' reprenant EXACTEMENT le
   * payload de la version source (son hash, sa révision, sa décision,
   * son résumé — jamais recalculé). L'après-merge, la ligne active redevient
   * 'main' (une branche n'enchaîne jamais sur un merge). Si le hash source
   * égale le hash de l'entrée précédente, on émet quand même la version de
   * merge : elle est la SEULE porte de nommage du point de fusion (traçabilité
   * du opérateur).
   */
  public mergeBranch(tenantId: string, projectId: string, branch: string, upToVersion: number): DNAVersionRecord {
    const key = projectKey(tenantId, projectId);
    const slice = this.doc.projects[key];
    if (!slice || slice.versions.length === 0) {
      throw new ValidationError('Aucune version archivée pour ce projet.');
    }
    if (branch === DNA_MAIN_BRANCH) {
      throw new ValidationError('La ligne "main" n\'est jamais fusionnée (elle est le point de convergence).');
    }
    if (!slice.branches?.[branch]) {
      throw new ValidationError(`Branche "${branch}" introuvable.`);
    }
    if (this.isBranchMerged(tenantId, projectId, branch)) {
      throw new ValidationError(`Branche "${branch}" déjà rattachée à main (un merge n\'est jamais répété).`);
    }
    const source = slice.versions.find((v) => v.version === upToVersion);
    if (!source || source.branch !== branch) {
      throw new ValidationError(`Version d'origine du merge introuvable : v${upToVersion} n'est pas sur la branche "${branch}".`);
    }
    const version = slice.nextVersion;
    slice.nextVersion = version + 1;
    const record: DNAVersionRecord = {
      projectKey: key,
      version,
      hash: source.hash,
      capturedAt: Date.now(),
      analyzerVersion: source.analyzerVersion,
      trigger: 'merge',
      requestId: source.requestId,
      sessionId: `merge-of:${branch}`,
      ...(source.decisionId ? { decisionId: source.decisionId } : {}),
      ...(source.revisionId ? { revisionId: source.revisionId } : {}),
      branch: DNA_MAIN_BRANCH,
      summary: source.summary,
      payload: source.payload
    };
    slice.versions.push(record);
    if (slice.versions.length > MAX_DNA_VERSIONS_PER_PROJECT) {
      slice.versions.splice(0, slice.versions.length - MAX_DNA_VERSIONS_PER_PROJECT);
    }
    slice.activeBranch = DNA_MAIN_BRANCH;
    this.persist();
    return record;
  }

  /** Usage tests uniquement. */
  public clear(): void {
    this.doc = { projects: {} };
    this.persist();
  }
}
