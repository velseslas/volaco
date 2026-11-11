/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-010)
 * Specialized UI & Design Agent
 */

import { BaseSpecializedAgent } from './base-agent.js';
import type { AgentArtifact, AgentTask, TaskContextPayload } from '../types.js';
import type { AIProviderRegistry } from '../../../ai/providers/registry.js';
import type { ProjectDesignContext } from '../../design-harmony/design-context.js';

/**
 * CDC V8 §11 — Explication structurée des choix UI (« Pourquoi »), dérivée
 * STRICTEMENT des champs réels du Design DNA injecté (aucun texte libre,
 * aucun LLM, aucun Math.random — déterminisme §16). Chaque chaîne cite la
 * preuve de dérivation canonique (design-direction.ts / tokens du rapport) ;
 * un champ absent reste absent (honnêteté — jamais de valeur inventée).
 */
export interface DesignRationalePayload {
  readonly reportId: string;
  readonly generatedAt: string;
  readonly overallScore: number;
  readonly directionSource: ProjectDesignContext['directionSource'];
  /** Dimensions §6 réellement connues au moment de la génération. */
  readonly direction: Record<string, string>;
  readonly rulesApplied: { readonly count: number; readonly catalogVersion: string };
  readonly decisionsRespected: number;
  readonly correctionsExpected: number;
  readonly components: { readonly catalogVersion: string; readonly available: number };
  /** Chaînes canoniques « preuve → conséquence UI » (ordre stable, bornées). */
  readonly reasons: readonly string[];
}

const RATIONALE_MAX_SENTENCE = 180;

function rationaleSentence(parts: readonly (string | number | undefined | null)[]): string | undefined {
  const sentence = parts
    .map((part) => (part === undefined || part === null ? '' : String(part)))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (sentence.length === 0) return undefined;
  return sentence.length <= RATIONALE_MAX_SENTENCE
    ? sentence
    : `${sentence.slice(0, RATIONALE_MAX_SENTENCE - 1).trimEnd()}…`;
}

/**
 * M-1 (AUD-M1-02) — provenance RÉELLE des décisions §24 actives : le payload
 * distingue les décisions HUMAN (utilisateur), AGENT et IMPROVEMENT sans
 * jamais inventer une origine non fournie par la source.
 */
function decisionSourceBreakdown(decisions: readonly { readonly source?: string }[]): string {
  const counts: Partial<Record<'HUMAN' | 'AGENT' | 'IMPROVEMENT', number>> = {};
  for (const decision of decisions) {
    const source = decision.source;
    if (source === 'HUMAN' || source === 'AGENT' || source === 'IMPROVEMENT') {
      counts[source] = (counts[source] ?? 0) + 1;
    }
  }
  const parts = (['HUMAN', 'AGENT', 'IMPROVEMENT'] as const)
    .filter((source) => (counts[source] ?? 0) > 0)
    .map((source) => `${source} ${counts[source]}`);
  return parts.length > 0 ? ` (origine : ${parts.join(', ')})` : '';
}

/**
 * Construit l'explication « Pourquoi ce design » depuis le contexte réel.
 * PURE : mêmes entrées → mêmes chaînes (aucune paraphrase aléatoire).
 *
 * M-1 corrections (AUD-M1-01 / AUD-M1-02) :
 *  - §11 : hiérarchie + organisation expliquées QUAND la règle réelle
 *    `structure.semantics` est appliquée (sinon : omises, jamais inventées) ;
 *  - causalité : en mode `override`, chaque dimension est attribuée à sa
 *    vraie provenance (override projet §6 / catalogue M-3 / préférence
 *    utilisateur) ; seules les dimensions NON fixées gardent la phrase de
 *    dérivation « preuve token → conséquence ».
 */
