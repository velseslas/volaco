/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-011)
 * Multimodal Visual Analyzer & Vision Provider Bridge
 */

import type { AIProviderRegistry } from '../../../ai/providers/registry.js';
import { aiProviderRegistry } from '../../../ai/providers/registry.js';
import type { MultimodalVisionInsight, VisualSnapshot } from '../types.js';

export class MultimodalAnalyzer {
  constructor(private readonly registry?: AIProviderRegistry | undefined) {}

  public async analyzeSnapshot(params: {
    snapshot: VisualSnapshot;
    tenantId: string;
    projectId: string;
    requestId?: string | undefined;
  }): Promise<MultimodalVisionInsight | undefined> {
    const { snapshot, tenantId, projectId, requestId } = params;
    const providerReg = this.registry ?? aiProviderRegistry;

    // Check for provider with VISION capability (e.g. Gemini)
    const visionAdapter = providerReg.resolve({
      capabilities: ['VISION']
    });

    if (visionAdapter && snapshot.screenshotBase64) {
      try {
        const credentials = providerReg.getTenantCredentials(tenantId, visionAdapter.descriptor.providerId);
        const prompt =
          `Tu es l'analyste d'intelligence visuelle de VibeCode Studio.\n` +
          `Analyse cette capture d'interface (${snapshot.viewport.kind}, ${snapshot.viewport.width}x${snapshot.viewport.height}).\n` +
          `Éléments détectés : ${snapshot.totalElementsCount} nœuds, ${snapshot.interactiveElements.length} éléments interactifs.\n` +
          `Couleurs dominantes : ${snapshot.extractedColors.slice(0, 5).join(', ')}.\n` +
          `Identifie les anomalies visuelles : alignements rompus, contrastes insuffisants, débordements visuels, ou déséquilibres esthétiques.`;

        const response = await visionAdapter.generate(
          {
            tenantId,
            projectId,
            prompt,
            systemPrompt: 'Tu es un expert UX/UI. Analyse rigoureusement et concisément les anomalies visuelles.',
            requestId,
            timeoutMs: 12000
          },
          credentials
        );

        const anomalies: string[] = [];
        const lines = response.text.split('\n');
        for (const line of lines) {
          if (line.includes('anomalie') || line.includes('problème') || line.includes('contraste') || line.includes('alignement')) {
            anomalies.push(line.replace(/^[-*•0-9.]+\s*/, '').trim());
          }
        }

        return {
          summary: response.text.slice(0, 300),
          detectedAnomalies: anomalies.slice(0, 5),
          confidence: 0.9,
          modelUsed: response.modelId
        };
      } catch (err: unknown) {
        // Fallback to local heuristic synthesis on error
      }
    }

    // Local deterministic heuristic insight (works offline without vision API)
    const localAnomalies: string[] = [];
    if (snapshot.interactiveElements.some((el) => !el.hasAccessibleName)) {
      localAnomalies.push("Présence d'éléments interactifs sans nom accessible");
    }
    if (snapshot.extractedColors.length > 8) {
      localAnomalies.push(`Dispersion chromatique élevée (${snapshot.extractedColors.length} couleurs distinctes détectées)`);
    }
    if (snapshot.interactiveElements.some((el) => el.bounds.hasOverflow)) {
      localAnomalies.push("Éléments interactifs en débordement du viewport actif");
    }

    return {
      summary: `Analyse visuelle déterministe pour ${snapshot.viewport.kind} (${snapshot.viewport.width}x${snapshot.viewport.height}). ${snapshot.totalElementsCount} éléments inspectés.`,
      detectedAnomalies: localAnomalies,
      confidence: 0.85,
      modelUsed: 'local-deterministic-heuristics'
    };
  }
}
