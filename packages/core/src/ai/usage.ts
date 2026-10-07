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
  /**
   * É48 P4 (J-6) — kind d'événement de tracking : 'START' (appel provider
   * commencé, coût 0 — jamais chiffré avant réponse), 'SUCCESS' (terminal
   * avec coût réel), 'ERROR'/'ABORTED' (terminal sans coût — usage inconnu).
   * Absent sur les records historiques (records de coût SUCCESS).
   */
  kind?: AiUsageEventKind;
  /** Provider émetteur de l'attempt (mistral | gemini). */
  provider?: string;
  /** Détail de l'erreur (kind = 'ERROR' uniquement, sanitisé). */
  error?: string;
}

export type AiUsageEventKind = 'START' | 'SUCCESS' | 'ERROR' | 'ABORTED';

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
    requestId: string,
    provider?: string
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
      requestId,
      kind: 'SUCCESS',
      ...(provider !== undefined ? { provider } : {})
    };

    this.records.push(record);
    this.persist();
    return record;
  }

  /**
   * É48 P4 (J-6) — trace un événement d'attempt SANS coût : le coût réel
   * n'est connu qu'après réponse du provider. START rend visible chaque
   * appel dès son démarrage (crash/timeout/erreur → l'attempt reste tracé),
   * ERROR/ABORTED ferment l'appel sans inventer de coût, SUCCESS porte
   * le coût réel via recordUsage. Un appel provider = un START + un terminal.
   */
  public recordAttempt(params: {
    tenantId: string;
    projectId: string;
    model: string;
    provider: string;
    requestId: string;
    kind: 'START' | 'SUCCESS' | 'ERROR' | 'ABORTED';
    error?: string;
  }): AiUsageRecord {
    const record: AiUsageRecord = {
      id: 'ai_' + randomUUID().replace(/-/g, '').slice(0, 16),
      tenantId: params.tenantId,
      projectId: params.projectId,
      model: params.model,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      timestamp: new Date(),
      requestId: params.requestId,
      kind: params.kind,
      provider: params.provider,
      ...(params.error !== undefined ? { error: params.error } : {})
    };

    this.records.push(record);
    this.persist();
    return record;
  }

  /** Lecture des événements de tracking d'un tenant (observabilité/tests). */
  public getRecordsFor(tenantId: string): readonly AiUsageRecord[] {
    return this.records.filter((r) => r.tenantId === tenantId);
  }

  public getUsageSummary(tenantId: string, projectId?: string): UsageSummary {
    let totalPrompt = 0;
    let totalCompletion = 0;
    let totalCost = 0;
    let count = 0;

    for (const rec of this.records) {
      if (rec.tenantId === tenantId && (!projectId || rec.projectId === projectId)) {
        // É48 P4 — les events d'attempt (START/ERROR/ABORTED) portent 0 token
        // et 0 coût par construction : les totaux ne comptent que le réel.
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