export function buildDesignRationale(designContext: ProjectDesignContext): DesignRationalePayload {
  const direction = designContext.direction;
  const tokens = designContext.tokens;
  const primaryColor = tokens.palette.find((entry) => entry.role === 'primary')?.value;

  // Provenance par clé (AUD-M1-02). Sans clés en mode override (contexte
  // ancien/incomplet) : TOUTES les dimensions sont traitées comme fixées —
  // jamais de causalité fausse.
  const overrideMode = designContext.directionSource === 'override';
  const overrideKeys =
    overrideMode && designContext.directionOverrideKeys !== undefined
      ? new Set(designContext.directionOverrideKeys)
      : undefined;
  const isOverridden = (key: string): boolean =>
    overrideMode && (overrideKeys === undefined || overrideKeys.has(key));
  const fixedKeys = overrideKeys !== undefined ? [...overrideKeys].sort() : [];
  const fixedKeysPreview =
    fixedKeys.length > 4 ? `${fixedKeys.slice(0, 4).join(', ')}, …` : fixedKeys.join(', ');

  // §11 (AUD-M1-01) : la règle RÉELLEMENT appliquée est la seule preuve de
  // hiérarchie/organisation disponible (aucune catégorie HIERARCHY/LAYOUT ni
  // échelle de titres dans le catalogue) — sans elle, aucune explication.
  const structureRule = designContext.rules.find((rule) => rule.id === 'structure.semantics');
  const routeCount = designContext.analyzedRoutes.length;
  const routePreview = routeCount > 0 ? ` (${designContext.analyzedRoutes.slice(0, 3).join(', ')})` : '';

  const reasons = [
    // Provenance globale du mode override (une seule phrase, bornée).
    rationaleSentence([
      overrideMode
        ? overrideKeys !== undefined && fixedKeys.length > 0
          ? `Provenance : override projet §6 (M-3, préférence utilisateur approuvée) — dimensions fixées : ${fixedKeysPreview} ; autres dérivées des tokens du rapport.`
          : overrideKeys === undefined
            ? 'Provenance : direction entièrement fixée par l’override projet §6 (M-3, préférence utilisateur approuvée) — aucune dimension n’est dérivée des tokens.'
            : undefined
        : undefined
    ]),
    rationaleSentence([
      isOverridden('style')
        ? `Style « ${direction.style} » : fixé par l’override projet §6 (valeur du catalogue M-3, préférence utilisateur) — pas dérivé du rayon mesuré (${direction.evidence.dominantRadiusPx}px).`
        : `Composants : rayon dominant ${direction.evidence.dominantRadiusPx}px mesuré dans les tokens de forme → style « ${direction.style} ».`
    ]),
    rationaleSentence([
      isOverridden('personality')
        ? `Personnalité « ${direction.personality} » : fixée par l’override projet §6 (valeur du catalogue M-3, préférence utilisateur) — pas dérivée de la police « ${tokens.primaryFontFamily} ».`
        : `Typographie : police primaire « ${tokens.primaryFontFamily} » (${tokens.fontFamilies.length} famille(s) inférée(s)) → partition « ${direction.personality} ».`
    ]),
    rationaleSentence([
      isOverridden('visualEnergy')
        ? `Énergie visuelle « ${direction.visualEnergy} » : fixée par l’override projet §6 (valeur du catalogue M-3, préférence utilisateur) — pas dérivée de la palette (${tokens.palette.length} rôle(s)).`
        : `Palette : ${tokens.palette.length} rôle(s) de couleur retenu(s)${primaryColor ? ` (primaire ${primaryColor})` : ''} → énergie visuelle « ${direction.visualEnergy} ».`
    ]),
    rationaleSentence([
      isOverridden('density')
        ? `Espacement : grille régulière de pas ${tokens.baseGridStep}px (${tokens.spacingScale.length} pas inférés) — ${
            direction.density !== undefined
              ? `densité « ${direction.density} » fixée par l’override projet §6 (M-3, préférence utilisateur), pas dérivée de la grille.`
              : 'densité non dérivée (stats DOM absentes, jamais inventée).'
          }`
        : `Espacement : grille régulière de pas ${tokens.baseGridStep}px (${tokens.spacingScale.length} pas inférés) → ${
            direction.density !== undefined ? `densité « ${direction.density} »` : 'densité non dérivée (stats DOM absentes, jamais inventée)'
          }.`
    ]),
    rationaleSentence([
      direction.informationDensity !== undefined
        ? isOverridden('informationDensity')
          ? `Densité d’information « ${direction.informationDensity} » : fixée par l’override projet §6 (préférence utilisateur).`
          : `Densité d'information « ${direction.informationDensity} ».`
        : undefined
    ]),
    rationaleSentence([
      direction.professionalism !== undefined ? `Professionnalisme « ${direction.professionalism} ».` : undefined,
      direction.visualComplexity !== undefined
        ? ` Complexité visuelle « ${direction.visualComplexity} » (${direction.evidence.colorCount} couleur(s), ${direction.evidence.fontCount} police(s)).`
        : undefined
    ]),
    rationaleSentence([
      direction.motion !== undefined ? `Mouvement « ${direction.motion} ».` : undefined
    ]),
    // §11 — hiérarchie (AUD-M1-01) : la règle appliquée est citée VERBATIM
    // (aucune reformulation inventée).
    rationaleSentence([structureRule ? `Hiérarchie : ${structureRule.text}` : undefined]),
    // §11 — organisation (AUD-M1-01) : routes RÉELLEMENT analysées + règle
    // appliquée citée par son id (traçabilité catalogue).
    rationaleSentence([
      structureRule
        ? `Organisation : ${routeCount} page(s) analysée(s)${routePreview} — sections header/main/footer et navigation cohérente (règle ${structureRule.id}).`
        : undefined
    ]),
    rationaleSentence([
      'Règles appliquées : ', designContext.rules.length, ' règle(s) du catalogue ', designContext.rulesCatalogVersion, ' contrôlent le markup généré.'
    ]),
    rationaleSentence([
      'Contraintes §24 respectées : ', designContext.designDecisions.length, ' décision(s) design active(s)',
      decisionSourceBreakdown(designContext.designDecisions),
      ' mémorisée(s).'
    ]),
    rationaleSentence([
      'Corrections attendues du rapport : ', designContext.expectedCorrections.length, ' finding(s) de sévérité MEDIUM ou plus.'
    ]),
    rationaleSentence([
      'Composants §9/§10 : ', designContext.components.items.length, ' contrat(s) disponibles (catalogue ', designContext.components.catalogVersion, ') — un composant existant n est jamais recréé.'
    ])
  ].filter((entry): entry is string => entry !== undefined);

  return {
    reportId: designContext.reportId,
    generatedAt: designContext.generatedAt,
    overallScore: designContext.overallScore,
    directionSource: designContext.directionSource,
    direction: {
      style: direction.style,
      personality: direction.personality,
      motion: direction.motion,
      visualEnergy: direction.visualEnergy,
      ...(direction.density !== undefined ? { density: direction.density } : {}),
      ...(direction.professionalism !== undefined ? { professionalism: direction.professionalism } : {}),
      ...(direction.visualComplexity !== undefined ? { visualComplexity: direction.visualComplexity } : {}),
      ...(direction.informationDensity !== undefined ? { informationDensity: direction.informationDensity } : {})
    },
    rulesApplied: { count: designContext.rules.length, catalogVersion: designContext.rulesCatalogVersion },
    decisionsRespected: designContext.designDecisions.length,
    correctionsExpected: designContext.expectedCorrections.length,
    components: {
      catalogVersion: designContext.components.catalogVersion,
      available: designContext.components.items.length
    },
    reasons
  };
}

