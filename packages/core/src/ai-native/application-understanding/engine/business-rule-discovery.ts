/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-008)
 * Business Rule Discovery Engine
 */

import type { SemanticCodeGraph } from '../../semantic-graph/types.js';
import type { BusinessRuleType, SemanticBusinessRule, UnderstandingEvidence } from '../types.js';
import { calculateConfidence, determineCertainty } from './confidence.js';
import { createEvidence } from './evidence.js';
import { compareBusinessRules } from './canonical.js';

export function discoverBusinessRules(
  graph: SemanticCodeGraph
): readonly SemanticBusinessRule[] {
  if (!graph || !graph.nodes || graph.nodes.length === 0) {
    return [];
  }

  const rules: SemanticBusinessRule[] = [];

  for (const node of graph.nodes) {
    const name = node.name;
    const path = node.filePath ?? '';

    // 1. Authorization rules (guards, RBAC, permissions)
    if (/permission|role|rbac|guard|authorize|auth/i.test(name)) {
      const ruleId = `rule_auth_${name.toLowerCase()}`;
      const evidence = [
        createEvidence('AST_SYMBOL', `Symbol: ${name}`, `Règle d'autorisation explicite détectée dans ${name}`, { filePath: path, lineStart: node.lineStart })
      ];

      rules.push({
        ruleId,
        name: `Authorization Rule: ${name}`,
        description: `Enforces access control and permission verification for ${name}.`,
        location: {
          filePath: path,
          lineStart: node.lineStart,
          lineEnd: node.lineEnd,
          symbol: name
        },
        type: 'AUTHORIZATION',
        conditions: ['User must possess required role or permission token'],
        effects: ['Grant access to protected resource or raise ForbiddenError'],
        certainty: determineCertainty(calculateConfidence(evidence, 0.65)),
        confidence: calculateConfidence(evidence, 0.65),
        evidence
      });
    }

    // 2. Validation rules (validators, checks, schemas)
    if (/validate|check|assert|schema|invariant/i.test(name)) {
      const ruleId = `rule_val_${name.toLowerCase()}`;
      const evidence = [
        createEvidence('AST_SYMBOL', `Symbol: ${name}`, `Règle de validation et de contrainte d'intégrité détectée dans ${name}`, { filePath: path, lineStart: node.lineStart })
      ];

      rules.push({
        ruleId,
        name: `Validation Rule: ${name}`,
        description: `Validates structural or business data invariants before processing.`,
        location: {
          filePath: path,
          lineStart: node.lineStart,
          lineEnd: node.lineEnd,
          symbol: name
        },
        type: 'VALIDATION',
        conditions: ['Payload must satisfy schema constraints and mandatory fields'],
        effects: ['Proceed with operation or reject with ValidationError'],
        certainty: determineCertainty(calculateConfidence(evidence, 0.60)),
        confidence: calculateConfidence(evidence, 0.60),
        evidence
      });
    }

    // 3. State transitions (status, transition, machine, workflow)
    if (/state|status|transition|machine|workflow/i.test(name)) {
      const ruleId = `rule_state_${name.toLowerCase()}`;
      const evidence = [
        createEvidence('AST_SYMBOL', `Symbol: ${name}`, `Machine à états ou règle de transition détectée dans ${name}`, { filePath: path, lineStart: node.lineStart })
      ];

      rules.push({
        ruleId,
        name: `State Transition Invariant: ${name}`,
        description: `Governs permitted lifecycle state transitions and prevents illegal jumps.`,
        location: {
          filePath: path,
          lineStart: node.lineStart,
          lineEnd: node.lineEnd,
          symbol: name
        },
        type: 'STATE_TRANSITION',
        conditions: ['Current state must permit transition to requested target state'],
        effects: ['Update lifecycle state and record transition audit trail'],
        certainty: determineCertainty(calculateConfidence(evidence, 0.55)),
        confidence: calculateConfidence(evidence, 0.55),
        evidence
      });
    }
  }

  // Deduplicate and canonical sort
  const uniqueMap = new Map<string, SemanticBusinessRule>();
  for (const r of rules) {
    if (!uniqueMap.has(r.ruleId)) {
      uniqueMap.set(r.ruleId, r);
    }
  }

  return Array.from(uniqueMap.values()).sort(compareBusinessRules);
}
