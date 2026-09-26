import { randomUUID } from 'node:crypto';
import { dataFilePath, readJsonFile, writeJsonFileSync } from '../persistence/json-disk-cache.js';

export interface ModelPricing {
  promptCostPerMillion: number;
  completionCostPerMillion: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'codestral-latest': { promptCostPerMillion: 0.20, completionCostPerMillion: 0.60 },
  'mistral-large': { promptCostPerMillion: 2.00, completionCostPerMillion: 6.00 },
  'default': { promptCostPerMillion: 1.00, completionCostPerMillion: 3.00 }
};

export interface AiUsageRecord {
  id: string;
  tenantId: string;
  projectId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  timestamp: Date;
  requestId: string;
}

export interface UsageSummary {
  tenantId: string;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  recordCount: number;
}

export class AiUsageTracker {
  private records: AiUsageRecord[] = [];
  // ÉTAPE 3 — les coûts IA sont PERSISTANTS (la mémoire volatile rendait
  // toute comptabilité impossible à travers un redémarrage).
  private readonly filePath = dataFilePath('ai-usage');

  constructor() {
    const loaded = readJsonFile<AiUsageRecord[]>(this.filePath, []);
    if (Array.isArray(loaded)) {
      this.records = loaded.map((r) => ({ ...r, timestamp: new Date(r.timestamp) }));
    }
  }

  private persist(): void {
    try {
      writeJsonFileSync(this.filePath, this.records.slice(-10_000));
    } catch {
      // La comptabilité ne doit jamais faire échouer la requête
    }
  }

  public calculateCost(model: string, promptTokens: number, completionTokens: number): number {
    const pricing = MODEL_PRICING[model] || MODEL_PRICING['default']!;
    const promptCost = (promptTokens / 1_000_000) * pricing.promptCostPerMillion;
    const completionCost = (completionTokens / 1_000_000) * pricing.completionCostPerMillion;
    return Math.round((promptCost + completionCost) * 1_000_000) / 1_000_000;
  }

  public recordUsage(
    tenantId: string,
    projectId: string,
    model: string,
    promptTokens: number,
    completionTokens: number,
    requestId: string
  ): AiUsageRecord {
    const estimatedCostUsd = this.calculateCost(model, promptTokens, completionTokens);
    const record: AiUsageRecord = {
      id: 'ai_' + randomUUID().replace(/-/g, '').slice(0, 16),
      tenantId,
      projectId,
      model,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      estimatedCostUsd,
      timestamp: new Date(),
      requestId
    };

    this.records.push(record);
    this.persist();
    return record;
  }

  public getUsageSummary(tenantId: string, projectId?: string): UsageSummary {
    let totalPrompt = 0;
    let totalCompletion = 0;
    let totalCost = 0;
    let count = 0;

    for (const rec of this.records) {
      if (rec.tenantId === tenantId && (!projectId || rec.projectId === projectId)) {
        totalPrompt += rec.promptTokens;
        totalCompletion += rec.completionTokens;
        totalCost += rec.estimatedCostUsd;
        count++;
      }
    }

    return {
      tenantId,
      totalPromptTokens: totalPrompt,
      totalCompletionTokens: totalCompletion,
      totalTokens: totalPrompt + totalCompletion,
      totalCostUsd: Math.round(totalCost * 100_000) / 100_000,
      recordCount: count
    };
  }

  public clear(): void {
    this.records = [];
    this.persist();
  }
}

export const aiUsageTracker = new AiUsageTracker();
