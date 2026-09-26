/**
 * VibeCode Core - Decision Engine
 * Constraint Registry : charge les contraintes projet (CDC + ADRs + conventions).
 *
 * Phase 9.5 : version simplifiée. On parse les ADR markdown existants dans
 * docs/adr/ et on hardcode un set minimal de contraintes issues du CDC.
 * L'extension future pourra lire le PDF du CDC et les conventions détectées
 * par le package `dna`.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { logger } from '../../logger.js';
import type { DecisionConstraint, ConstraintSource } from './types.js';

const ADR_DIR_DEFAULT = join(process.cwd(), 'docs', 'adr');

const DEFAULT_CDC_CONSTRAINTS: readonly DecisionConstraint[] = [
  {
    id: 'cdc-34-auth-bearer',
    source: 'CDC',
    statement: 'All API requests must present a Bearer token (or signed JWT).',
    severity: 'HARD',
    rationale: 'CDC §34 — authentication is mandatory before any state mutation.'
  },
  {
    id: 'cdc-34-no-direct-mistral-from-browser',
    source: 'CDC',
    statement: 'The Studio HTML must not call api.mistral.ai directly; all LLM traffic goes through /api/v1/ai/chat/completions.',
    severity: 'HARD',
    rationale: 'CDC §34 + Phase 0 — key must not leak to client bundles.'
  },
  {
    id: 'cdc-37-terminal-sandbox',
    source: 'CDC',
    statement: 'Terminal commands run in a sandboxed environment with a whitelist; npm run and node -e are forbidden.',
    severity: 'HARD',
    rationale: 'CDC §37 — process isolation.'
  },
  {
    id: 'cdc-8-application-model',
    source: 'CDC',
    statement: 'Mutations must update the Application Model (centre de connaissance unique) before validation.',
    severity: 'SOFT',
    rationale: 'CDC §8 — single source of truth. Phase 11 will enforce this.'
  },
  {
    id: 'cdc-38-validation-required',
    source: 'CDC',
    statement: 'Any code mutation must be validated (typecheck + tests) before being marked as COMPLETED.',
    severity: 'HARD',
    rationale: 'CDC §38 — never trust an AI output blindly.'
  },
  {
    id: 'cdc-19-preview-isolation',
    source: 'CDC',
    statement: 'Preview rendering runs in isolated Chromium with no egress to internal metadata endpoints.',
    severity: 'HARD',
    rationale: 'CDC §19 + SSRF mitigation.'
  },
  {
    id: 'cdc-5-no-silent-ai-actions',
    source: 'CDC',
    statement: 'Proactive intelligence modules (strategy, evolution, feature-intelligence) must NOT execute without explicit user validation.',
    severity: 'HARD',
    rationale: 'CDC §5 — user intent drives the pipeline, not the analyst pool.'
  }
];

/**
 * Registre de contraintes projet. Charge au démarrage :
 *  1. Les contraintes CDC (hardcoded pour Phase 9.5)
 *  2. Les ADRs depuis docs/adr/ADR-*.md (parse minimal)
 *  3. Les user preferences injectées via addConstraint()
 */
export class ConstraintRegistry {
  private readonly constraints = new Map<string, DecisionConstraint>();
  private readonly adrDir: string;

  constructor(options: { adrDir?: string } = {}) {
    this.adrDir = options.adrDir || ADR_DIR_DEFAULT;
    this.loadDefaults();
  }

  private loadDefaults(): void {
    for (const c of DEFAULT_CDC_CONSTRAINTS) {
      this.constraints.set(c.id, c);
    }
    this.loadAdrs();
  }

  private loadAdrs(): void {
    if (!existsSync(this.adrDir)) {
      logger.warn('ConstraintRegistry: ADR directory not found', { adrDir: this.adrDir });
      return;
    }
    let files: string[];
    try {
      files = readdirSync(this.adrDir).filter((f) => f.startsWith('ADR-') && f.endsWith('.md'));
    } catch (err) {
      logger.warn('ConstraintRegistry: cannot read ADR directory', { error: String(err) });
      return;
    }
    for (const file of files) {
      const path = join(this.adrDir, file);
      try {
        const content = readFileSync(path, 'utf8');
        const adr = this.parseAdr(file, content);
        if (adr) {
          this.constraints.set(adr.id, adr);
        }
      } catch (err) {
        logger.warn('ConstraintRegistry: cannot parse ADR', { file, error: String(err) });
      }
    }
  }

  /**
   * Parse minimal d'un ADR markdown.
   * Extrait le titre (# ADR-XXX-...) et la première section "Decision".
   */
  private parseAdr(file: string, content: string): DecisionConstraint | null {
    const id = 'adr-' + basename(file, '.md').toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch && titleMatch[1] ? titleMatch[1].trim() : basename(file, '.md');
    const decisionMatch = content.match(/##\s+Decision\s*\n+([\s\S]*?)(?:\n##\s|$)/i);
    const decisionBody = decisionMatch && decisionMatch[1] ? decisionMatch[1].trim() : title;
    const statement = decisionBody.split('\n')[0]?.slice(0, 200) ?? title;
    return {
      id,
      source: 'ADR' as ConstraintSource,
      statement,
      severity: 'HARD',
      rationale: `ADR: ${title}`,
      appliesTo: undefined
    };
  }

  public addConstraint(constraint: DecisionConstraint): void {
    this.constraints.set(constraint.id, constraint);
  }

  public loadConstraints(_projectId: string): readonly DecisionConstraint[] {
    return Array.from(this.constraints.values());
  }

  public getHardConstraints(): readonly DecisionConstraint[] {
    return this.loadConstraints('').filter((c) => c.severity === 'HARD');
  }

  /**
   * Vérifie si une statement donnée viole des contraintes.
   * Pour Phase 9.5 on utilise une détection par mots-clés (Tailwind vs Bootstrap, etc.).
   * Phase future : LLM-based.
   */
  public violates(statement: string): readonly DecisionConstraint[] {
    const lower = statement.toLowerCase();
    const violated: DecisionConstraint[] = [];
    for (const constraint of this.constraints.values()) {
      if (constraint.severity !== 'HARD') continue;
      const stmtLower = constraint.statement.toLowerCase();
      // Heuristique simple : conflits technologiques classiques
      if (stmtLower.includes('typescript strict') && lower.includes('any')) {
        violated.push(constraint);
        continue;
      }
      if (
        (stmtLower.includes('no direct') && stmtLower.includes('mistral') && lower.includes('api.mistral.ai'))
      ) {
        violated.push(constraint);
        continue;
      }
      if (stmtLower.includes('npm run') && lower.includes('npm run')) {
        violated.push(constraint);
        continue;
      }
      if (stmtLower.includes('node -e') && lower.includes('node -e')) {
        violated.push(constraint);
        continue;
      }
    }
    return violated;
  }

  public size(): number {
    return this.constraints.size;
  }

  public clear(): void {
    this.constraints.clear();
    this.loadDefaults();
  }
}
