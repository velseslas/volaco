/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-010)
 * É47 — Composeur de la réponse finale : traduire le résultat RÉEL
 * (ExecutionResult + rapport de supervision É46) en une réponse
 * conversationnelle professionnelle, naturelle et HONNÊTE.
 *
 * Principe fondateur : la réponse finale est construite UNIQUEMENT à partir
 * de faits vérifiés — les livrables réellement commis (trail du superviseur),
 * les exigences du plan non satisfaites, les interdits É44, les conflits
 * inter-agents, les corrections réellement exécutées et leurs verdicts réels.
 * Elle n'invente JAMAIS un résultat, ne masque JAMAIS un échec et n'améliore
 * JAMAIS le statut réel d'une mission (VALIDATED / NEEDS_CORRECTION / BLOCKED /
 * PARTIAL restent la seule source de vérité — héritage É46).
 *
 * Ce module n'est PAS un moteur de réponse parallèle : c'est une composition
 * déterministe (sans LLM, sans réseau) des résultats vérifiés existants.
 * Le message technique `ExecutionResult.message` reste inchangé (contrats
 * É39–É46 gelés) ; `userReply` est la réponse présentée à l'utilisateur.
 *
 * Adaptation (axe 3) : la structure varie selon le statut réel (réussie,
 * partielle, bloquée, à corriger), le type de mission (mono-agent vs
 * multi-agents) et les faits présents — jamais un rapport générique répété.
 */

import type { SupervisionDecision, SupervisionReport } from './supervisor.js';
import type { MultiAgentSchedulerOutcome } from '../../ai-orchestrator/execution/multi-agent-scheduler.js';
import type { AgentExecutionOutcome } from '../../ai-orchestrator/execution/agent-execution.js';
import type { ConversationTaskContext } from './intent-router.js';

// ---------------------------------------------------------------------------
// Contrats publics
// ---------------------------------------------------------------------------

export type ExecutionReplyKind = 'BATCH' | 'ROUTED' | 'REFUSED';

/** Faits RÉELS assemblés pour composer la réponse (aucune invention). */
export interface ExecutionReplyFacts {
  readonly kind: ExecutionReplyKind;
  /** Décision du superviseur É46 (batch) — absente sur le chemin routé. */
  readonly decision?: SupervisionDecision | undefined;
  readonly success: boolean;
  /** Contenu dégradé (DEGRADED — repli local au lieu du LLM). */
  readonly degraded?: boolean | undefined;
  /** Compteurs vérifiés (batch). */
  readonly counts?: {
    readonly completed: number;
    readonly failed: number;
    readonly blocked: number;
    readonly pending: number;
    readonly cancelled: number;
    readonly total: number;
  } | undefined;
  /** Livrables RÉELLEMENT commis (toutes tentatives confondues — trail). */
  readonly producedFiles: readonly string[];
  /** Exigences du plan JAMAIS satisfaites (à l'état final). */
  readonly missingDeclaredFiles: readonly string[];
  /** Mutations hors exigence (résidus laissés en place). */
  readonly offPlanFiles: readonly string[];
  /** Interdits É44 ENFREINTS (chemin + contrainte d'origine). */
  readonly forbiddenViolated: readonly {
    readonly path: string;
    readonly constraint: string;
  }[];
  /** Conflits inter-agents détectés (résumés courts). */
  readonly crossInvalidations: readonly string[];
  /** Tâches non abouties (échec réel ou jamais exécutée) + raison réelle. */
  readonly unresolvedTasks: readonly {
    readonly taskId: string;
    /** Libellé conversationnel : fichier déclaré de l'étape (pas l'identifiant interne). */
    readonly label: string;
    readonly reason: string;
    readonly neverStarted: boolean;
  }[];
  readonly repair?: {
    readonly attempted: boolean;
    readonly attemptsUsed: number;
    readonly maxAttempts: number;
    readonly refusalReason?: string | undefined;
    readonly outcomes: readonly string[];
  } | undefined;
  /** Chemin routé : agent réellement désigné. */
  readonly agentLabel?: string | undefined;
  /** Batch : nombre d'agents distincts réellement mobilisés. */
  readonly agentCount?: number | undefined;
  /** Raison de refus (aucune exécution). */
  readonly reason?: string | undefined;
  /** Contraintes interdictives actives de la session (É44). */
  readonly interdictionConstraints: readonly string[];
}

