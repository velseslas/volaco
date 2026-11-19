/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-009)
 * É41 — Conversation Reference Resolver (anaphore & références)
 *
 * Détection et résolution DÉTERMINISTES des références conversationnelles
 * vers des cibles concrètes déjà présentes dans l'état de la session :
 *   - clitiques hyphénés : « Modifie-le », « Ajoute-les », « Regarde-la »,
 *     « Ajoute-en » — un mot composé lexical (« week-end », « e-learning »,
 *     « arc-en-ciel ») NE déclenche PAS la détection (aucun mot ne suit le
 *     clitique) ;
 *   - démonstratif + nom technique FERMÉ : « cette page », « ce fichier »,
 *     « ces composants », « le même fichier », « this file » — « cette
 *     préférence », « ce nom », « ce style » ou « ce code » ne sont PAS des
 *     références de cible (aucun faux positif sur la mémoire projet) ;
 *   - ordinaux : « garde la première version », « the first version ».
 *
 * Les référents viennent UNIQUEMENT de l'état de la session (plan actif,
 * plans des tours précédents, fichiers nommés par l'utilisateur dans ses
 * derniers messages). Aucun référent n'est INVENTÉ : si la session ne
 * contient rien de résolvable, le résultat est vide et le parcours
 * conversationnel garde son incomplétude honnête.
 *
 * Fonctions pures : même (message, session) → même résultat. Aucune
 * horloge, aucun aléa, aucune écriture, aucun appel réseau.
 */

import { deepFreeze } from './canonical.js';
import { extractSourceFiles } from './intent-router.js';
import type {
  ConversationAssumption,
  ConversationSession,
  EngineeringPlan,
  PlanStep
} from '../types.js';

/**
 * Clitiques hyphénés post-verbaux. La garde lookahead interdit ce qui suit :
 *   - un mot composé lexical (« week-end », « e-learning ») : le clitique
 *     n'est PAS suivi d'un mot → rejeté ;
 *   - un composé continué par un trait d'union NON pronominal
 *     (« arc-en-ciel », « trompe-l'œil ») → rejeté, MAIS une chaîne
 *     postverbale réelle (« mets-les-moi », « ajoute-le-là ») reste
 *     détectée.
 */
const CLITIC_REFERENCE_PATTERN = new RegExp(
  String.raw`-(?:les|le|la|l|en|y)(?=\s|[,.;:!?)]|$|['-](?:moi|toi|lui|nous|vous|là)\b)`,
  'i'
);

/**
 * Noms FERMÉS d'artéfacts techniques : seuls ces noms derrière un
 * démonstratif signalent une référence de cible. La liste est volontairement
 * restreinte (préférence/configuration/nom/style/code n'y figurent pas).
 */
const REFERENT_NOUN = String.raw`(?:fichiers?|files?|pages?|composants?|components?|modules?|fonctions?|functions?|sections?|formulaires?|forms?|versions?|vues|écrans?|ecrans?|widgets?|cartes?|blocs?)`;

/**
 * Démonstratif (+ « le même ») suivi d'un nom technique fermé.
 */
const DEMONSTRATIVE_REFERENCE_PATTERN = new RegExp(
  String.raw`\b(?:cet|cette|ce|ces|le m[êe]me|la m[êe]me|les m[êe]mes|this|that|these|those)\s+${REFERENT_NOUN}\b`,
  'i'
);

/**
 * « le même » / « la même » / « les mêmes » sans nom derrière (« reprends le
 * même ») — référence explicite à l'artéfact courant.
 */
const BARE_DEMONSTRATIVE_PATTERN = /\b(?:le|la|les)\s+m[êe]mes?\b/i;

/**
 * Ordinal : « la première version », « première version », « the first
 * version » — l'utilisateur désigne une version antérieure de l'artefact.
 */
const ORDINAL_REFERENCE_PATTERN = /\b(?:la\s+)?premi[èe]re\s+version\b|\bthe\s+first\s+version\b/i;

/** Opérations de plan qui MUTENT réellement des fichiers. */
const MUTATION_OPERATIONS: ReadonlySet<PlanStep['operation']> = new Set(['CREATE', 'MODIFY', 'DELETE']);

