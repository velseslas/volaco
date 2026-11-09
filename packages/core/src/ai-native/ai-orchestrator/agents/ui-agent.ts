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
    .map((part) => (part === undefined || part === null ? '' : String(part).trim()))
    .join('')
    .replace(/\s+/g, ' ');
  if (sentence.length === 0) return undefined;
  return sentence.length <= RATIONALE_MAX_SENTENCE
    ? sentence
    : `${sentence.slice(0, RATIONALE_MAX_SENTENCE - 1).trimEnd()}…`;
}

/**
 * Construit l'explication « Pourquoi ce design » depuis le contexte réel.
 * PURE : mêmes entrées → mêmes chaînes (aucune paraphrase aléatoire).
 */
export function buildDesignRationale(designContext: ProjectDesignContext): DesignRationalePayload {
  const direction = designContext.direction;
  const tokens = designContext.tokens;
  const primaryColor = tokens.palette.find((entry) => entry.role === 'primary')?.value;
  const reasons = [
    rationaleSentence([
      'Composants : rayon dominant ', direction.evidence.dominantRadiusPx, 'px mesuré dans les tokens de forme → style « ', direction.style, ' ».'
    ]),
    rationaleSentence([
      'Typographie : police primaire « ', tokens.primaryFontFamily, ' » (', tokens.fontFamilies.length, ' famille(s) inférée(s)) → partition « ', direction.personality, ' ».'
    ]),
    rationaleSentence([
      'Palette : ', tokens.palette.length, ' rôle(s) de couleur retenu(s)', primaryColor ? ` (primaire ${primaryColor})` : '', ' → énergie visuelle « ', direction.visualEnergy, ' ».'
    ]),
    rationaleSentence([
      'Espacement : grille régulière de pas ', tokens.baseGridStep, 'px (', tokens.spacingScale.length, ' pas inférés) → ', direction.density !== undefined ? `densité « ${direction.density} »` : 'densité non dérivée (stats DOM absentes, jamais inventée)', '.'
    ]),
    rationaleSentence([
      direction.informationDensity !== undefined ? `Densité d'information « ${direction.informationDensity} ».` : undefined
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
    rationaleSentence([
      'Règles appliquées : ', designContext.rules.length, ' règle(s) du catalogue ', designContext.rulesCatalogVersion, ' contrôlent le markup généré.'
    ]),
    rationaleSentence([
      'Contraintes §24 respectées : ', designContext.designDecisions.length, ' décision(s) design active(s) mémorisée(s).'
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
