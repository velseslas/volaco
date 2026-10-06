/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-011)
 * Visual Intelligence Service Facade
 */

import { createHash, randomUUID } from 'node:crypto';
import { assertPermission, type Role } from '../../identity/permissions.js';
import { auditStore } from '../../observability/audit.js';
import { NotFoundError } from '../../errors.js';
import type { AIProviderRegistry } from '../../ai/providers/registry.js';
import { computeVisualSnapshotHash, deepFreeze } from './canonical.js';
import { VisualIntelligenceLruCache } from './cache.js';
import { DomNormalizer } from './engine/dom-normalizer.js';
import { StyleComputer } from './engine/style-computer.js';
import { LayoutEngine } from './engine/layout-engine.js';
import { MultimodalAnalyzer } from './engine/multimodal-analyzer.js';
import {
  STANDARD_VIEWPORTS,
  type VisualAnalysisRequest,
  type VisualAnalysisResult,
  type VisualIntelligenceConfig,
  type VisualSnapshot
} from './types.js';

export const DEFAULT_VISUAL_CONFIG: VisualIntelligenceConfig = {
  cacheMaxEntries: 100,
  defaultViewport: 'DESKTOP',
  enableVisionLLM: true,
  maxDomDepth: 32
};

export class VisualIntelligenceService {
  private readonly config: VisualIntelligenceConfig;
  private readonly cache: VisualIntelligenceLruCache;
  private readonly domNormalizer: DomNormalizer;
  private readonly styleComputer: StyleComputer;
  private readonly layoutEngine: LayoutEngine;
  private readonly multimodalAnalyzer: MultimodalAnalyzer;

  constructor(
    providerRegistry?: AIProviderRegistry | undefined,
    config?: Partial<VisualIntelligenceConfig> | undefined
  ) {
    this.config = {
      ...DEFAULT_VISUAL_CONFIG,
      ...config
    };

    this.cache = new VisualIntelligenceLruCache(this.config.cacheMaxEntries);
    this.domNormalizer = new DomNormalizer(this.config.maxDomDepth);
    this.styleComputer = new StyleComputer();
    this.layoutEngine = new LayoutEngine();
    this.multimodalAnalyzer = new MultimodalAnalyzer(providerRegistry);
  }

  public async analyzeVisuals(
    request: VisualAnalysisRequest,
    userRole: Role = 'VIEWER'
  ): Promise<VisualAnalysisResult> {
    const {
      tenantId,
      projectId,
      pageRoute = '/',
      htmlContent,
      cssContent,
      runtimeDom,
      viewport: requestedViewport,
      screenshotBase64,
      requestId
    } = request;

    assertPermission(userRole, 'PROJECT_READ', requestId);
    const startMs = Date.now();

    const viewportKind = requestedViewport || this.config.defaultViewport;
    const viewport = STANDARD_VIEWPORTS[viewportKind];
    // É45 P2 — empreinte déterministe du contenu dans la clé : sans elle,
    // tenant:project:page:viewport resservait un snapshot stale après édition
    // du même projet (LRU sans TTL, clearCache() sans appelant production).
    const contentFingerprint = createHash('sha256').update(htmlContent ?? '', 'utf8').digest('hex').substring(0, 16);
    const cacheKey = `${tenantId}:${projectId}:${pageRoute}:${viewportKind}:${contentFingerprint}`;

    // 1. Check LRU Cache
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return {
        snapshot: cached,
        executionMeta: {
          durationMs: Date.now() - startMs,
          source: 'CACHED'
        }
      };
    }

    // 2. Normalize DOM
    let rawRootNode = runtimeDom
      ? this.domNormalizer.normalizeFromRuntimeProbe(runtimeDom)
      : this.domNormalizer.normalizeFromHtml(htmlContent || '');

    // 3. Compute Styles
    const { updatedNode: styledRoot, colors, fonts } = this.styleComputer.computeNodeStyles(
      rawRootNode,
      cssContent || ''
    );

    // 4. Compute Layout & Profiles
    const { updatedRoot, interactiveElements, totalElements } = this.layoutEngine.computeLayoutAndProfiles(
      styledRoot,
      viewport
    );

    // 5. Compute Snapshot Hash
    const snapshotHash = computeVisualSnapshotHash({
      tenantId,
      projectId,
      viewport,
      rootNode: updatedRoot,
      extractedColors: colors,
      extractedFonts: fonts
    });

    const snapshotId = `vissnap-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const durationMs = Date.now() - startMs;

    const snapshot: VisualSnapshot = deepFreeze({
      snapshotId,
      tenantId,
      projectId,
      pageRoute,
      viewport,
      rootNode: updatedRoot,
      totalElementsCount: totalElements,
      interactiveElements,
      extractedColors: colors,
      extractedFonts: fonts,
      snapshotHash,
      capturedAt: new Date().toISOString(),
      durationMs,
      screenshotBase64
    });

    // 6. Optional Multimodal Vision Analysis
    let multimodalInsights = undefined;
    if (this.config.enableVisionLLM) {
      multimodalInsights = await this.multimodalAnalyzer.analyzeSnapshot({
        snapshot,
        tenantId,
        projectId,
        requestId
      });
    }

    // 7. Store in Cache
    this.cache.set(cacheKey, snapshot);
    this.cache.set(snapshotId, snapshot);

    // 8. Record Observability Audit
    auditStore.record({
      tenantId,
      userId: 'system',
      action: 'VISUAL_ANALYSIS_COMPLETED',
      resourceType: 'visual_intelligence',
      resourceId: snapshotId,
      status: 'SUCCESS',
      metadata: {
        projectId,
        pageRoute,
        viewport: viewportKind,
        totalElements,
        colorsCount: colors.length,
        interactiveCount: interactiveElements.length
      },
      requestId: requestId || 'req-vis'
    });

    return {
      snapshot,
      multimodalInsights,
      executionMeta: {
        durationMs,
        source: runtimeDom ? 'RUNTIME_PROBE' : 'HEADLESS_HTML'
      }
    };
  }

  public getSnapshot(
    snapshotId: string,
    tenantId: string,
    userRole: Role = 'VIEWER',
    requestId?: string | undefined
  ): VisualSnapshot | undefined {
    assertPermission(userRole, 'PROJECT_READ', requestId);
    const snap = this.cache.get(snapshotId);
    if (!snap) return undefined;

    // Strict multi-tenant isolation
    if (snap.tenantId !== tenantId) {
      throw new NotFoundError(`Capture visuelle '${snapshotId}' introuvable.`);
    }

    return snap;
  }

  public clearCache(): void {
    this.cache.clear();
  }
}