/** Un motif de référence conversationnelle est-il présent dans le message ? */
export function detectConversationReference(message: string): boolean {
  if (CLITIC_REFERENCE_PATTERN.test(message)) return true;
  if (DEMONSTRATIVE_REFERENCE_PATTERN.test(message)) return true;
  if (BARE_DEMONSTRATIVE_PATTERN.test(message)) return true;
  if (ORDINAL_REFERENCE_PATTERN.test(message)) return true;
  return false;
}

/** La référence est-elle au pluriel (« -les », « ces fichiers », « les mêmes ») ? */
export function isPluralReference(message: string): boolean {
  if (/-(?:les)\b/i.test(message)) return true;
  if (/\bles\s+m[êe]mes\b/i.test(message)) return true;
  const demonstrative = message.match(DEMONSTRATIVE_REFERENCE_PATTERN);
  if (demonstrative) {
    // Tous les noms fermés pluriels se terminent par « s »
    // (fichiers, pages, composants, vues, écrans…).
    const noun = demonstrative[0].trim().split(/\s+/).pop() ?? '';
    if (/s$/i.test(noun)) return true;
  }
  return false;
}

/** Cibles de mutation réelles d'un plan, triées par stepIndex. */
function mutationFilesOfPlan(plan: EngineeringPlan | undefined, plural: boolean): readonly string[] {
  const steps = (plan?.steps ?? [])
    .filter(
      (step) =>
        MUTATION_OPERATIONS.has(step.operation) &&
        Array.isArray(step.targetFiles) &&
        step.targetFiles.length > 0
    )
    .sort((a, b) => a.stepIndex - b.stepIndex);
  if (steps.length === 0) return [];
  if (plural) {
    const files: string[] = [];
    for (const step of steps) {
      for (const file of step.targetFiles ?? []) {
        if (!files.includes(file)) files.push(file);
      }
    }
    return files;
  }
  // Référence SINGULIÈRE : la DERNIÈRE étape de mutation du plan (la plus
  // récente dans l'ordre d'énoncé de l'utilisateur).
  return [...(steps[steps.length - 1]?.targetFiles ?? [])];
}

/**
 * Résout les références du message vers des cibles concrètes de la session.
 * Ordre décroissant de pertinence :
 *   1. le plan ACTIF de la session (objet de la confirmation en cours) ;
 *   2. les plans des tours précédents (du plus récent au plus ancien) ;
 *   3. les fichiers NOMMÉS par l'utilisateur dans ses derniers messages
 *      (extractSourceFiles — même définition d'un « fichier cible nommé »
 *      que le routage É33/É34 et le générateur de plans É40).
 * Retourne [] si rien n'est résolvable (aucune invention).
 */
export function resolveConversationReferents(message: string, session: ConversationSession): readonly string[] {
  const plural = isPluralReference(message);

  // 1. Plan actif.
  const fromActivePlan = mutationFilesOfPlan(session.activePlan, plural);
  if (fromActivePlan.length > 0) return fromActivePlan;

  // 2. Plans des tours précédents (du plus récent au plus ancien).
  for (let i = session.turns.length - 1; i >= 0; i--) {
    const files = mutationFilesOfPlan(session.turns[i]?.plan, plural);
    if (files.length > 0) return files;
  }

  // 3. Fichiers nommés par l'utilisateur dans ses derniers messages.
  for (let i = session.turns.length - 1; i >= 0; i--) {
    const files = extractSourceFiles(session.turns[i]?.userMessage.content ?? '');
    if (files.length > 0) {
      return plural ? files : [files[files.length - 1]!];
    }
  }

  return [];
}

/** Troncature bornée d'un extrait pour les libellés lisibles. */
function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/**
 * Hypothèse TRACÉE de la résolution : la compréhension d'une référence est
 * une hypothèse documentée (jamais invisible), LOW risk, réversible et sans
 * confirmation requise — le plan reste confirmable normalement.
 */
export function buildReferenceAssumption(message: string, referents: readonly string[]): ConversationAssumption {
  return deepFreeze({
    id: 'assump_conversation_reference',
    statement: `Les références du message (« ${truncate(message, 80)} ») désignent : ${referents.join(', ')}.`,
    confidence: 0.8,
    evidence: `Référents trouvés dans l'état de la conversation (plan actif, tours précédents ou fichiers nommés par l'utilisateur).`,
    risk: 'LOW' as const,
    reversible: true,
    requiresConfirmation: false,
    status: 'PROPOSED' as const
  });
}