// ---------------------------------------------------------------------------
// Extraction des faits RÉELS (déterministe, depuis les outcomes vérifiés)
// ---------------------------------------------------------------------------

/** Chemins réellement commis par UN outcome É36 (SUCCESS/DEGRADED uniquement). */
function committedPathsOfOutcome(outcome: AgentExecutionOutcome | undefined): readonly string[] {
  if (!outcome || (outcome.status !== 'SUCCESS' && outcome.status !== 'DEGRADED')) return [];
  const paths: string[] = [];
  for (const artifact of outcome.artifacts) {
    if (artifact.kind !== 'PROPOSED_FILE_CHANGE') continue;
    const payload = artifact.payload as { filePath?: unknown } | undefined;
    const filePath = payload && typeof payload.filePath === 'string' ? payload.filePath.trim() : '';
    if (filePath.length > 0 && !paths.includes(filePath)) paths.push(filePath);
  }
  return paths;
}

const union = (a: readonly string[], b: readonly string[]): readonly string[] => {
  const merged = [...a];
  for (const x of b) if (!merged.includes(x)) merged.push(x);
  return merged;
};

/** Contraintes interdictives actives (formulations contenant un chemin nommé). */
const INTERDICTION_HINTS: readonly string[] = ['interdit', 'ne modifie', 'ne pas modifier', 'ne jamais', 'ne supprime', 'ne touche', 'sans toucher', 'ne cree', 'ne pas creer', 'intact'];
const stripAccents = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const norm = (s: string): string => stripAccents(s).toLowerCase();

export function isInterdictionConstraint(constraint: string): boolean {
  const normalized = norm(constraint);
  return INTERDICTION_HINTS.some((h) => normalized.includes(norm(h)));
}

/**
 * Faits du chemin BATCH (avec rapport de supervision É46). Les livrables
 * réels viennent du trail FUSIONNÉ du superviseur (tentatives initiales +
 * corrections), pas des seules déclarations initiales.
 */
export function extractReplyFactsFromBatch(
  outcome: MultiAgentSchedulerOutcome,
  supervision: SupervisionReport | undefined,
  conversation: ConversationTaskContext | undefined
): ExecutionReplyFacts {
  const declaredTargets: string[] = [];
  for (const record of outcome.tasks) {
    for (const target of record.spec.task.requiredContext.targetFiles ?? []) {
      if (!declaredTargets.includes(target)) declaredTargets.push(target);
    }
  }

  let producedFiles: readonly string[] = [];
  let missingDeclaredFiles: readonly string[] = [];
  if (supervision) {
    for (const committed of supervision.committedFiles) {
      producedFiles = union(producedFiles, committed.files);
    }
    for (const unmet of supervision.unmetFiles) {
      missingDeclaredFiles = union(missingDeclaredFiles, unmet.files);
    }
  } else {
    for (const record of outcome.tasks) {
      producedFiles = union(producedFiles, committedPathsOfOutcome(record.outcome));
    }
    missingDeclaredFiles = [];
  }

  const offPlanFiles = producedFiles.filter((p) => !declaredTargets.includes(p));

  const forbiddenViolated: { path: string; constraint: string }[] = [];
  const crossInvalidations: string[] = [];
  if (supervision) {
    for (const finding of supervision.findings) {
      if (finding.kind === 'FORBIDDEN_PATH_MUTATED') {
        const path = finding.evidence[0] ?? '';
        const match = /«([^»]+)»/.exec(finding.detail);
        forbiddenViolated.push({ path, constraint: match?.[1] ?? finding.detail });
      } else if (finding.kind === 'CROSS_AGENT_INVALIDATION') {
        crossInvalidations.push(`${finding.taskId} → ${finding.evidence.join(', ')}`);
      }
    }
  }

  const unresolvedTasks: { taskId: string; label: string; reason: string; neverStarted: boolean }[] = [];
  // É47 — libellé conversationnel : le FICHIER déclaré de l'étape (pas
  // l'identifiant interne step-N). Contrat É39 : exactement un fichier cible
  // par tâche de mutation ; repli sur l'identifiant sinon.
  const labelByTask = new Map<string, string>();
  for (const record of outcome.tasks) {
    const declared = record.spec.task.requiredContext.targetFiles ?? [];
    labelByTask.set(record.spec.taskId, declared[0] ?? record.spec.taskId);
  }
  for (const record of outcome.tasks) {
    const label = labelByTask.get(record.spec.taskId) ?? record.spec.taskId;
    if (record.status === 'FAILED') {
      unresolvedTasks.push({
        taskId: record.spec.taskId,
        label,
        reason: record.outcome?.error ?? 'échec réel sans message d erreur',
        neverStarted: false
      });
    } else if (record.status === 'BLOCKED') {
      unresolvedTasks.push({
        taskId: record.spec.taskId,
        label,
        reason: record.blockedReason ?? 'dépendance non satisfaite',
        neverStarted: true
      });
    } else if (record.status === 'PENDING') {
      unresolvedTasks.push({
        taskId: record.spec.taskId,
        label,
        reason: record.blockedReason ?? 'arrêt du batch avant son tour',
        neverStarted: true
      });
    }
  }

  const repair = supervision
    ? {
        attempted: supervision.repair.attempted,
        attemptsUsed: supervision.repair.attemptsUsed,
        maxAttempts: supervision.repair.maxAttempts,
        ...(supervision.repair.refusalReason !== undefined
          ? { refusalReason: supervision.repair.refusalReason }
          : {}),
        outcomes: supervision.repair.attempts.map((a) => {
          const l = labelByTask.get(a.taskId) ?? a.taskId;
          return `« ${trunc(l, 80)} » re-exécutée → ${a.outcomeStatus}`;
        })
      }
    : undefined;

  const interdictionConstraints = (conversation?.constraints ?? []).filter((c) => isInterdictionConstraint(c));
  const distinctAgents = new Set(outcome.tasks.map((t) => t.spec.agentId));

  return {
    kind: 'BATCH',
    ...(supervision ? { decision: supervision.decision } : {}),
    success: supervision ? supervision.decision === 'VALIDATED' : outcome.status === 'COMPLETED',
    degraded: outcome.tasks.some((t) => t.outcome?.status === 'DEGRADED'),
    counts: supervision
      ? { ...supervision.counts }
      : {
          completed: outcome.counts.completed,
          failed: outcome.counts.failed,
          blocked: outcome.counts.blocked,
          pending: outcome.counts.pending,
          cancelled: outcome.counts.cancelled,
          total: outcome.counts.total
        },
    producedFiles,
    missingDeclaredFiles,
    offPlanFiles,
    forbiddenViolated,
    crossInvalidations,
    unresolvedTasks,
    ...(repair ? { repair } : {}),
    agentCount: distinctAgents.size,
    interdictionConstraints
  };
}

