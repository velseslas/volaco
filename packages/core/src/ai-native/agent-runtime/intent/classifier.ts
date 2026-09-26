/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * Deterministic Intent Classifier & Entity Extractor
 */

import type { IntentType } from '../types.js';

export interface ClassifiedIntentData {
  readonly type: IntentType;
  readonly confidence: number;
  readonly entities: readonly string[];
  readonly requestedChanges: readonly string[];
  readonly constraints: readonly string[];
}

export class DeterministicIntentClassifier {
  private static readonly FILE_REGEX = /(?:[a-zA-Z0-9_\-\./]+\.[a-zA-Z0-9]+)/g;
  private static readonly SYMBOL_REGEX = /(?:function|class|interface|type|const|let)\s+([a-zA-Z0-9_$]+)/gi;

  public static classify(userInput: string): ClassifiedIntentData {
    const text = userInput.trim().toLowerCase();
    const entities = this.extractEntities(userInput);
    const requestedChanges = this.extractRequestedChanges(userInput);
    const constraints = this.extractConstraints(userInput);

    // High precedence: explicit file deletion
    if (/\b(delete|supprimer|remove|rm|drop)\b/.test(text) && (entities.length > 0 || /\bfile|fichier|dossier|folder\b/.test(text))) {
      return {
        type: 'DELETE_FILE',
        confidence: 0.95,
        entities,
        requestedChanges,
        constraints
      };
    }

    // Explicit file creation
    if (/\b(create|creer|new file|nouveau fichier|add file|ajouter fichier)\b/.test(text)) {
      return {
        type: 'CREATE_FILE',
        confidence: 0.9,
        entities,
        requestedChanges,
        constraints
      };
    }

    // Rename / move
    if (/\b(rename|renommer|move|deplacer)\b/.test(text)) {
      return {
        type: 'RENAME',
        confidence: 0.9,
        entities,
        requestedChanges,
        constraints
      };
    }

    // Bug fixing
    if (/\b(fix|bug|reparer|corriger|crash|erreur|patch|broken)\b/.test(text)) {
      return {
        type: 'FIX_BUG',
        confidence: 0.88,
        entities,
        requestedChanges,
        constraints
      };
    }

    // Refactoring
    if (/\b(refactor|restructure|refactoriser|nettoyer|clean up|modulariser)\b/.test(text)) {
      return {
        type: 'REFACTOR',
        confidence: 0.85,
        entities,
        requestedChanges,
        constraints
      };
    }

    // Testing
    if (/\b(test|tests|tester|unit test|spec|e2e)\b/.test(text)) {
      return {
        type: 'TEST',
        confidence: 0.85,
        entities,
        requestedChanges,
        constraints
      };
    }

    // Audit / Security
    if (/\b(audit|securite|security|vulnerabilit|inspect)\b/.test(text)) {
      return {
        type: 'AUDIT',
        confidence: 0.85,
        entities,
        requestedChanges,
        constraints
      };
    }

    // Optimize
    if (/\b(optimize|optimiser|performance|speed|perf)\b/.test(text)) {
      return {
        type: 'OPTIMIZE',
        confidence: 0.8,
        entities,
        requestedChanges,
        constraints
      };
    }

    // Add feature
    if (/\b(add|ajouter|implement|implementer|nouvelle fonctionnalite|feature)\b/.test(text)) {
      return {
        type: 'ADD_FEATURE',
        confidence: 0.82,
        entities,
        requestedChanges,
        constraints
      };
    }

    // Modify feature
    if (/\b(modify|modifier|update|changer|adapter)\b/.test(text)) {
      return {
        type: 'MODIFY_FEATURE',
        confidence: 0.8,
        entities,
        requestedChanges,
        constraints
      };
    }

    // Understand project
    if (/\b(project|projet|architecture|overview|vue d ensemble|comprendre le projet)\b/.test(text)) {
      return {
        type: 'UNDERSTAND_PROJECT',
        confidence: 0.85,
        entities,
        requestedChanges,
        constraints
      };
    }

    // Analyze code
    if (/\b(analyze|analyser|inspecter|graphe|graph|dependencies)\b/.test(text)) {
      return {
        type: 'ANALYZE_CODE',
        confidence: 0.8,
        entities,
        requestedChanges,
        constraints
      };
    }

    // Explain
    if (/\b(explain|expliquer|comment|how does|pourquoi|why)\b/.test(text)) {
      return {
        type: 'EXPLAIN',
        confidence: 0.85,
        entities,
        requestedChanges,
        constraints
      };
    }

    // Fallback: Ask information
    return {
      type: 'ASK_INFORMATION',
      confidence: 0.5,
      entities,
      requestedChanges,
      constraints
    };
  }

  private static extractEntities(text: string): readonly string[] {
    const results = new Set<string>();

    const fileMatches = text.match(this.FILE_REGEX);
    if (fileMatches) {
      for (const m of fileMatches) {
        // filter out plain decimals like 3.14
        if (!/^\d+\.\d+$/.test(m)) {
          results.add(m);
        }
      }
    }

    let match: RegExpExecArray | null;
    while ((match = this.SYMBOL_REGEX.exec(text)) !== null) {
      const sym = match[1];
      if (sym) results.add(sym);
    }

    return Array.from(results);
  }

  private static extractRequestedChanges(text: string): readonly string[] {
    const changes: string[] = [];
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('-') || trimmed.startsWith('*') || /^\d+\./.test(trimmed)) {
        changes.push(trimmed.replace(/^[-*\d.]+\s*/, ''));
      }
    }
    return changes;
  }

  private static extractConstraints(text: string): readonly string[] {
    const constraints: string[] = [];
    const lower = text.toLowerCase();
    if (lower.includes('sans modifier') || lower.includes('do not touch') || lower.includes('ne pas toucher')) {
      constraints.push('preserve-specified-files');
    }
    if (lower.includes('production') || lower.includes('prod')) {
      constraints.push('production-safety');
    }
    return constraints;
  }
}
