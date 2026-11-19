/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-010)
 * É46 — Superviseur de résultats : VÉRIFICATION RÉELLE des livrables produits
 * par les agents AVANT de déclarer une mission terminée.
 *
 * Principe fondateur : une DÉCLARATION de réussite (statut SUCCESS d'un agent)
 * n'est jamais une PREUVE de réussite. La preuve, c'est le livrable réel
 * confronté aux exigences du plan et aux interdits É44 — sur la source de
 * vérité (les artifacts sont eux-mêmes déjà confrontés à la source par le
 * gate É36 ; ce superviseur raisonne AU-DESSUS, sur le résultat GLOBAL).
 *
 * Ce que le superviseur vérifie (déterministe, sans LLM/MCP/réseau, preuves
 * uniquement issues des outcomes RÉELS É36 déjà produits par le scheduler) :
 *   1. EXIGENCES DU PLAN — chaque tâche complétée a-t-elle produit les cibles
 *      déclarées (requiredContext.targetFiles) ? Un livrable sur un autre
 *      chemin que celui exigé est un défaut (TARGET_MISMATCH).
 *   2. INTERDITS É44 — les contraintes d'interdiction actives de la mémoire de
 *      session (formulations interdictives + chemins extraits, pattern É40)
 *      ont-elles été respectées par les fichiers RÉELLEMENT mutés ?
 *      (FORBIDDEN_PATH_MUTATED — jamais corrigé automatiquement.)
 *   3. COHÉRENCE MULTI-AGENTS — raisonnement GLOBAL : une tâche a-t-elle muté
 *      la cible déclarée d'une autre tâche sans dépendance directe déclarée
 *      (invalidation croisée) ? Deux tâches ont-elles muté le même chemin hors
 *      exigences déclarées ? (CROSS_AGENT_INVALIDATION — jamais corrigé
 *      automatiquement.)
 *
 * Décisions (vocabulaire fermé) :
 *   VALIDATED        — toutes les tâches complétées ET toutes les vérifications
 *                      passées sur livrables réels (preuves dans checks).
 *   NEEDS_CORRECTION — défaut précis identifié (détail + preuves + caractère
 *                      corrigeable) ou échec réel sans aucune partie validée.
 *   BLOCKED          — vérification impossible : tâches jamais exécutées
 *                      (dépendance non satisfaite / annulation / arrêt).
 *   PARTIAL          — une partie vérifiée et réussie, le solde ne l'est pas ;
 *                      JAMAIS présenté comme une mission complète.
 *
 * Correction ciblée (OPT-IN, jamais par défaut) :
 *   - autorisation EXPLICITE requise (politique `repair.enabled`) ;
 *   - budget BORNÉ (maxAttempts, défaut 1, plafond 2 — anti-boucle stricte) ;
 *   - passe TOUJOURS par le pipeline sécurisé existant (l'exécuteur
 *     conversationnel = AgentExecutionService É32→É36 : permissions, gates,
 *     isolation, single-writer, rollback — JAMAIS agent.executeTask()) ;
 *   - re-vérification RÉELLE après chaque tentative (les contrôles sont
 *     recalculés sur les outcomes réels de la tentative) ;
 *   - les mutations hors exigence d'une première tentative restent TRACÉES
 *     (résidu) : un résidu empêche VALIDATED — jamais de faux succès ;
 *   - interdits enfreints et invalidations croisées ne sont JAMAIS corrigés
 *     automatiquement (décision utilisateur requise).
 */

import { deepFreeze } from './canonical.js';
import { extractSourceFiles, type ConversationTaskContext } from './intent-router.js';
import type { Role } from '../../../identity/permissions.js';
import type { AgentExecutionOutcome } from '../../ai-orchestrator/execution/agent-execution.js';
import type {
  MultiAgentBatchStatus,
  MultiAgentSchedulerOutcome,
  MultiAgentTaskStatus
} from '../../ai-orchestrator/execution/multi-agent-scheduler.js';
import type { AgentTask, TaskContextPayload } from '../../ai-orchestrator/types.js';
import { loadProjectDesignContext } from '../../design-harmony/design-context.js';

// ---------------------------------------------------------------------------
// Contrats publics
// ---------------------------------------------------------------------------

export type SupervisionDecision = 'VALIDATED' | 'NEEDS_CORRECTION' | 'BLOCKED' | 'PARTIAL';

export type SupervisionFindingKind =
  | 'TARGET_MISMATCH'           // livrable réel ≠ exigence du plan (cible déclarée absente ou hors exigence)
  | 'FORBIDDEN_PATH_MUTATED'    // interdit É44 enfreint par une mutation réelle
  | 'CROSS_AGENT_INVALIDATION'; // incohérence globale entre agents (invalidation / contradiction)

export interface SupervisionFinding {
  readonly kind: SupervisionFindingKind;
  readonly taskId: string;
  /** Détail PRÉCIS : exigence violée, livrables réels, conséquence. */
  readonly detail: string;
  /** Preuves : chemins réellement mutés (issus des artifacts É36). */
  readonly evidence: readonly string[];
  /**
   * Correction ciblée automatique possible ? JAMAIS pour un interdit enfreint
   * ou une invalidation croisée (décision utilisateur requise) ; oui pour une
   * exigence de plan non satisfaite (ré-exécution bornée via le pipeline
   * sécurisé).
   */
  readonly repairable: boolean;
}

export interface SupervisionCheck {
  readonly check: string;
  readonly passed: boolean;
  readonly detail?: string | undefined;
}

export interface SupervisionRepairAttempt {
  readonly taskId: string;
  readonly executionId: string;
  /** Statut É36 RÉEL de la tentative (jamais un succès inventé). */
  readonly outcomeStatus: string;
  readonly error?: string | undefined;
  /** Gate É36 de la tentative (vérification réelle de la source). */
  readonly gatePassed?: boolean | undefined;
}

export interface SupervisionRepairTrail {
  readonly authorized: boolean;
  readonly attempted: boolean;
  readonly attemptsUsed: number;
  readonly maxAttempts: number;
  readonly attempts: readonly SupervisionRepairAttempt[];
  /** Présent quand une correction était possible mais refusée. */
  readonly refusalReason?: string | undefined;
}

export interface SupervisionCounts {
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly blocked: number;
  readonly pending: number;
  readonly total: number;
}

export interface SupervisionReport {
  readonly planId: string;
  readonly decision: SupervisionDecision;
  /** Décision AVANT toute correction ciblée (traçabilité). */
  readonly initialDecision: SupervisionDecision;
  /** Verdict BRUT du scheduler É37 (jamais réécrit). */
  readonly batchStatus: MultiAgentBatchStatus;
  /** Compteurs de l'état vérifié (fusion après correction éventuelle). */
  readonly counts: SupervisionCounts;
  /** Preuves : contrôles réels passés sur livrables. */
  readonly checks: readonly SupervisionCheck[];
  /** Défauts précis détectés (vide = aucun). */
  readonly findings: readonly SupervisionFinding[];
  readonly repair: SupervisionRepairTrail;
  /** Synthèse fidèle injectée dans la réponse finale. */
  readonly summary: string;
  /**
   * É47 — faits additifs pour la réponse finale : livrables RÉELLEMENT commis
   * par tâche (trail fusionné : tentatives initiales + corrections), à l'état
   * final. Entrées sans fichier commis omises.
   */
  readonly committedFiles: readonly {
    readonly taskId: string;
    readonly files: readonly string[];
  }[];
  /** É47 — exigences du plan non satisfaites à l'état final (cibles déclarées − trail). */
  readonly unmetFiles: readonly {
    readonly taskId: string;
    readonly files: readonly string[];
  }[];
}

export interface SupervisionRepairPolicy {
  readonly enabled: boolean;
  /** Budget TOTAL de corrections ciblées par exécution de plan (défaut 1, plafond 2). */
  readonly maxAttempts?: number | undefined;
}

/** Requête de correction ciblée = EXACTEMENT le contrat de l'exécuteur sécurisé. */
export interface SupervisionRepairRequest {
  readonly executionId: string;
  readonly agentId: string;
  readonly task: AgentTask;
  readonly context: TaskContextPayload;
  readonly tenantId: string;
  readonly projectId: string;
  readonly userRole?: Role | undefined;
  readonly requestId?: string | undefined;
}

export type SupervisionRepairExecutor = (request: SupervisionRepairRequest) => Promise<AgentExecutionOutcome>;

export interface SuperviseBatchParams {
  readonly planId: string;
  readonly outcome: MultiAgentSchedulerOutcome;
  /** Contexte conversationnel É44 réel (contraintes actives → interdits). */
  readonly conversation?: ConversationTaskContext | undefined;
  /** Politique de correction ciblée OPT-IN (absente = correction refusée). */
  readonly repair?: SupervisionRepairPolicy | undefined;
  /** Exécuteur sécurisé existant (AgentExecutionService via l'adaptateur). */
  readonly repairExecutor?: SupervisionRepairExecutor | undefined;
  /**
   * É53 LOT E4.2 — CORRECTION F2 (audit G2) : signal de cancellation de la
   * mission (même signal que le batch — aucune nouvelle autorité). Optionnel
   * et rétrocompatible : absent → comportement STRICTEMENT identique à
   * l'historique. Présent et armé (ou verdict batch CANCELLED) → AUCUNE
   * tentative de correction ciblée, aucune reclassification artificielle,
   * rapport final explicite sur l'annulation.
   */
  readonly signal?: AbortSignal | undefined;
  readonly tenantId: string;
  readonly projectId: string;
  readonly userRole?: Role | undefined;
  readonly requestId?: string | undefined;
}

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Budget par défaut / plafond des corrections ciblées (anti-boucle stricte). */
export const SUPERVISION_REPAIR_DEFAULT_ATTEMPTS = 1;
export const SUPERVISION_REPAIR_MAX_ATTEMPTS_CAP = 2;

/** Plafonds de taille du rapport (jamais une preuve tronquée en succès). */
const MAX_CHECKS = 30;
const MAX_FINDINGS = 8;

/**
 * Mots-clés interdictifs DÉTERMINISTES (français, comparaison sans accents).
 * Une contrainte active contenant un mot-clé interdictif ET un chemin de
 * fichier protège EXACTEMENT ce chemin (égalité exacte — limitation
 * documentée : pas de résolution de variantes de chemin).
 */
const INTERDICTION_KEYWORDS: readonly string[] = [
  'interdit',
  'interdite',
  'ne modifie pas',
  'ne pas modifier',
  'ne jamais modifier',
  'ne touche pas',
  'ne jamais toucher',
  'sans toucher',
  'ne supprime pas',
  'ne pas supprimer',
  'ne jamais supprimer',
  'ne cree pas',
  'ne pas creer',
  'ne jamais creer',
  'intact'
];

const stripAccents = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const normKeyword = (s: string): string => stripAccents(s).toLowerCase();

// ---------------------------------------------------------------------------
// Preuve interne : état vérifié d'une tâche
// ---------------------------------------------------------------------------

interface TaskEvidence {
  readonly taskId: string;
  /** Statut du scheduler (mis à jour de façon honnête après correction réelle). */
  status: MultiAgentTaskStatus;
  outcome: AgentExecutionOutcome | undefined;
  readonly declaredTargets: readonly string[];
  readonly dependencies: readonly string[];
  readonly blockedReason: string | undefined;
  /**
   * TRAIL des mutations réellement commises (SUCCESS/DEGRADED) — TOUTES les
   * tentatives confondues : une mutation hors exigence d'une première
   * tentative reste un fait réel même après une correction réussie (résidu).
   */
  mutationTrail: readonly string[];
}

interface Evidence {
  readonly tasks: readonly TaskEvidence[];
  readonly counts: SupervisionCounts;
  readonly checks: readonly SupervisionCheck[];
  readonly findings: readonly SupervisionFinding[];
}

// ---------------------------------------------------------------------------
// Extraction des chemins protégés (interdits É44)
// ---------------------------------------------------------------------------

/**
 * É44 — les interdits actifs de la mémoire de session deviennent des chemins
 * protégés : contrainte interdictive + chemin nommé (extraction É40 partagée,
 * une seule définition de « qu'est-ce qu'un fichier cible nommé »).
 */
function protectedPathsFromConstraints(
  constraints: readonly string[] | undefined
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const raw of constraints ?? []) {
    const constraint = String(raw);
    const normalized = normKeyword(constraint);
    const interdictive = INTERDICTION_KEYWORDS.some((k) => normalized.includes(normKeyword(k)));
    if (!interdictive) continue;
    for (const path of extractSourceFiles(constraint)) {
      if (!map.has(path)) map.set(path, constraint);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Chemins réellement commis par une exécution É36
// ---------------------------------------------------------------------------

/**
 * Seuls les statuts SUCCESS/DEGRADED correspondent à une mutation commise ET
 * non annulée (ROLLED_BACK/CANCELLED/FAILED_ROLLBACK : état restauré ou
 * jamais appliqué — le gate É36 l'a déjà vérifié).
 */
function committedPathsOf(outcome: AgentExecutionOutcome | undefined): readonly string[] {
  if (!outcome || (outcome.status !== 'SUCCESS' && outcome.status !== 'DEGRADED')) return [];
  const paths: string[] = [];
  for (const artifact of outcome.artifacts) {
    if (artifact.kind !== 'PROPOSED_FILE_CHANGE') continue;
    const payload = artifact.payload as { filePath?: unknown; operation?: unknown; newPath?: unknown } | undefined;
    const filePath = payload && typeof payload.filePath === 'string' ? payload.filePath.trim() : '';
    if (filePath.length > 0 && !paths.includes(filePath)) paths.push(filePath);
    const op = payload && typeof payload.operation === 'string' ? payload.operation : '';
    const newPath =
      payload && typeof payload.newPath === 'string' ? payload.newPath.trim() : '';
    if ((op === 'RENAME' || op === 'MOVE') && newPath.length > 0 && !paths.includes(newPath)) paths.push(newPath);
  }
  return paths;
}

const unionPaths = (a: readonly string[], b: readonly string[]): readonly string[] => {
  const merged = [...a];
  for (const p of b) if (!merged.includes(p)) merged.push(p);
  return merged;
};

// ---------------------------------------------------------------------------
// Construction des preuves (contrôles + défauts) sur les outcomes RÉELS
// ---------------------------------------------------------------------------

function mergeTasksWithEvidence(tasks: readonly TaskEvidence[]): { counts: SupervisionCounts } {
  const counts = {
    completed: tasks.filter((t) => t.status === 'COMPLETED').length,
    failed: tasks.filter((t) => t.status === 'FAILED').length,
    cancelled: tasks.filter((t) => t.status === 'CANCELLED').length,
    blocked: tasks.filter((t) => t.status === 'BLOCKED').length,
    pending: tasks.filter((t) => t.status === 'PENDING').length,
    total: tasks.length
  };
  return { counts };
}

function buildEvidence(
  tasks: readonly TaskEvidence[],
  protectedPaths: ReadonlyMap<string, string>
): Evidence {
  const { counts } = mergeTasksWithEvidence(tasks);
  const checks: SupervisionCheck[] = [];
  const findings: SupervisionFinding[] = [];
  const pushCheck = (check: SupervisionCheck): void => {
    if (checks.length < MAX_CHECKS) checks.push(check);
  };
  const pushFinding = (finding: SupervisionFinding): void => {
    if (findings.length < MAX_FINDINGS) findings.push(finding);
  };

  // --- 1. EXIGENCES DU PLAN vs livrables réels (par tâche complétée) --------
  for (const task of tasks) {
    if (task.status !== 'COMPLETED') {
      // Tâche non complétée : pas de livrable à confronter — l'état réel est
      // tracé (échec/blocage/annulation avec son erreur), jamais inventé.
      const realDetail =
        task.outcome?.error ?? task.blockedReason ?? 'aucun outcome rattaché (contrat scheduler É37)';
      pushCheck({
        check: `traçabilité ${task.taskId} : statut ${task.status} tracé avec son état réel`,
        passed: true,
        detail: realDetail
      });
      continue;
    }
    const declared = task.declaredTargets;
    const produced = task.mutationTrail;

    // 1a. Les cibles DÉCLARÉES ont-elles été produites ? (exigence du plan)
    const missingDeclared = declared.filter((t) => !produced.includes(t));
    pushCheck({
      check: `exigence du plan ${task.taskId} : cible(s) déclarée(s) [${declared.join(', ')}] produite(s) sur la source`,
      passed: missingDeclared.length === 0,
      ...(missingDeclared.length > 0
        ? { detail: `cible(s) jamais produite(s) : ${missingDeclared.join(', ')} — livrable(s) réel(s) : [${produced.join(', ') || 'aucun'}]` }
        : { detail: `livrable(s) réel(s) : [${produced.join(', ')}]` })
    });
    if (missingDeclared.length > 0) {
      pushFinding({
        kind: 'TARGET_MISMATCH',
        taskId: task.taskId,
        detail:
          `l'étape ${task.taskId} devait produire [${declared.join(', ')}] mais cette exigence du plan n'est pas satisfaite ` +
          `(livrable(s) réel(s) : [${produced.join(', ') || 'aucun'}])`,
        evidence: [...declared, ...produced],
        repairable: true
      });
    }

    // 1b. Les livrables produits sont-ils tous DANS l'exigence ? (résidu)
    const offPlan = produced.filter((p) => !declared.includes(p));
    pushCheck({
      check: `conformité du livrable ${task.taskId} : mutation(s) [${produced.join(', ')}] ⊆ cibles déclarées [${declared.join(', ')}]`,
      passed: offPlan.length === 0,
      ...(offPlan.length > 0 ? { detail: `mutation(s) hors exigence : ${offPlan.join(', ')}` } : {})
    });
    if (offPlan.length > 0) {
      pushFinding({
        kind: 'TARGET_MISMATCH',
        taskId: task.taskId,
        detail:
          `l'étape ${task.taskId} a réellement muté ${offPlan.join(', ')} — chemin(s) hors exigence du plan ` +
          `(résidu : la restauration n'est jamais automatique, décision utilisateur requise)`,
        evidence: offPlan,
        repairable: false
      });
    }
  }

  // --- 2. INTERDITS É44 vs fichiers réellement mutés ------------------------
  if (protectedPaths.size === 0) {
    pushCheck({
      check: 'interdits É44 : aucune contrainte d interdiction active (0 chemin protégé)',
      passed: true
    });
  } else {
    let forbiddenFound = false;
    for (const task of tasks) {
      if (task.status !== 'COMPLETED') continue;
      for (const path of task.mutationTrail) {
        const constraint = protectedPaths.get(path);
        if (!constraint) continue;
        forbiddenFound = true;
        pushFinding({
          kind: 'FORBIDDEN_PATH_MUTATED',
          taskId: task.taskId,
          detail:
            `l'interdit actif «${constraint}» (chemin protégé ${path}) a été ENFREINT par ${task.taskId} ` +
            `(mutation réelle appliquée sur la source de vérité)`,
          evidence: [path],
          repairable: false
        });
      }
    }
    pushCheck({
      check: `interdits É44 : ${protectedPaths.size} chemin(s) protégé(s) [${Array.from(protectedPaths.keys()).join(', ')}] — livrables commis conformes`,
      passed: !forbiddenFound,
      ...(forbiddenFound ? { detail: 'au moins un interdit a été muté réellement' } : {})
    });
  }

  // --- 3. COHÉRENCE MULTI-AGENTS (raisonnement GLOBAL) ----------------------
  const completedTasks = tasks.filter((t) => t.status === 'COMPLETED');
  const directDep = (a: TaskEvidence, b: TaskEvidence): boolean => a.dependencies.includes(b.taskId);
  const reachable = (from: TaskEvidence, targetId: string, seen: Set<string>): boolean => {
    if (seen.has(from.taskId)) return false;
    seen.add(from.taskId);
    return from.dependencies.some((d) => d === targetId);
  };
  const declaredOwnersOf = (path: string): readonly TaskEvidence[] =>
    tasks.filter((t) => t.declaredTargets.includes(path));
  const crossKeys = new Set<string>();
  let crossFound = false;

  // Règle 1 : une tâche a muté la cible DÉCLARÉE d'une autre, sans dépendance
  // directe déclarée → invalidation / contradiction non déclarée.
  for (const task of completedTasks) {
    for (const path of task.mutationTrail) {
      if (task.declaredTargets.includes(path)) continue;
      for (const owner of declaredOwnersOf(path)) {
        if (owner.taskId === task.taskId) continue;
        if (directDep(task, owner) || directDep(owner, task)) continue;
        const key = `${task.taskId}|${owner.taskId}|${path}`;
        if (crossKeys.has(key)) continue;
        crossKeys.add(key);
        crossFound = true;
        const chain = reachable(task, owner.taskId, new Set<string>())
          ? 'reliées seulement par une chaîne de dépendances indirecte'
          : 'aucune relation de dépendance déclarée';
        pushFinding({
          kind: 'CROSS_AGENT_INVALIDATION',
          taskId: task.taskId,
          detail:
            `${task.taskId} a réellement muté ${path} qui est la cible déclarée de ${owner.taskId} ` +
            `(${owner.status}) sans dépendance directe déclarée entre elles (${chain}) — ` +
            `le livrable de ${owner.taskId} est invalidé ou contredit sans que le plan l'ait déclaré`,
          evidence: [path],
          repairable: false
        });
      }
    }
  }

  // Règle 2 : deux tâches complétées ont muté le MÊME chemin hors exigences
  // déclarées, sans dépendance directe → résultats contradictoires.
  for (let i = 0; i < completedTasks.length; i++) {
    for (let j = i + 1; j < completedTasks.length; j++) {
      const a = completedTasks[i]!;
      const b = completedTasks[j]!;
      if (directDep(a, b) || directDep(b, a)) continue;
      for (const path of a.mutationTrail) {
        if (!b.mutationTrail.includes(path)) continue;
        if (a.declaredTargets.includes(path) || b.declaredTargets.includes(path)) continue;
        const key = `${a.taskId}|${b.taskId}|${path}`;
        if (crossKeys.has(key)) continue;
        crossKeys.add(key);
        crossFound = true;
        pushFinding({
          kind: 'CROSS_AGENT_INVALIDATION',
          taskId: a.taskId,
          detail:
            `${a.taskId} et ${b.taskId} ont réellement muté le même chemin ${path} hors exigences déclarées, ` +
            `sans dépendance directe entre elles — résultats potentiellement contradictoires (le contenu final dépend de l'ordre réel d'écriture)`,
          evidence: [path],
          repairable: false
        });
      }
    }
  }

  if (completedTasks.length >= 2) {
    pushCheck({
      check: `cohérence multi-agents : aucune mutation croisée non déclarée entre ${completedTasks.length} tâche(s) complétée(s)`,
      passed: !crossFound,
      ...(crossFound ? { detail: 'au moins une invalidation/contradiction croisée détectée' } : {})
    });
  }

  return { tasks, counts, checks, findings };
}

// ---------------------------------------------------------------------------
// Décision (vocabulaire fermé, hiérarchie déterministe)
// ---------------------------------------------------------------------------

function decide(evidence: Evidence): SupervisionDecision {
  // 1. Un défaut de supervision précis domine : la mission n'est pas validable
  //    en l'état (défaut identifié, corrigeable ou non).
  if (evidence.findings.length > 0) return 'NEEDS_CORRECTION';
  const c = evidence.counts;
  // 2. Aucune partie vérifiable : dépendances non satisfaites / annulation.
  if (c.completed === 0 && (c.blocked > 0 || c.pending > 0 || c.cancelled > 0)) return 'BLOCKED';
  // 3. Échec réel, aucune partie validée : défaut précis (correction possible
  //    via le pipeline sécurisé si autorisée).
  if (c.completed === 0 && c.failed > 0) return 'NEEDS_CORRECTION';
  // 4. Une partie vérifiée, le solde non : PARTIAL, jamais présenté complet.
  if (c.completed < c.total) return 'PARTIAL';
  // 5. Tout est complété et aucune vérification n'échoue : VALIDATED.
  return 'VALIDATED';
}

// ---------------------------------------------------------------------------
// Candidats de correction ciblée
// ---------------------------------------------------------------------------

interface RepairCandidate {
  readonly taskId: string;
  readonly reason: string;
}

function repairCandidates(evidence: Evidence): readonly RepairCandidate[] {
  const candidates: RepairCandidate[] = [];
  const seen = new Set<string>();
  const push = (taskId: string, reason: string): void => {
    if (seen.has(taskId)) return;
    seen.add(taskId);
    candidates.push({ taskId, reason });
  };
  // Exigences du plan non satisfaites (précises et corrigeables).
  for (const finding of evidence.findings) {
    if (finding.kind === 'TARGET_MISMATCH' && finding.repairable) push(finding.taskId, finding.kind);
  }
  // Échecs réels SANS aucune partie validée : la ré-exécution bornée est la
  // seule correction possible (une mission partiellement réussie est présentée
  // honnêtement en PARTIAL — jamais relancée automatiquement).
  if (evidence.counts.completed === 0) {
    for (const task of evidence.tasks) {
      if (task.status === 'FAILED' && task.outcome !== undefined) push(task.taskId, 'TASK_FAILED');
    }
  }
  // Ordre déterministe = ordre des tâches du batch.
  const order = new Map(evidence.tasks.map((t, i) => [t.taskId, i] as const));
  return candidates.sort((x, y) => (order.get(x.taskId) ?? 0) - (order.get(y.taskId) ?? 0));
}

function clampRepairBudget(maxAttempts: number | undefined): number {
  const raw = maxAttempts ?? SUPERVISION_REPAIR_DEFAULT_ATTEMPTS;
  return Math.max(0, Math.min(SUPERVISION_REPAIR_MAX_ATTEMPTS_CAP, Math.floor(raw)));
}

/** Contexte de correction = EXACTEMENT celui du scheduler É37 (aucune invention). */
function buildRepairContext(task: AgentTask, tenantId: string, projectId: string): TaskContextPayload {
  const base: TaskContextPayload = {
    relevantFiles: {},
    relevantSymbols: [...(task.requiredContext.targetSymbols ?? [])],
    decisions: [],
    constraints: [],
    recentHistory: []
  };
  if (task.requiredContext.includeDna === true) {
    return { ...base, designContext: loadProjectDesignContext({ tenantId, projectId }) };
  }
  return base;
}

// ---------------------------------------------------------------------------
// Synthèse fidèle pour la réponse finale
// ---------------------------------------------------------------------------

function supervisionMessageSuffix(report: SupervisionReport): string {
  const passed = report.checks.filter((c) => c.passed).length;
  switch (report.decision) {
    case 'VALIDATED':
      if (report.repair.attempted) {
        return (
          ` Supervision É46 : VALIDATED après ${report.repair.attemptsUsed} correction(s) ciblée(s) autorisée(s) ` +
          `exécutée(s) via le pipeline sécurisé (re-vérification des livrables réels réussie : ` +
          `${report.counts.completed}/${report.counts.total}, exigences du plan, interdits É44, cohérence multi-agents).`
        );
      }
      return (
        ` Supervision É46 : VALIDATED — ${passed}/${report.checks.length} contrôle(s) de supervision réussi(s) sur ` +
        `livrables réels (exigences du plan, interdits É44, cohérence multi-agents).`
      );
    case 'PARTIAL':
      return (
        ` Supervision É46 : PARTIAL — ${report.counts.completed}/${report.counts.total} livrable(s) vérifié(s) ; ` +
        `le solde n est pas abouti (échecs/blocages réels listés ci-dessus), jamais présenté comme une mission complète.`
      );
    case 'NEEDS_CORRECTION': {
      const defectText =
        report.findings.length > 0
          ? `${report.findings.length} défaut(s) précis : ${report.findings
              .slice(0, 3)
              .map((f) => f.detail)
              .join(' | ')}`
          : 'tâche(s) en échec réel sans aucune partie validée';
      let repairText = '';
      if (report.repair.attempted) {
        repairText =
          ` ; correction ciblée tentée (${report.repair.attemptsUsed}/${report.repair.maxAttempts}) : ` +
          `re-vérification en échec ou partielle — aucun faux succès`;
      } else if (report.repair.refusalReason) {
        repairText = ` ; correction ciblée REFUSÉE (${report.repair.refusalReason})`;
      }
      return ` Supervision É46 : NEEDS_CORRECTION — ${defectText}${repairText}.`;
    }
    case 'BLOCKED':
      return (
        ` Supervision É46 : BLOCKED — vérification impossible : ${report.counts.blocked + report.counts.pending} ` +
        `tâche(s) jamais exécutée(s) (dépendance non satisfaite / annulation) — aucune partie inventée.`
      );
  }
}

// ---------------------------------------------------------------------------
// Supervision d'un batch complet (point d'entrée)
// ---------------------------------------------------------------------------

/**
 * Supervise le résultat GLOBAL d'un batch É37 : vérifie les livrables réels
 * contre les exigences du plan et les interdits É44, raisonne sur la cohérence
 * multi-agents, corrige (borné, OPT-IN, via le pipeline sécurisé) puis décide.
 */
export async function superviseBatchExecution(params: SuperviseBatchParams): Promise<SupervisionReport> {
  const protectedPaths = protectedPathsFromConstraints(params.conversation?.constraints);

  let tasks: TaskEvidence[] = params.outcome.tasks.map((record) => ({
    taskId: record.spec.taskId,
    status: record.status,
    outcome: record.outcome,
    declaredTargets: [...(record.spec.task.requiredContext.targetFiles ?? [])],
    dependencies: [...record.spec.dependencies],
    blockedReason: record.blockedReason,
    mutationTrail: committedPathsOf(record.outcome)
  }));

  let evidence = buildEvidence(tasks, protectedPaths);
  const initialDecision = decide(evidence);

  // --- Correction ciblée (OPT-IN, bornée, pipeline sécurisé) ----------------
  const maxAttempts = clampRepairBudget(params.repair?.maxAttempts);
  // É53 LOT E4.2 — CORRECTION F2 (audit G2) : annulation gagnante = signal
  // armé OU verdict scheduler CANCELLED. Dans ce cas la correction ciblée
  // est REFUSÉE : aucune tentative de re-exécution (budget préservé),
  // aucune fusion/reclassification (les statuts de supervision restent les
  // statuts RÉELS du scheduler É37), et le rapport final nomme l'annulation
  // au lieu de la masquer. Le repair reste OPT-IN et ce refus ne change
  // RIEN au comportement lorsque le signal n'est pas fourni.
  const cancellationWins =
    params.signal?.aborted === true || params.outcome.status === 'CANCELLED';
  const authorized =
    !cancellationWins &&
    params.repair?.enabled === true && maxAttempts > 0 && typeof params.repairExecutor === 'function';
  const attempts: SupervisionRepairAttempt[] = [];
  let attemptsUsed = 0;
  let refusalReason: string | undefined;
  if (cancellationWins) {
    refusalReason =
      params.signal?.aborted === true
        ? 'mission annulée (signal d annulation armé) — aucune correction ciblée tentée, aucun résultat annulé reclassé'
        : 'mission annulée (verdict batch CANCELLED) — aucune correction ciblée tentée, aucun résultat annulé reclassé';
  } else {
    const initialCandidates = repairCandidates(evidence);
    if (initialCandidates.length > 0 && !authorized) {
      refusalReason =
        params.repair?.enabled !== true
          ? 'aucune politique de correction ciblée activée (aucune autorisation explicite) — aucune re-exécution'
          : 'aucun exécuteur sécurisé attaché — aucune re-exécution possible';
    }
  }

  if (authorized) {
    // Les candidats sont arrêtés sur les preuves INITIALES : la correction
    // ciblée répare précisément ce qui a été détecté (mission sans aucune
    // partie validée et/ou exigences précises non satisfaites). Chaque
    // tentative est suivie d'une RE-VÉRIFICATION RÉELLE, et le budget reste
    // strict (anti-boucle). Une tâche déjà résolue entre-temps est ignorée.
    const plannedCandidates = repairCandidates(evidence);
    for (const candidate of plannedCandidates) {
      if (attemptsUsed >= maxAttempts) break;
      // É53 LOT E4.2 — CORRECTION F2 : annulation gagnante PENDANT la
      // supervision → arrêt immédiat et honnête (aucune tentative de
      // re-exécution après l'annulation, budget restant préservé).
      if (params.signal?.aborted === true) {
        refusalReason =
          'mission annulée pendant la supervision (signal d annulation armé) — correction ciblée stoppée';
        break;
      }
      const currentTask = tasks.find((t) => t.taskId === candidate.taskId);
      if (!currentTask || currentTask.status === 'COMPLETED') continue;
      const record = params.outcome.tasks.find((t) => t.spec.taskId === candidate.taskId);
      if (!record) break;
      attemptsUsed += 1;
      const repairExecutionId = `${params.outcome.executionId}--${candidate.taskId}--sup-repair-${attemptsUsed}`;
      try {
        const newOutcome = await params.repairExecutor!({
          executionId: repairExecutionId,
          agentId: record.spec.agentId,
          task: record.spec.task,
          context: buildRepairContext(record.spec.task, params.tenantId, params.projectId),
          tenantId: params.tenantId,
          projectId: params.projectId,
          ...(params.userRole !== undefined ? { userRole: params.userRole } : {}),
          ...(params.requestId !== undefined ? { requestId: `${params.requestId}--sup-repair-${attemptsUsed}` } : {})
        });
        attempts.push({
          taskId: candidate.taskId,
          executionId: repairExecutionId,
          outcomeStatus: newOutcome.status,
          ...(newOutcome.error !== undefined ? { error: newOutcome.error } : {}),
          ...(newOutcome.verification.performed ? { gatePassed: newOutcome.verification.passed } : {})
        });
        // Fusion HONNÊTE : le statut de la tâche dérive du NOUVEL outcome réel ;
        // le TRAIL conserve TOUTES les mutations réellement commises (résidu).
        tasks = tasks.map((task) => {
          if (task.taskId !== candidate.taskId) return task;
          const repaired = (newOutcome.status === 'SUCCESS' || newOutcome.status === 'DEGRADED');
          return {
            ...task,
            status: repaired ? ('COMPLETED' as MultiAgentTaskStatus) : ('FAILED' as MultiAgentTaskStatus),
            outcome: newOutcome,
            blockedReason: undefined,
            mutationTrail: unionPaths(task.mutationTrail, committedPathsOf(newOutcome))
          };
        });
      } catch (err: unknown) {
        attempts.push({
          taskId: candidate.taskId,
          executionId: repairExecutionId,
          outcomeStatus: 'EXCEPTION',
          error: err instanceof Error ? err.message : String(err)
        });
      }
      // RE-VÉRIFICATION RÉELLE : les contrôles sont recalculés sur les
      // outcomes réels de la tentative (jamais un booléen de l'agent).
      evidence = buildEvidence(tasks, protectedPaths);
    }
  }

  const decision = decide(evidence);

  // É47 — faits additifs calculés sur l'état FINAL (post-correction) : le
  // trail contient TOUTES les mutations réellement commises (initiales +
  // corrections) ; une exigence est « non satisfaite » si sa cible déclarée
  // n'apparaît dans AUCUN trail (tâche terminée avec écart ou jamais exécutée).
  const committedFiles = evidence.tasks
    .map((task) => ({ taskId: task.taskId, files: [...task.mutationTrail] }))
    .filter((entry) => entry.files.length > 0);
  const unmetFiles = evidence.tasks
    .map((task) => ({
      taskId: task.taskId,
      files:
        task.status === 'COMPLETED'
          ? task.declaredTargets.filter((path) => !task.mutationTrail.includes(path))
          : [...task.declaredTargets]
    }))
    .filter((entry) => entry.files.length > 0);

  // --- Synthèse fidèle ------------------------------------------------------
  let summary: string;
  // É53 LOT E4.2 — CORRECTION F2 : une mission annulée est nommée comme
  // telle dans la synthèse (jamais masquée derrière un verdict partiel ou
  // une correction « non autorisée »).
  if (cancellationWins) {
    summary =
      `Mission ANNULÉE : l'exécution a été annulée (${params.signal?.aborted === true ? 'signal d annulation armé' : 'verdict batch CANCELLED'}) — ` +
      `${evidence.counts.completed}/${evidence.counts.total} livrable(s) complété(s) avant annulation, ` +
      `${evidence.counts.failed} échec(s), ${evidence.counts.cancelled} annulée(s) ; ` +
      `aucune correction ciblée tentée, aucun résultat annulé reclassé.`;
  } else if (decision === 'VALIDATED' && attemptsUsed > 0) {
    summary =
      `Mission VALIDATED : ${evidence.counts.completed}/${evidence.counts.total} livrable(s) vérifié(s) sur la source réelle ` +
      `après ${attemptsUsed} correction(s) ciblée(s) via le pipeline sécurisé (exigences du plan satisfaites, interdits É44 respectés, cohérence multi-agents vérifiée).`;
  } else if (decision === 'VALIDATED') {
    summary =
      `Mission VALIDATED : ${evidence.counts.completed}/${evidence.counts.total} livrable(s) vérifié(s) sur la source réelle ` +
      `(exigences du plan satisfaites, interdits É44 respectés, cohérence multi-agents vérifiée).`;
  } else if (decision === 'PARTIAL') {
    summary =
      `Mission PARTIAL : ${evidence.counts.completed}/${evidence.counts.total} livrable(s) vérifié(s) ; ` +
      `${evidence.counts.failed} échec(s), ${evidence.counts.blocked} bloquée(s), ${evidence.counts.pending} en attente, ` +
      `${evidence.counts.cancelled} annulée(s) — le résultat partiel est présenté tel quel.`;
  } else if (decision === 'BLOCKED') {
    summary =
      `Mission BLOCKED : vérification impossible — ${evidence.counts.blocked} bloquée(s), ${evidence.counts.pending} en attente, ` +
      `${evidence.counts.cancelled} annulée(s) (dépendance non satisfaite / annulation), aucune partie inventée.`;
  } else if (evidence.findings.length > 0) {
    summary =
      `Mission NEEDS_CORRECTION : ${evidence.findings.length} défaut(s) précis identifié(s) sur livrables réels ` +
      `(${attemptsUsed > 0 ? `correction ciblée tentée ${attemptsUsed}/${maxAttempts}` : refusalReason ?? 'correction ciblée non autorisée'}).`;
  } else {
    summary =
      `Mission NEEDS_CORRECTION : ${evidence.counts.failed} tâche(s) en échec réel, aucune partie validée ` +
      `(${attemptsUsed > 0 ? `correction ciblée tentée ${attemptsUsed}/${maxAttempts}, re-vérification en échec` : refusalReason ?? 'correction ciblée non autorisée'}).`;
  }

  const report: SupervisionReport = deepFreeze({
    planId: params.planId,
    decision,
    initialDecision,
    batchStatus: params.outcome.status,
    counts: evidence.counts,
    checks: evidence.checks,
    findings: evidence.findings,
    repair: deepFreeze({
      authorized,
      attempted: attemptsUsed > 0,
      attemptsUsed,
      maxAttempts,
      attempts: deepFreeze(attempts),
      ...(refusalReason !== undefined ? { refusalReason } : {})
    }),
    summary,
    committedFiles: deepFreeze(committedFiles.map((entry) => deepFreeze({ ...entry, files: deepFreeze(entry.files) }))),
    unmetFiles: deepFreeze(unmetFiles.map((entry) => deepFreeze({ ...entry, files: deepFreeze(entry.files) })))
  });
  return report;
}

/** Suffixe fidèle ajouté au message de résultat (décision + preuves). */
export function supervisionMessageSuffixFor(report: SupervisionReport): string {
  return supervisionMessageSuffix(report);
}