/** Faits du chemin ROUTÉ mono-agent (contrat É32/É36 honnête, sans superviseur). */
export function extractReplyFactsFromRouted(
  outcome: AgentExecutionOutcome,
  conversation: ConversationTaskContext | undefined
): ExecutionReplyFacts {
  const succeeded = outcome.status === 'SUCCESS' || outcome.status === 'DEGRADED';
  return {
    kind: 'ROUTED',
    success: succeeded,
    ...(outcome.status === 'DEGRADED' ? { degraded: true } : {}),
    producedFiles: succeeded ? committedPathsOfOutcome(outcome) : [],
    missingDeclaredFiles: [],
    offPlanFiles: [],
    forbiddenViolated: [],
    crossInvalidations: [],
    unresolvedTasks: succeeded
      ? []
      : [{ taskId: outcome.taskId, label: 'la tâche demandée', reason: outcome.error ?? `statut ${outcome.status}`, neverStarted: false }],
    agentLabel: outcome.agentId,
    interdictionConstraints: (conversation?.constraints ?? []).filter((c) => isInterdictionConstraint(c))
  };
}

/** Faits d'un REFUS (aucune exécution — analyse É39/É45 ou scheduler É37). */
export function extractReplyFactsFromRefusal(
  reason: string,
  conversation: ConversationTaskContext | undefined
): ExecutionReplyFacts {
  return {
    kind: 'REFUSED',
    success: false,
    producedFiles: [],
    missingDeclaredFiles: [],
    offPlanFiles: [],
    forbiddenViolated: [],
    crossInvalidations: [],
    unresolvedTasks: [],
    reason,
    interdictionConstraints: (conversation?.constraints ?? []).filter((c) => isInterdictionConstraint(c))
  };
}

// ---------------------------------------------------------------------------
// Composition de la réponse (déterministe, adaptée, honnête)
// ---------------------------------------------------------------------------

/** « a, b et c » (liste naturelle française). */
function fmtList(items: readonly string[]): string {
  const clean = items.filter((x) => x.length > 0);
  if (clean.length === 0) return '';
  if (clean.length === 1) return clean[0]!;
  return `${clean.slice(0, -1).join(', ')} et ${clean[clean.length - 1]}`;
}