export class UiAgent extends BaseSpecializedAgent {
  constructor(registry?: AIProviderRegistry | undefined) {
    super(
      {
        id: 'agent-ui-specialist',
        name: 'UI & Layout Specialist',
        domain: 'UI',
        capabilities: ['PAGE_GENERATION', 'COMPONENT_STYLING', 'RESPONSIVE_LAYOUT'],
        description: 'Responsable des vues, composants, ergonomie, design Tailwind CSS et accessibilité.',
        riskLevel: 'LOW',
        requiredProviderCapabilities: ['CODE_GENERATION', 'FAST'],
        allowedTools: ['read_file', 'inspect_ast']
      },
      registry
    );
  }

  protected buildArtifacts(params: {
    task: AgentTask;
    context: TaskContextPayload;
    generatedText: string;
  }): readonly AgentArtifact[] {
    const { task, context, generatedText } = params;
    const targetFile = task.requiredContext.targetFiles?.[0] || 'src/components/View.tsx';
    const designContext = context.designContext;

    const op = task.operation === 'DELETE' ? 'DELETE' : task.operation === 'CREATE' ? 'CREATE' : 'UPDATE';

    const fileChangeArtifact = this.createArtifact({
      id: `art-${task.id}-ui-change`,
      taskId: task.id,
      kind: 'PROPOSED_FILE_CHANGE',
      targetFiles: [targetFile],
      payload: {
        filePath: targetFile,
        operation: op,
        proposedContent: op === 'DELETE' ? undefined : generatedText,
        reason: designContext
          ? `Mise à jour d'interface design-aware (Design DNA réel, rapport ${designContext.reportId}) réalisée par ${this.definition.name}`
          : `Mise à jour d'interface réalisée par ${this.definition.name}`
      },
      summary: `Artefact UI généré pour ${targetFile}`
    });

    const specArtifact = this.createArtifact({
      id: `art-${task.id}-ui-spec`,
      taskId: task.id,
      kind: 'UI_SPEC',
      targetFiles: [targetFile],
      payload: {
        componentName: 'MainView',
        responsiveBreakpoints: ['sm', 'md', 'lg', 'xl'],
        stylingFramework: 'TailwindCSS',
        // CDC V8 §11 — traçabilité du Design DNA réellement appliqué (absent
        // quand aucun rapport n'existe : payload historique inchangé).
        ...(designContext
          ? {
              designAware: true,
              designContextSource: {
                reportId: designContext.reportId,
                generatedAt: designContext.generatedAt,
                overallScore: designContext.overallScore
              },
              designDirection: designContext.direction,
              designDirectionSource: designContext.directionSource,
              designRulesApplied: designContext.rules.length,
              designRulesCatalogVersion: designContext.rulesCatalogVersion,
              // CDC V8 §11 / LOT V8.1 — explication structurée « Pourquoi ce
              // design », dérivée uniquement du contexte réel (M-1).
              designRationale: buildDesignRationale(designContext)
            }
          : {})
      },
      summary: designContext
        ? `Spécification de design responsive alignée sur le Design DNA du projet (rapport ${designContext.reportId})`
        : 'Spécification de design responsive et hiérarchie de composants'
    });

    return [fileChangeArtifact, specArtifact];
  }
}
