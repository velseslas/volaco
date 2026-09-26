/**
 * VibeCode Core - AI Provider Registry & Intelligent Router
 * Decoupled provider catalog, capability-based resolution, and multi-tenant isolation
 */

import {
  AIProviderAdapter,
  AIProviderDescriptor,
  ProviderRequirements,
  TenantProviderCredentials
} from './types.js';

export class AIProviderRegistry {
  private readonly providers = new Map<string, AIProviderAdapter>();
  private readonly tenantCredentials = new Map<string, Map<string, TenantProviderCredentials>>();

  public register(adapter: AIProviderAdapter): void {
    this.providers.set(adapter.descriptor.providerId, adapter);
  }

  public unregister(providerId: string): boolean {
    return this.providers.delete(providerId);
  }

  public get(providerId: string): AIProviderAdapter | undefined {
    return this.providers.get(providerId);
  }

  public list(): readonly AIProviderDescriptor[] {
    return Array.from(this.providers.values()).map((p) => p.descriptor);
  }

  public resolve(requirements: ProviderRequirements = {}): AIProviderAdapter | undefined {
    const available = Array.from(this.providers.values()).filter(
      (p) => p.descriptor.availability !== 'UNAVAILABLE'
    );

    if (available.length === 0) {
      return undefined;
    }

    // 1. Preferred provider explicitly requested
    if (requirements.preferredProviderId) {
      const match = available.find((p) => p.descriptor.providerId === requirements.preferredProviderId);
      if (match) return match;
    }

    // 2. Filter by minimum context window
    let candidates = available;
    if (requirements.minContextWindow !== undefined && requirements.minContextWindow > 0) {
      candidates = candidates.filter((p) => p.descriptor.contextWindow >= (requirements.minContextWindow ?? 0));
    }

    // 3. Filter by required capabilities
    if (requirements.capabilities && requirements.capabilities.length > 0) {
      candidates = candidates.filter((p) =>
        requirements.capabilities!.every((cap) => p.descriptor.capabilities.includes(cap))
      );
    }

    if (candidates.length === 0) {
      // Fallback to any available if strict filter failed
      candidates = available;
    }

    // 4. Intelligent routing by Task Kind
    if (requirements.taskKind) {
      switch (requirements.taskKind) {
        case 'CODE_GENERATION': {
          const codeCandidate = candidates.find((p) =>
            p.descriptor.capabilities.includes('CODE_GENERATION')
          );
          if (codeCandidate) return codeCandidate;
          break;
        }
        case 'LARGE_CONTEXT': {
          const sortedByContext = [...candidates].sort(
            (a, b) => b.descriptor.contextWindow - a.descriptor.contextWindow
          );
          if (sortedByContext[0]) return sortedByContext[0];
          break;
        }
        case 'DEEP_ANALYSIS': {
          const reasoningCandidate = candidates.find((p) =>
            p.descriptor.capabilities.includes('DEEP_REASONING') || p.descriptor.reasoning
          );
          if (reasoningCandidate) return reasoningCandidate;
          break;
        }
        case 'FAST_CONVERSATION': {
          const fastCandidate = candidates.find((p) =>
            p.descriptor.capabilities.includes('FAST')
          );
          if (fastCandidate) return fastCandidate;
          break;
        }
      }
    }

    // Return the healthiest / first candidate
    const healthy = candidates.find((p) => p.descriptor.healthStatus === 'HEALTHY');
    return healthy ?? candidates[0];
  }

  // ==================== Multi-Tenant Credential Store ====================

  public setTenantCredentials(
    tenantId: string,
    providerId: string,
    credentials: TenantProviderCredentials
  ): void {
    if (!this.tenantCredentials.has(tenantId)) {
      this.tenantCredentials.set(tenantId, new Map());
    }
    this.tenantCredentials.get(tenantId)!.set(providerId, {
      ...credentials,
      tenantId,
      providerId
    });
  }

  public getTenantCredentials(
    tenantId: string,
    providerId: string
  ): TenantProviderCredentials | undefined {
    return this.tenantCredentials.get(tenantId)?.get(providerId);
  }

  public deleteTenantCredentials(tenantId: string, providerId?: string): void {
    if (!providerId) {
      this.tenantCredentials.delete(tenantId);
    } else {
      this.tenantCredentials.get(tenantId)?.delete(providerId);
    }
  }

  public clear(): void {
    this.providers.clear();
    this.tenantCredentials.clear();
  }
}

export const aiProviderRegistry = new AIProviderRegistry();