const trunc = (s: string, max = 120): string => {
  const clean = s.trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
};

/** Retire le préfixe interne d'extraction des contraintes (présentation). */
const cleanConstraint = (c: string, max = 100): string =>
  trunc(c.replace(/^\s*Extracted constraint:\s*/i, ''), max);

const VERIFICATION_SCOPE =
  'La vérification porte sur la présence réelle des fichiers exigés, le respect de vos interdits et la cohérence entre agents ; elle n évalue pas la conformité du contenu de ces fichiers.';

/**
 * Compose la réponse conversationnelle finale depuis les faits vérifiés.
 * Aucune invention : chaque phrase est dérivée d'un fait réel ; un statut
 * d'échec n'est JAMAIS transformé en annonce de réussite.
 */
export function composeExecutionReply(facts: ExecutionReplyFacts): string {
  const lines: string[] = [];

  // --- REFUS : aucune exécution, raison précise ----------------------------
  if (facts.kind === 'REFUSED') {
    lines.push(`Je n'ai rien exécuté : ${trunc(facts.reason ?? 'demande non exécutable en l état', 240)}.`);
    if (facts.interdictionConstraints.length > 0) {
      lines.push(
        `Vos interdits actifs restent en vigueur : ${fmtList(facts.interdictionConstraints.map((c) => cleanConstraint(c)))}.`
      );
    }
    return lines.join(' ');
  }

  // --- ROUTÉ mono-agent : réponse courte et claire --------------------------
  if (facts.kind === 'ROUTED') {
    if (facts.success) {
      const files = fmtList(facts.producedFiles);
      lines.push(
        facts.producedFiles.length > 0
          ? `C'est fait : ${files} ${facts.producedFiles.length > 1 ? 'sont réellement en place' : 'est réellement en place'} (écriture vérifiée sur la source).`
          : "C'est fait : la tâche ne demandait aucune écriture de fichier."
      );
      if (facts.degraded) lines.push('Le contenu provient d un repli local, pas du modèle demandé — re-exécutable si vous préférez.');
      lines.push('Cette vérification confirme l écriture du fichier, pas la conformité de son contenu.');
    } else {
      const reason = trunc(facts.unresolvedTasks[0]?.reason ?? 'échec sans message', 160);
      lines.push(`Cette partie n'a pas abouti : l'agent ${facts.agentLabel ?? 'désigné'} a échoué (${reason}). Rien n'a été écrit.`);
      lines.push('Dites-moi si je dois retenter, ou si vous préférez ajuster la demande.');
    }
    return lines.join(' ');
  }

  // --- BATCH multi-agents ----------------------------------------------------
  const counts = facts.counts;
  const decision = facts.decision;

  // 1. Phrase d'état (jamais d'amélioration du statut réel ; le statut du
  //    superviseur est nommé explicitement — auditabilité et honnêteté).
  if (decision === 'VALIDATED') {
    lines.push('Mission terminée (VALIDATED) : tout ce qui était exigé est réellement en place.');
  } else if (decision === 'PARTIAL') {
    lines.push(
      `Mission partiellement terminée (PARTIAL) : ${counts?.completed ?? 0} des ${counts?.total ?? 0} éléments ${
        (counts?.completed ?? 0) === 1 ? 'est' : 'sont'
      } réellement en place, le reste n'a pas abouti.`
    );
  } else if (decision === 'BLOCKED') {
    lines.push('Mission arrêtée (BLOCKED) : rien n a été mis en place — la suite n a jamais pu démarrer.');
    lines.push('Aucune vérification de livrable n était possible : aucune écriture n a été commise sur la source.');
  } else if (decision === 'NEEDS_CORRECTION') {
    if (facts.producedFiles.length === 0) {
      lines.push('La mission a échoué (NEEDS_CORRECTION) : aucune partie n a pu être mise en place.');
    } else {
      lines.push(
        "Le travail n'est pas utilisable en l'état (NEEDS_CORRECTION) : des écarts réels ont été détectés sur les livrables."
      );
    }
  } else {
    // Pas de supervision (cas résiduel) : verdict brut honnête.
    lines.push(
      counts && counts.completed === counts.total
        ? 'Mission terminée : tous les éléments demandés ont été exécutés.'
        : `Exécution terminée avec un statut incomplet : ${counts?.completed ?? 0}/${counts?.total ?? 0} élément(s) abouti(s).`
    );
  }

  // 2. Ce qui a été réellement produit (trail vérifié, pas des déclarations).
  if (facts.producedFiles.length > 0) {
    lines.push(`En place, vérifié sur la source : ${fmtList(facts.producedFiles.map((p) => trunc(p, 90)))}.`);
  }

  // 3. Ce qui n'a pas abouti (échecs réels + jamais exécutés), nommé par le
  //    fichier demandé — jamais par un identifiant interne. Quand une
  //    correction a été tentée ET a abouti, ces échecs appartiennent à la
  //    première passe : le cadrage l'explicite (l'état final est en place).
  const failed = facts.unresolvedTasks.filter((t) => !t.neverStarted);
  const neverStarted = facts.unresolvedTasks.filter((t) => t.neverStarted);
  if (failed.length > 0) {
    const intro =
      facts.repair?.attempted && decision === 'VALIDATED' ? 'Première passe — non abouti' : 'Non abouti';
    lines.push(
      `${intro} : ${failed
        .map((t) => `la partie « ${trunc(t.label, 90)} » a échoué (${trunc(t.reason, 90)})`)
        .join(' ; ')}.`
    );
  }
  if (neverStarted.length > 0) {
    lines.push(
      `Jamais exécuté : ${fmtList(neverStarted.map((t) => `« ${trunc(t.label, 90)} »`))} — ${
        neverStarted.length > 1
          ? 'dépendances non satisfaites ou arrêt du batch'
          : 'dépendance non satisfaite ou arrêt du batch'
      }.`
    );
  }

  // 4. Écarts réels détectés (exigences, hors exigence, interdits, conflits).
  if (facts.missingDeclaredFiles.length > 0) {
    lines.push(`Exigences non satisfaites : ${fmtList(facts.missingDeclaredFiles.map((p) => trunc(p, 90)))}.`);
  }
  if (facts.offPlanFiles.length > 0) {
    lines.push(`Livrés hors exigence (laissés en place — je ne supprime rien sans votre accord) : ${fmtList(facts.offPlanFiles.map((p) => trunc(p, 90)))}.`);
  }
  if (facts.forbiddenViolated.length > 0) {
    lines.push(
      `Interdits enfreints : ${facts.forbiddenViolated
        .map((f) => `${trunc(f.path, 90)} (contrainte « ${cleanConstraint(f.constraint, 90)} »)`)
        .join(' ; ')}.`
    );
  } else if (facts.interdictionConstraints.length > 0 && decision === 'VALIDATED') {
    lines.push(
      `Vos interdits actifs ont été respectés (${facts.interdictionConstraints.map((c) => cleanConstraint(c, 80)).join(' ; ')}).`
    );
  }
  if (facts.crossInvalidations.length > 0) {
    lines.push(`Conflit entre agents : ${fmtList(facts.crossInvalidations.map((c) => trunc(c, 110)))}.`);
  }

  // 5. Corrections : décrites honnêtement (tentées, réussies, échouées, refusées).
  if (facts.repair) {
    if (facts.repair.attempted) {
      const detail = facts.repair.outcomes.length > 0 ? ` : ${facts.repair.outcomes.join(' ; ')}` : '';
      if (decision === 'VALIDATED') {
        lines.push(
          `Correction ciblée effectuée via le pipeline sécurisé (${facts.repair.attemptsUsed} tentative(s))${detail} — re-vérification réussie.`
        );
      } else {
        lines.push(
          `Correction ciblée tentée (${facts.repair.attemptsUsed}/${facts.repair.maxAttempts})${detail} — la re-vérification n'a pas suffi, je n'annonce donc aucun succès.`
        );
      }
    } else if (facts.repair.refusalReason) {
      lines.push(`Correction automatique non appliquée : ${trunc(facts.repair.refusalReason, 140)}.`);
    }
  }

  // 6. Limites de vérification explicites (sur les missions avec livrables).
  if (decision === 'VALIDATED' || decision === 'PARTIAL') {
    lines.push(VERIFICATION_SCOPE);
  }

  // 7. Prochaine étape pertinente (proposition honnête, jamais une promesse).
  if (decision === 'PARTIAL' || decision === 'NEEDS_CORRECTION' || decision === 'BLOCKED') {
    lines.push("Dites-moi comment vous voulez procéder : retenter la partie manquante, ajuster la demande, ou inspecter les détails ci-dessus.");
  }

  return lines.join(' ');
}
