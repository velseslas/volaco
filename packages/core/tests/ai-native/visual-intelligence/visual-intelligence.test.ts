import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  VisualIntelligenceService,
  DomNormalizer,
  StyleComputer,
  LayoutEngine,
  MultimodalAnalyzer,
  VisualIntelligenceLruCache,
  computeVisualSnapshotHash,
  canonicalizeColor,
  canonicalizeLength,
  STANDARD_VIEWPORTS,
  type VisualSnapshot,
  type VisualAnalysisRequest,
  type NormalizedDomNode,
  AIProviderRegistry,
  type AIProviderAdapter,
  ForbiddenError,
  NotFoundError
} from '../../../src/index.js';

describe('AINT-011 — Visual Intelligence Engine', () => {
  const tenantId = 'tenant_enterprise_vis';
  const projectId = 'proj_visual_portal';

  const sampleHtml = `
    <div id="app-root" class="min-h-screen bg-white text-gray-900">
      <header class="flex items-center justify-between p-4 bg-blue-600 text-white">
        <h1 class="text-2xl font-bold">Volaco Portal</h1>
        <nav class="flex gap-4">
          <a href="/dashboard" class="text-sm underline">Dashboard</a>
          <a href="/settings" class="text-sm">Settings</a>
        </nav>
      </header>
      <main class="p-6 max-w-4xl mx-auto">
        <section class="rounded-lg border border-gray-200 p-6 shadow-sm bg-white">
          <h2 class="text-xl font-semibold mb-2">User Overview</h2>
          <p class="text-sm text-gray-600 mb-4">Manage your organization team members and roles.</p>
          <form id="invite-form" class="flex gap-2">
            <input type="email" id="email-input" placeholder="user@example.com" aria-label="Email Address" class="border p-2 rounded text-sm" />
            <button type="submit" id="btn-invite" class="bg-indigo-600 text-white px-4 py-2 rounded font-medium">
              Send Invite
            </button>
          </form>
        </section>
      </main>
    </div>
  `;

  // ============================================================================
  // SECTION A: DOM Normalizer
  // ============================================================================
  describe('Section A: DOM Normalization', () => {
    const normalizer = new DomNormalizer();

    it('A1: doit parser du HTML headless en arbre NormalizedDomNode', () => {
      const root = normalizer.normalizeFromHtml(sampleHtml);
      assert.ok(root);
      assert.equal(root.tagName, 'div');
      assert.equal(root.id, 'app-root');
      assert.ok(root.children.length > 0);
    });

    it('A2: doit classifier correctement les roles semantiques (BUTTON, INPUT, LINK, HEADING, CARD, FORM)', () => {
      const root = normalizer.normalizeFromHtml(sampleHtml);
      const findByTag = (node: NormalizedDomNode, tag: string): NormalizedDomNode | undefined => {
        if (node.tagName === tag) return node;
        for (const child of node.children) {
          const found = findByTag(child, tag);
          if (found) return found;
        }
        return undefined;
      };

      const btn = findByTag(root, 'button');
      assert.ok(btn);
      assert.equal(btn.role, 'BUTTON');

      const inp = findByTag(root, 'input');
      assert.ok(inp);
      assert.equal(inp.role, 'INPUT');

      const link = findByTag(root, 'a');
      assert.ok(link);
      assert.equal(link.role, 'LINK');

      const h1 = findByTag(root, 'h1');
      assert.ok(h1);
      assert.equal(h1.role, 'HEADING');

      const form = findByTag(root, 'form');
      assert.ok(form);
      assert.equal(form.role, 'FORM');
    });

    it('A3: doit supporter la normalisation depuis un Runtime Probe (DOM sérialisé)', () => {
      const runtimeProbe = {
        id: 'runtime-root',
        tagName: 'div',
        role: 'CONTAINER',
        attributes: { 'data-testid': 'preview-app' },
        classes: ['app-container', 'p-4'],
        textContent: '',
        styles: {
          color: '#111827',
          backgroundColor: '#f9fafb',
          fontFamily: 'Inter, sans-serif',
          fontSize: '16px',
          fontWeight: '400',
          lineHeight: '24px',
          padding: '16px',
          margin: '0px',
          borderRadius: '0px',
          borderWidth: '0px',
          borderColor: 'transparent',
          boxShadow: 'none',
          display: 'block',
          flexDirection: 'row',
          justifyContent: 'flex-start',
          alignItems: 'stretch',
          gap: '0px',
          opacity: 1,
          zIndex: 0
        },
        layout: { x: 0, y: 0, width: 1280, height: 800, isVisible: true, hasOverflow: false },
        depth: 0,
        selector: '#runtime-root',
        children: [
          {
            id: 'probe-btn',
            tagName: 'button',
            role: 'BUTTON',
            attributes: { type: 'button' },
            classes: ['btn', 'btn-primary'],
            textContent: 'Action Probe',
            styles: {
              color: '#ffffff',
              backgroundColor: '#2563eb',
              fontFamily: 'Inter, sans-serif',
              fontSize: '14px',
              fontWeight: '600',
              lineHeight: '20px',
              padding: '8px 16px',
              margin: '4px',
              borderRadius: '6px',
              borderWidth: '1px',
              borderColor: '#1d4ed8',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              display: 'inline-flex',
              flexDirection: 'row',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '8px',
              opacity: 1,
              zIndex: 1
            },
            layout: { x: 20, y: 30, width: 120, height: 40, isVisible: true, hasOverflow: false },
            depth: 1,
            selector: '#runtime-root > #probe-btn',
            children: []
          }
        ]
      };

      const normalized = normalizer.normalizeFromRuntimeProbe(runtimeProbe);
      assert.equal(normalized.id, 'runtime-root');
      assert.equal(normalized.children.length, 1);
      assert.equal(normalized.children[0]?.role, 'BUTTON');
      assert.equal(normalized.children[0]?.textContent, 'Action Probe');
    });

    it('A4: doit tronquer proprement la profondeur si maxDepth est atteint', () => {
      const shallowNormalizer = new DomNormalizer(2);
      const deepHtml = '<div><div><div><div><span>Deep text</span></div></div></div></div>';
      const root = shallowNormalizer.normalizeFromHtml(deepHtml);
      assert.ok(root);
      assert.ok(root.depth <= 2);
    });

    it('A5: doit gérer gracieusement un HTML vide ou malformé', () => {
      const emptyRoot = normalizer.normalizeFromHtml('');
      assert.equal(emptyRoot.tagName, 'div');
      assert.equal(emptyRoot.children.length, 0);

      const malformedRoot = normalizer.normalizeFromHtml('<div><span>Unclosed paragraph<p>Test');
      assert.ok(malformedRoot);
      assert.ok(malformedRoot.children.length >= 1);
    });
  });

  // ============================================================================
  // SECTION B: Style Computer
  // ============================================================================
  describe('Section B: Style Computer', () => {
    const normalizer = new DomNormalizer();
    const styleComputer = new StyleComputer();

    it('B1: doit dériver les styles depuis les classes Tailwind standard', () => {
      const html = '<button class="bg-indigo-600 text-white font-bold p-4 rounded-lg shadow-md">Valider</button>';
      const raw = normalizer.normalizeFromHtml(html);
      const { updatedNode, colors } = styleComputer.computeNodeStyles(raw);

      assert.equal(updatedNode.styles.backgroundColor, '#4f46e5');
      assert.equal(updatedNode.styles.color, '#ffffff');
      assert.equal(updatedNode.styles.fontWeight, '700');
      assert.equal(updatedNode.styles.padding, '16px');
      assert.equal(updatedNode.styles.borderRadius, '8px');
      assert.ok(colors.includes('#4f46e5'));
      assert.ok(colors.includes('#ffffff'));
    });

    it('B2: doit intégrer les styles inline prioritaires sur les classes', () => {
      const html = '<div class="text-blue-500" style="color: #ff0000; font-size: 20px;">Important</div>';
      const raw = normalizer.normalizeFromHtml(html);
      const { updatedNode } = styleComputer.computeNodeStyles(raw);

      assert.equal(updatedNode.styles.color, '#ff0000');
      assert.equal(updatedNode.styles.fontSize, '20px');
    });

    it('B3: doit extraire la palette complète de couleurs et les polices uniques', () => {
      const raw = normalizer.normalizeFromHtml(sampleHtml);
      const { colors, fonts } = styleComputer.computeNodeStyles(raw);

      assert.ok(colors.length > 0);
      assert.ok(colors.some(c => c === '#4f46e5' || c === '#2563eb' || c === '#111827'));
      // É45 P5 (F1) — sampleHtml ne déclare AUCUNE police explicite : le
      // « sans-serif » compté avant correction était le fantôme du défaut.
      assert.ok(fonts.length === 0);
    });

    it('B4: doit parser une feuille de style CSS additionnelle', () => {
      const html = '<div id="custom-card">Contenu custom</div>';
      const css = '#custom-card { background-color: #0ea5e9; border-radius: 12px; }';
      const raw = normalizer.normalizeFromHtml(html);
      const { updatedNode } = styleComputer.computeNodeStyles(raw, css);

      assert.equal(updatedNode.styles.backgroundColor, '#0ea5e9');
      assert.equal(updatedNode.styles.borderRadius, '12px');
    });
  });

  // ============================================================================
  // SECTION C: Layout Engine & Interactive Profiles
  // ============================================================================
  describe('Section C: Layout Engine & Interactive Profiles', () => {
    const normalizer = new DomNormalizer();
    const styleComputer = new StyleComputer();
    const layoutEngine = new LayoutEngine();

    it('C1: doit calculer les dimensions du viewport Desktop (1280x800)', () => {
      const raw = normalizer.normalizeFromHtml(sampleHtml);
      const { updatedNode: styled } = styleComputer.computeNodeStyles(raw);
      const { updatedRoot } = layoutEngine.computeLayoutAndProfiles(styled, STANDARD_VIEWPORTS.DESKTOP);

      assert.equal(updatedRoot.layout.width, 1280);
      assert.equal(updatedRoot.layout.height, 800);
      assert.equal(updatedRoot.layout.isVisible, true);
    });

    it('C2: doit adapter le layout pour le viewport Mobile (375x667)', () => {
      const raw = normalizer.normalizeFromHtml(sampleHtml);
      const { updatedNode: styled } = styleComputer.computeNodeStyles(raw);
      const { updatedRoot } = layoutEngine.computeLayoutAndProfiles(styled, STANDARD_VIEWPORTS.MOBILE);

      assert.equal(updatedRoot.layout.width, 375);
      assert.equal(updatedRoot.layout.height, 667);
    });

    it('C3: doit extraire tous les éléments interactifs avec leurs sélecteurs et libellés', () => {
      const raw = normalizer.normalizeFromHtml(sampleHtml);
      const { updatedNode: styled } = styleComputer.computeNodeStyles(raw);
      const { interactiveElements } = layoutEngine.computeLayoutAndProfiles(styled, STANDARD_VIEWPORTS.DESKTOP);

      assert.ok(interactiveElements.length >= 4);

      const btnProfile = interactiveElements.find(el => el.role === 'BUTTON');
      assert.ok(btnProfile);
      assert.equal(btnProfile.isClickable, true);
      assert.equal(btnProfile.label, 'Send Invite');
      assert.equal(btnProfile.hasAccessibleName, true);

      const inputProfile = interactiveElements.find(el => el.role === 'INPUT');
      assert.ok(inputProfile);
      assert.equal(inputProfile.isFormInput, true);
      assert.equal(inputProfile.label, 'Email Address');
      assert.equal(inputProfile.hasAccessibleName, true);
    });

    it('C4: doit détecter les éléments masqués (display: none ou opacity: 0)', () => {
      const html = `
        <div>
          <button style="display: none;">Caché Display</button>
          <button style="opacity: 0;">Caché Opacity</button>
          <button>Visible</button>
        </div>
      `;
      const raw = normalizer.normalizeFromHtml(html);
      const { updatedNode: styled } = styleComputer.computeNodeStyles(raw);
      const { interactiveElements } = layoutEngine.computeLayoutAndProfiles(styled, STANDARD_VIEWPORTS.DESKTOP);

      const visible = interactiveElements.filter(el => el.bounds.isVisible);
      assert.equal(visible.length, 1);
      assert.equal(visible[0]?.label, 'Visible');
    });

    it('C5: doit détecter un bouton sans nom accessible (accessible name manquant)', () => {
      const html = '<button id="icon-only-btn"><span class="icon"></span></button>';
      const raw = normalizer.normalizeFromHtml(html);
      const { updatedNode: styled } = styleComputer.computeNodeStyles(raw);
      const { interactiveElements } = layoutEngine.computeLayoutAndProfiles(styled, STANDARD_VIEWPORTS.DESKTOP);

      const btn = interactiveElements[0];
      assert.ok(btn);
      assert.equal(btn.hasAccessibleName, false);
      assert.equal(btn.label, '');
    });
  });

  // ============================================================================
  // SECTION D: Canonical Utilities & Hashing
  // ============================================================================
  describe('Section D: Canonical Utilities & Hashing', () => {
    it('D1: doit canonicaliser les couleurs hex (3 vs 6 chiffres, casse)', () => {
      assert.equal(canonicalizeColor('#fff'), '#ffffff');
      assert.equal(canonicalizeColor('#FFF'), '#ffffff');
      assert.equal(canonicalizeColor('#4F46E5'), '#4f46e5');
    });

    it('D2: doit canonicaliser les formats rgb() et rgba()', () => {
      assert.equal(canonicalizeColor('rgb(255, 255, 255)'), '#ffffff');
      assert.equal(canonicalizeColor('rgb(79, 70, 229)'), '#4f46e5');
      assert.equal(canonicalizeColor('rgba(0, 0, 0, 0)'), 'transparent');
      assert.equal(canonicalizeColor('rgba(255, 0, 0, 0.5)'), 'rgba(255,0,0,0.5)');
    });

    it('D3: doit canonicaliser les longueurs CSS (rem, em, px, 0)', () => {
      assert.equal(canonicalizeLength('0px'), 0);
      assert.equal(canonicalizeLength('0'), 0);
      assert.equal(canonicalizeLength('1rem'), 16);
      assert.equal(canonicalizeLength('1.5rem'), 24);
      assert.equal(canonicalizeLength('12px'), 12);
    });

    it('D4: doit générer un condensat SHA-256 déterministe et reproductible', () => {
      const normalizer = new DomNormalizer();
      const styleComputer = new StyleComputer();
      const layoutEngine = new LayoutEngine();

      const raw = normalizer.normalizeFromHtml(sampleHtml);
      const { updatedNode: styled, colors, fonts } = styleComputer.computeNodeStyles(raw);
      const { updatedRoot } = layoutEngine.computeLayoutAndProfiles(styled, STANDARD_VIEWPORTS.DESKTOP);

      const hash1 = computeVisualSnapshotHash({
        tenantId: 'tenant1',
        projectId: 'proj1',
        viewport: STANDARD_VIEWPORTS.DESKTOP,
        rootNode: updatedRoot,
        extractedColors: colors,
        extractedFonts: fonts
      });

      const hash2 = computeVisualSnapshotHash({
        tenantId: 'tenant1',
        projectId: 'proj1',
        viewport: STANDARD_VIEWPORTS.DESKTOP,
        rootNode: updatedRoot,
        extractedColors: colors,
        extractedFonts: fonts
      });

      assert.equal(hash1, hash2);
      assert.match(hash1, /^vis:[a-f0-9]{16}$/);
    });

    it('D5: un changement de couleur ou de texte doit modifier le snapshot hash', () => {
      const normalizer = new DomNormalizer();
      const styleComputer = new StyleComputer();
      const layoutEngine = new LayoutEngine();

      const raw1 = normalizer.normalizeFromHtml('<div><button class="bg-blue-600">Click</button></div>');
      const { updatedNode: styled1, colors: c1, fonts: f1 } = styleComputer.computeNodeStyles(raw1);
      const { updatedRoot: r1 } = layoutEngine.computeLayoutAndProfiles(styled1, STANDARD_VIEWPORTS.DESKTOP);

      const raw2 = normalizer.normalizeFromHtml('<div><button class="bg-red-600">Click</button></div>');
      const { updatedNode: styled2, colors: c2, fonts: f2 } = styleComputer.computeNodeStyles(raw2);
      const { updatedRoot: r2 } = layoutEngine.computeLayoutAndProfiles(styled2, STANDARD_VIEWPORTS.DESKTOP);

      const hash1 = computeVisualSnapshotHash({
        tenantId: 'tenant1',
        projectId: 'proj1',
        viewport: STANDARD_VIEWPORTS.DESKTOP,
        rootNode: r1,
        extractedColors: c1,
        extractedFonts: f1
      });

      const hash2 = computeVisualSnapshotHash({
        tenantId: 'tenant1',
        projectId: 'proj1',
        viewport: STANDARD_VIEWPORTS.DESKTOP,
        rootNode: r2,
        extractedColors: c2,
        extractedFonts: f2
      });

      assert.notEqual(hash1, hash2);
    });
  });

  // ============================================================================
  // SECTION E: LRU Cache
  // ============================================================================
  describe('Section E: LRU Cache', () => {
    it('E1: doit stocker et récupérer un snapshot par sa clé', () => {
      const cache = new VisualIntelligenceLruCache(3);
      const dummySnap = { snapshotId: 'snap-1' } as unknown as VisualSnapshot;

      cache.set('key-1', dummySnap);
      assert.equal(cache.get('key-1'), dummySnap);
      assert.equal(cache.size, 1);
    });

    it('E2: doit évincer le plus ancien élément quand maxEntries est dépassé', () => {
      const cache = new VisualIntelligenceLruCache(2);
      const snap1 = { snapshotId: 'snap-1' } as unknown as VisualSnapshot;
      const snap2 = { snapshotId: 'snap-2' } as unknown as VisualSnapshot;
      const snap3 = { snapshotId: 'snap-3' } as unknown as VisualSnapshot;

      cache.set('k1', snap1);
      cache.set('k2', snap2);
      cache.set('k3', snap3);

      assert.equal(cache.get('k1'), undefined);
      assert.equal(cache.get('k2'), snap2);
      assert.equal(cache.get('k3'), snap3);
      assert.equal(cache.size, 2);
    });

    it('E3: doit rafraîchir la récence lors d un get()', () => {
      const cache = new VisualIntelligenceLruCache(2);
      const snap1 = { snapshotId: 'snap-1' } as unknown as VisualSnapshot;
      const snap2 = { snapshotId: 'snap-2' } as unknown as VisualSnapshot;
      const snap3 = { snapshotId: 'snap-3' } as unknown as VisualSnapshot;

      cache.set('k1', snap1);
      cache.set('k2', snap2);
      cache.get('k1');
      cache.set('k3', snap3);

      assert.equal(cache.get('k1'), snap1);
      assert.equal(cache.get('k2'), undefined);
      assert.equal(cache.get('k3'), snap3);
    });
  });

  // ============================================================================
  // SECTION F: Multimodal Vision Analyzer
  // ============================================================================
  describe('Section F: Multimodal Vision Analyzer', () => {
    it('F1: doit produire des insights heuristiques déterministes en l absence de provider Vision', async () => {
      const analyzer = new MultimodalAnalyzer(undefined);
      const normalizer = new DomNormalizer();
      const styleComputer = new StyleComputer();
      const layoutEngine = new LayoutEngine();

      const raw = normalizer.normalizeFromHtml(sampleHtml);
      const { updatedNode: styled, colors, fonts } = styleComputer.computeNodeStyles(raw);
      const { updatedRoot, interactiveElements, totalElements } = layoutEngine.computeLayoutAndProfiles(
        styled,
        STANDARD_VIEWPORTS.DESKTOP
      );

      const snapshot: VisualSnapshot = {
        snapshotId: 'test-snap',
        tenantId,
        projectId,
        pageRoute: '/',
        viewport: STANDARD_VIEWPORTS.DESKTOP,
        rootNode: updatedRoot,
        totalElementsCount: totalElements,
        interactiveElements,
        extractedColors: colors,
        extractedFonts: fonts,
        snapshotHash: 'abcdef0123456789',
        capturedAt: new Date().toISOString(),
        durationMs: 10
      };

      const result = await analyzer.analyzeSnapshot({ snapshot, tenantId, projectId });
      assert.ok(result);
      assert.equal(result.modelUsed, 'local-deterministic-heuristics');
      assert.ok(result.summary.length > 0);
      assert.ok(result.confidence >= 0.85);
    });

    it('F2: doit déléguer à un provider IA vision si disponible dans le registre', async () => {
      const registry = new AIProviderRegistry();
      const mockVisionAdapter: AIProviderAdapter = {
        descriptor: {
          providerId: 'mock-gemini-vision',
          providerName: 'Mock Gemini Vision',
          models: ['gemini-1.5-pro'],
          capabilities: ['VISION', 'STREAMING'],
          contextWindow: 1000000,
          structuredOutput: true,
          streaming: true,
          toolCalling: true,
          reasoning: false,
          vision: true,
          costMetadata: {},
          availability: 'AVAILABLE',
          healthStatus: 'HEALTHY'
        },
        async generate() {
          return {
            text: 'Vision analysis detected modern clean UI layout with well-balanced hierarchy.\n- anomalie: Button contrast could be slightly higher for dark mode.',
            providerId: 'mock-gemini-vision',
            modelId: 'gemini-1.5-pro',
            latencyMs: 15,
            usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
            costUsd: 0.0001
          };
        }
      };
      registry.register(mockVisionAdapter);

      const analyzer = new MultimodalAnalyzer(registry);
      const normalizer = new DomNormalizer();
      const styleComputer = new StyleComputer();
      const layoutEngine = new LayoutEngine();

      const raw = normalizer.normalizeFromHtml(sampleHtml);
      const { updatedNode: styled, colors, fonts } = styleComputer.computeNodeStyles(raw);
      const { updatedRoot, interactiveElements, totalElements } = layoutEngine.computeLayoutAndProfiles(
        styled,
        STANDARD_VIEWPORTS.DESKTOP
      );

      const snapshot: VisualSnapshot = {
        snapshotId: 'test-snap-vision',
        tenantId,
        projectId,
        pageRoute: '/',
        viewport: STANDARD_VIEWPORTS.DESKTOP,
        rootNode: updatedRoot,
        totalElementsCount: totalElements,
        interactiveElements,
        extractedColors: colors,
        extractedFonts: fonts,
        snapshotHash: 'abcdef0123456789',
        capturedAt: new Date().toISOString(),
        durationMs: 12,
        screenshotBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      };

      const result = await analyzer.analyzeSnapshot({ snapshot, tenantId, projectId });
      assert.ok(result);
      assert.equal(result.modelUsed, 'gemini-1.5-pro');
      assert.ok(result.summary.includes('Vision analysis detected'));
      assert.equal(result.detectedAnomalies.length, 1);
      assert.ok(result.confidence >= 0.85);
    });
  });

  // ============================================================================
  // SECTION G: Visual Intelligence Service End-to-End
  // ============================================================================
  describe('Section G: Visual Intelligence Service End-to-End', () => {
    let service: VisualIntelligenceService;

    beforeEach(() => {
      service = new VisualIntelligenceService(undefined, { enableVisionLLM: true });
    });

    it('G1: doit exécuter une analyse visuelle complète depuis HTML headless', async () => {
      const result = await service.analyzeVisuals({
        tenantId,
        projectId,
        htmlContent: sampleHtml,
        viewport: 'DESKTOP'
      });

      assert.ok(result.snapshot);
      assert.equal(result.snapshot.tenantId, tenantId);
      assert.equal(result.snapshot.projectId, projectId);
      assert.equal(result.snapshot.viewport.kind, 'DESKTOP');
      assert.ok(result.snapshot.interactiveElements.length >= 4);
      assert.ok(result.snapshot.extractedColors.length > 0);
      assert.equal(result.executionMeta.source, 'HEADLESS_HTML');
      assert.ok(result.multimodalInsights);
    });

    it('G2: doit retourner un résultat mis en cache lors d un appel subséquent (Cache Hit)', async () => {
      const req: VisualAnalysisRequest = {
        tenantId,
        projectId,
        pageRoute: '/dashboard',
        htmlContent: sampleHtml,
        viewport: 'TABLET'
      };

      const res1 = await service.analyzeVisuals(req);
      assert.equal(res1.executionMeta.source, 'HEADLESS_HTML');

      const res2 = await service.analyzeVisuals(req);
      assert.equal(res2.executionMeta.source, 'CACHED');
      assert.equal(res2.snapshot.snapshotId, res1.snapshot.snapshotId);
      assert.equal(res2.snapshot.snapshotHash, res1.snapshot.snapshotHash);
    });

    it('G3: doit permettre de récupérer un snapshot par ID avec getSnapshot()', async () => {
      const res = await service.analyzeVisuals({
        tenantId,
        projectId,
        htmlContent: sampleHtml
      });

      const retrieved = service.getSnapshot(res.snapshot.snapshotId, tenantId, 'ENGINEER');
      assert.ok(retrieved);
      assert.equal(retrieved.snapshotId, res.snapshot.snapshotId);
    });

    it('G4: doit interdire la consultation d une capture appartenant à un autre tenant (Isolation)', async () => {
      const res = await service.analyzeVisuals({
        tenantId: 'tenant_alpha',
        projectId: 'proj_alpha',
        htmlContent: sampleHtml
      });

      assert.throws(
        () => service.getSnapshot(res.snapshot.snapshotId, 'tenant_other', 'OWNER'),
        (err: unknown) => err instanceof NotFoundError
      );
    });

    it('G5: doit respecter les permissions RBAC (VIEWER autorisé en lecture, rôle invalide rejeté)', async () => {
      const res = await service.analyzeVisuals(
        {
          tenantId,
          projectId,
          htmlContent: sampleHtml
        },
        'VIEWER'
      );
      assert.ok(res.snapshot);

      assert.throws(
        // @ts-expect-error test unauthorized role
        () => service.getSnapshot(res.snapshot.snapshotId, tenantId, 'UNKNOWN_ROLE'),
        (err: unknown) => err instanceof ForbiddenError
      );
    });

    it('G6: doit supporter le vidage du cache avec clearCache()', async () => {
      const req: VisualAnalysisRequest = {
        tenantId,
        projectId,
        pageRoute: '/cleartest',
        htmlContent: sampleHtml
      };

      const res1 = await service.analyzeVisuals(req);
      service.clearCache();

      const retrieved = service.getSnapshot(res1.snapshot.snapshotId, tenantId);
      assert.equal(retrieved, undefined);
    });
  });
});
