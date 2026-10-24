/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * Reasoning Loop (Observe - Think - Act)
 */

import type { AgentIntent, AgentPlan, ToolExecutionResult } from '../types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ToolSelector } from '../tools/selector.js';
import type { AgentPlanner } from '../planning/planner.js';
import type { BudgetTracker } from './budget.js';
import type { AssumptionEngine } from './assumptions.js';
import type { ToolExecutionContext } from '../tools/registry.js';

export interface ReasoningStepOutput {
  readonly iteration: number;
  readonly toolResults: readonly ToolExecutionResult[];
  readonly plan: AgentPlan;
}

/** Sérialisation bornée pour l'estimation de tokens (jamais de throw). */
function safePreview(value: unknown): string {
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return (text ?? '').slice(0, 250_000);
  } catch {
    return String(value).slice(0, 250_000);
  }
}

export class ReasoningLoop {
  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly toolSelector: ToolSelector,
    private readonly planner: AgentPlanner,
    private readonly assumptionEngine: AssumptionEngine
  ) {}

  public async runReasoningPhase(
    intent: AgentIntent,
    budgetTracker: BudgetTracker,
    context: ToolExecutionContext
  ): Promise<ReasoningStepOutput> {
    budgetTracker.recordIteration();

    // 1. Observe & Select Tools
    const selections = this.toolSelector.selectTools(intent);
    const toolResults: ToolExecutionResult[] = [];

    // 2. Execute read-only tools to gather evidence
    for (const sel of selections) {
      const toolDef = this.toolRegistry.get(sel.tool);
      if (toolDef && toolDef.isReadonly) {
        budgetTracker.recordToolCall();
        const res = await this.toolRegistry.execute(sel.tool, sel.input, context);
        // P0-PROD — alimente le budget tokens/coût (voir BudgetTracker.recordToolIo).
        budgetTracker.recordToolIo(safePreview(sel.input), safePreview(res));
        toolResults.push(res);
      }
    }

    // 3. Plan-First: generate verified plan
    const assumptions = this.assumptionEngine.getAssumptions();
    const plan = this.planner.createPlan(intent, assumptions);

    return {
      iteration: 1,
      toolResults,
      plan
    };
  }
}
