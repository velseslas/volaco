import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DesignHarmonyService,
  TokenInferer,
  DriftDetector,
  ComponentHarmonyEngine,
  CrossPageHarmonyEngine,
  ResponsiveA11yHarmonyEngine,
  ScoreEngine,
  RecommendationEngine,
  DesignHarmonyConversationBridge,
  DesignHarmonyLruCache,
  computeContrastRatio,
  computeColorDistance,
  computeRelativeLuminance,
  parseRgb,
  compareFindings,
  computeDesignHarmonyReportHash,
  VisualIntelligenceService,
  STANDARD_VIEWPORTS,
  type VisualSnapshot,
  type DesignHarmonyFinding,
  type InferredDesignSystem,
  type DesignHarmonyReport,
  NotFoundError,
  ForbiddenError
} from '../../../src/index.js';

describe('AINT-012 — Design Harmony Engine', () => {
  const tenantId = 'tenant_enterprise_dh';
  const projectId = 'proj_harmony_portal';

  const visService = new VisualIntelligenceService();
  let testRouteCounter = 0;

  beforeEach(() => {
    visService.clearCache();
  });

  // Helper to quickly create a mock or real VisualSnapshot from HTML
  const createSnapshot = async (
    html: string,
    route?: string,
    viewport: 'MOBILE' | 'TABLET' | 'DESKTOP' = 'DESKTOP'
  ): Promise<VisualSnapshot> => {
    const pageRoute = route ?? `/test-route-${++testRouteCounter}`;
    const res = await visService.analyzeVisuals({
      tenantId,
      projectId,
      pageRoute,
      htmlContent: html,
      viewport
    });
    return res.snapshot;
  };

  const sampleHarmoniousHtml = `
    <div id="app" class="min-h-screen bg-white text-gray-900 font-sans">
      <header class="flex items-center justify-between p-4 bg-blue-600 text-white">
        <h1 class="text-2xl font-bold">Portail Entreprise</h1>
        <nav class="flex gap-4">
          <a href="/dashboard" class="text-sm underline">Dashboard</a>
          <a href="/settings" class="text-sm">Settings</a>
        </nav>
      </header>
      <main class="p-8 max-w-4xl mx-auto">
        <section class="rounded-lg border border-gray-200 p-8 shadow-sm bg-white">
          <h2 class="text-xl font-semibold mb-4">Vue d'ensemble</h2>
          <div class="flex gap-4">
            <button class="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium" aria-label="Action 1">Bouton 1</button>
            <button class="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium" aria-label="Action 2">Bouton 2</button>
            <button class="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium" aria-label="Action 3">Bouton 3</button>
          </div>
        </section>
      </main>
    </div>
  `;

  // ============================================================================
  // SECTION A: Token Inference
  // ============================================================================
  describe('Section A: Token Inference', () => {
    const inferer = new TokenInferer();

    it('A1: doit inférer la couleur primaire à partir des boutons et accents', async () => {
      const snap = await createSnapshot(sampleHarmoniousHtml);
      const ds = inferer.inferDesignSystem([snap]);

      assert.ok(ds.colorTokens.primary);
      assert.equal(ds.colorTokens.primary, '#2563eb');
    });

    it('A2: doit inférer les couleurs de background, foreground et surface', async () => {
      const snap = await createSnapshot(sampleHarmoniousHtml);
      const ds = inferer.inferDesignSystem([snap]);

      assert.equal(ds.colorTokens.background, '#ffffff');
      assert.equal(ds.colorTokens.foreground, '#111827');
      assert.ok(ds.colorTokens.surface);
    });

    it('A3: doit inférer les tokens de typographie (famille principale et échelle)', async () => {
      const snap = await createSnapshot(sampleHarmoniousHtml);
      const ds = inferer.inferDesignSystem([snap]);

      assert.ok(ds.typographyTokens.detectedScale.length >= 2);
      assert.ok(ds.typographyTokens.dominantLineHeightRatio > 1);
    });

    it('A4: doit découvrir le pas de grille de spacing (8px ou 4px)', async () => {
      const snap = await createSnapshot(sampleHarmoniousHtml);
      const ds = inferer.inferDesignSystem([snap]);

      assert.ok(ds.spacingTokens.baseGridStep === 8 || ds.spacingTokens.baseGridStep === 4);
      assert.ok(ds.spacingTokens.regularityRatio >= 0.7);
    });

    it('A5: doit inférer le border-radius modal des boutons (Shape Tokens)', async () => {
      const snap = await createSnapshot(sampleHarmoniousHtml);
      const ds = inferer.inferDesignSystem([snap]);

      assert.equal(ds.shapeTokens.primaryButtonRadius, '8px');
    });

    it('A6: doit inférer les niveaux d élévation', async () => {
      const snap = await createSnapshot(sampleHarmoniousHtml);
      const ds = inferer.inferDesignSystem([snap]);

      assert.ok(ds.elevationTokens.detectedLevelsCount >= 1);
    });

    it('A7: doit calculer un indice de confiance système proportionné aux preuves', async () => {
      const snap = await createSnapshot(sampleHarmoniousHtml);
      const ds = inferer.inferDesignSystem([snap]);

      assert.ok(ds.systemConfidence >= 0.7 && ds.systemConfidence <= 1);
      assert.ok(ds.evidenceCount > 5);
    });
  });

  // ============================================================================
  // SECTION B: Design Drift Detection
  // ============================================================================
  describe('Section B: Design Drift Detection', () => {
    const inferer = new TokenInferer();
    const driftDetector = new DriftDetector();

    it('B1: doit détecter un espacement hors grille (ex: padding 13px vs grille 8px)', async () => {
      const driftHtml = `
        <div class="bg-white">
          <div style="padding: 13px;" class="text-black">Bloc avec dérive d'espacement</div>
        </div>
      `;
      const snap = await createSnapshot(driftHtml, '/drift-space');
      const ds: InferredDesignSystem = {
        colorTokens: { primary: '#2563eb' },
        typographyTokens: { primaryFontFamily: 'sans-serif', fontFamilies: [], detectedScale: [], dominantLineHeightRatio: 1.5 },
        spacingTokens: { baseGridStep: 8, detectedScale: [8, 16], regularityRatio: 0.9 },
        shapeTokens: { primaryButtonRadius: '8px', primaryCardRadius: '8px', primaryInputRadius: '8px', detectedRadii: [] },
        elevationTokens: { detectedLevelsCount: 1, shadowLevels: [] },
        systemConfidence: 0.9,
        evidenceCount: 10
      };

      const findings = driftDetector.detectDrifts([snap], ds);
      const spaceFinding = findings.find((f) => f.category === 'SPACING' && f.property === 'padding');

      assert.ok(spaceFinding);
      assert.equal(spaceFinding.observedValue, '13px');
      assert.equal(spaceFinding.expectedValue, '16px');
      assert.equal(spaceFinding.designDrift, true);
      assert.equal(spaceFinding.evidence.length, 1);
    });

    it('B2: doit détecter un borderRadius divergent sur un bouton (rounded-sm vs rounded-lg)', async () => {
      const driftHtml = `
        <div>
          <button class="bg-blue-600 text-white rounded-sm p-2" aria-label="Bouton dérive">Bouton Dérive</button>
        </div>
      `;
      const snap = await createSnapshot(driftHtml, '/drift-radius');
      const ds: InferredDesignSystem = {
        colorTokens: { primary: '#2563eb' },
        typographyTokens: { primaryFontFamily: 'sans-serif', fontFamilies: [], detectedScale: [], dominantLineHeightRatio: 1.5 },
        spacingTokens: { baseGridStep: 8, detectedScale: [8], regularityRatio: 0.9 },
        shapeTokens: { primaryButtonRadius: '8px', primaryCardRadius: '8px', primaryInputRadius: '8px', detectedRadii: ['8px'] },
        elevationTokens: { detectedLevelsCount: 1, shadowLevels: [] },
        systemConfidence: 0.9,
        evidenceCount: 10
      };

      const findings = driftDetector.detectDrifts([snap], ds);
      const radiusFinding = findings.find((f) => f.category === 'SHAPE' && f.property === 'borderRadius');

      assert.ok(radiusFinding);
      assert.equal(radiusFinding.observedValue, '2px');
      assert.equal(radiusFinding.expectedValue, '8px');
      assert.equal(radiusFinding.designDrift, true);
    });

    it('B3: doit détecter une couleur quasi-doublon accidentelle (distance Delta < 35)', async () => {
      const driftHtml = `
        <div>
          <div style="background-color: #2460e8;" class="text-white p-4">Bloc avec bleu légèrement dérivé</div>
        </div>
      `;
      const snap = await createSnapshot(driftHtml, '/drift-color');
      const ds: InferredDesignSystem = {
        colorTokens: { primary: '#2563eb' },
        typographyTokens: { primaryFontFamily: 'sans-serif', fontFamilies: [], detectedScale: [], dominantLineHeightRatio: 1.5 },
        spacingTokens: { baseGridStep: 8, detectedScale: [8], regularityRatio: 0.9 },
        shapeTokens: { primaryButtonRadius: '8px', primaryCardRadius: '8px', primaryInputRadius: '8px', detectedRadii: [] },
        elevationTokens: { detectedLevelsCount: 1, shadowLevels: [] },
        systemConfidence: 0.9,
        evidenceCount: 10
      };

      const findings = driftDetector.detectDrifts([snap], ds);
      const colorFinding = findings.find((f) => f.category === 'COLOR');

      assert.ok(colorFinding);
      assert.equal(colorFinding.observedValue, '#2460e8');
      assert.equal(colorFinding.expectedValue, '#2563eb');
      assert.equal(colorFinding.designDrift, true);
    });

    it('B4: Principe NO EVIDENCE -> NO CLAIM : chaque finding doit comporter des preuves exploitables', async () => {
      const driftHtml = '<div style="padding: 11px;">Test Evidence</div>';
      const snap = await createSnapshot(driftHtml, '/drift-evidence');
      const ds: InferredDesignSystem = {
        colorTokens: {},
        typographyTokens: { primaryFontFamily: 'sans-serif', fontFamilies: [], detectedScale: [], dominantLineHeightRatio: 1.5 },
        spacingTokens: { baseGridStep: 8, detectedScale: [8], regularityRatio: 0.9 },
        shapeTokens: { primaryButtonRadius: '8px', primaryCardRadius: '8px', primaryInputRadius: '8px', detectedRadii: [] },
        elevationTokens: { detectedLevelsCount: 0, shadowLevels: [] },
        systemConfidence: 0.8,
        evidenceCount: 5
      };

      const findings = driftDetector.detectDrifts([snap], ds);
      for (const f of findings) {
        assert.ok(f.pageRoute);
        assert.ok(f.property);
        assert.ok(f.observedValue !== undefined);
        assert.ok(f.evidence.length > 0);
        assert.ok(f.evidence[0]!.source);
        assert.ok(f.evidence[0]!.detail.length > 0);
      }
    });

    it('B5: ne doit lever aucun finding de drift sur une interface strictement alignée', async () => {
      const snap = await createSnapshot(sampleHarmoniousHtml);
      const ds = inferer.inferDesignSystem([snap]);
      const findings = driftDetector.detectDrifts([snap], ds);

      // In the harmonious sample, padding is 16px/32px (multiples of 8) and radius is 8px
      const driftFindings = findings.filter((f) => f.designDrift);
      assert.equal(driftFindings.length, 0);
    });
  });

  // ============================================================================
  // SECTION C: Component Harmony
  // ============================================================================
  describe('Section C: Component Harmony', () => {
    const compEngine = new ComponentHarmonyEngine();

    it('C1: doit détecter un bouton avec hauteur divergente au sein d un cluster homogène', async () => {
      const html = `
        <div>
          <button style="height: 40px;" class="p-2" aria-label="B1">Btn 1</button>
          <button style="height: 40px;" class="p-2" aria-label="B2">Btn 2</button>
          <button style="height: 40px;" class="p-2" aria-label="B3">Btn 3</button>
          <button style="height: 56px;" class="p-2" aria-label="B4">Btn Outlier</button>
        </div>
      `;
      const snap = await createSnapshot(html, '/comp-cluster');
      const findings = compEngine.analyzeComponentClusters([snap]);

      const heightFinding = findings.find((f) => f.property === 'height' && f.category === 'COMPONENT');
      assert.ok(heightFinding);
      assert.equal(heightFinding.observedValue, '56px');
      assert.equal(heightFinding.expectedValue, '40px');
    });

    it('C2: doit détecter un padding divergent sur un bouton au sein d un cluster', async () => {
      const html = `
        <div>
          <button style="padding: 8px 16px;" aria-label="B1">Btn 1</button>
          <button style="padding: 8px 16px;" aria-label="B2">Btn 2</button>
          <button style="padding: 8px 16px;" aria-label="B3">Btn 3</button>
          <button style="padding: 4px 8px;" aria-label="B4">Btn Small</button>
        </div>
      `;
      const snap = await createSnapshot(html, '/comp-pad');
      const findings = compEngine.analyzeComponentClusters([snap]);

      const padFinding = findings.find((f) => f.property === 'padding');
      assert.ok(padFinding);
      assert.equal(padFinding.observedValue, '4px 8px');
      assert.equal(padFinding.expectedValue, '8px 16px');
    });

    it('C3: ne doit pas signaler d anomalie sur un cluster de composants parfaitement harmonieux', async () => {
      const html = `
        <div>
          <button style="height: 40px; padding: 8px 16px;" aria-label="B1">Btn 1</button>
          <button style="height: 40px; padding: 8px 16px;" aria-label="B2">Btn 2</button>
          <button style="height: 40px; padding: 8px 16px;" aria-label="B3">Btn 3</button>
        </div>
      `;
      const snap = await createSnapshot(html, '/comp-clean');
      const findings = compEngine.analyzeComponentClusters([snap]);

      assert.equal(findings.length, 0);
    });

    it('C4: doit ignorer gracieusement les clusters trop réduits (< 3 éléments)', async () => {
      const html = `
        <div>
          <button style="height: 30px;" aria-label="B1">Btn 1</button>
          <button style="height: 50px;" aria-label="B2">Btn 2</button>
        </div>
      `;
      const snap = await createSnapshot(html, '/comp-tiny');
      const findings = compEngine.analyzeComponentClusters([snap]);

      assert.equal(findings.length, 0);
    });
  });

  // ============================================================================
  // SECTION D: Cross-Page Harmony
  // ============================================================================
  describe('Section D: Cross-Page Harmony', () => {
    const crossEngine = new CrossPageHarmonyEngine();

    it('D1: doit détecter un en-tête avec couleur de fond divergente entre deux pages', async () => {
      const page1Html = `
        <div>
          <header style="background-color: #0f172a; height: 60px;">Nav Home</header>
        </div>
      `;
      const page2Html = `
        <div>
          <header style="background-color: #ef4444; height: 60px;">Nav Settings Divergente</header>
        </div>
      `;

      const snap1 = await createSnapshot(page1Html, '/d1-home');
      const snap2 = await createSnapshot(page2Html, '/d1-settings');

      const findings = crossEngine.analyzeCrossPageConsistency([snap1, snap2]);
      const navBgFinding = findings.find((f) => f.property === 'header.backgroundColor');

      assert.ok(navBgFinding);
      assert.equal(navBgFinding.category, 'CROSS_PAGE');
      assert.equal(navBgFinding.pageRoute, '/d1-settings');
      assert.equal(navBgFinding.observedValue, '#ef4444');
      assert.equal(navBgFinding.expectedValue, '#0f172a');
    });

    it('D2: doit détecter une divergence significative de hauteur d en-tête entre deux routes', async () => {
      const page1Html = '<div><header style="background-color: #0f172a; height: 60px;">H1</header></div>';
      const page2Html = '<div><header style="background-color: #0f172a; height: 90px;">H2</header></div>';

      const snap1 = await createSnapshot(page1Html, '/d2-home');
      const snap2 = await createSnapshot(page2Html, '/d2-dashboard');

      const findings = crossEngine.analyzeCrossPageConsistency([snap1, snap2]);
      const navHFinding = findings.find((f) => f.property === 'header.height');

      assert.ok(navHFinding);
      assert.equal(navHFinding.observedValue, '90px');
      assert.equal(navHFinding.expectedValue, '60px');
    });

    it('D3: doit détecter l introduction d une couleur isolée inexistante sur la page principale', async () => {
      const page1Html = '<div class="bg-blue-600 text-white">Home</div>';
      const page2Html = '<div class="bg-purple-600 text-white">Subpage with purple</div>';

      const snap1 = await createSnapshot(page1Html, '/d3-home');
      const snap2 = await createSnapshot(page2Html, '/d3-analytics');

      const findings = crossEngine.analyzeCrossPageConsistency([snap1, snap2]);
      const paletteFinding = findings.find((f) => f.property === 'colorPalette');

      assert.ok(paletteFinding);
      assert.equal(paletteFinding.pageRoute, '/d3-analytics');
      assert.equal(paletteFinding.observedValue, '#9333ea');
    });

    it('D4: retourne une liste vide si une seule page est analysée', async () => {
      const snap = await createSnapshot('<div><header>Nav</header></div>', '/d4-single');
      const findings = crossEngine.analyzeCrossPageConsistency([snap]);

      assert.equal(findings.length, 0);
    });
  });

  // ============================================================================
  // SECTION E: Responsive & Accessibility WCAG 2.1 AA
  // ============================================================================
  describe('Section E: Responsive & Accessibility WCAG 2.1 AA', () => {
    const a11yEngine = new ResponsiveA11yHarmonyEngine();

    it('E1: doit calculer avec exactitude le ratio de contraste WCAG (Luminance relative)', () => {
      // White on Black: 21:1
      const maxRatio = computeContrastRatio('#ffffff', '#000000');
      assert.equal(maxRatio, 21);

      // Same color on same color: 1:1
      const minRatio = computeContrastRatio('#ffffff', '#ffffff');
      assert.equal(minRatio, 1);

      // Blue #2563eb on White #ffffff: mathematically ~5.17:1
      const blueOnWhite = computeContrastRatio('#2563eb', '#ffffff');
      assert.ok(blueOnWhite >= 4.5 && blueOnWhite <= 6.0);
    });

    it('E2: doit détecter un contraste insuffisant sous le seuil WCAG AA (< 4.5:1)', async () => {
      // Light gray #94a3b8 on white #ffffff -> approx 2.5:1
      const lowContrastHtml = `
        <div style="background-color: #ffffff;">
          <p style="color: #94a3b8; font-size: 14px;">Texte gris clair difficilement lisible sur blanc</p>
        </div>
      `;
      const snap = await createSnapshot(lowContrastHtml, '/e2-contrast');
      const findings = a11yEngine.analyzeResponsiveAndA11y([snap]);

      const contrastFinding = findings.find((f) => f.category === 'ACCESSIBILITY' && f.property === 'contrastRatio');
      assert.ok(contrastFinding);
      assert.ok(contrastFinding.severity === 'HIGH' || contrastFinding.severity === 'CRITICAL');
    });

    it('E3: doit détecter un élément interactif sans nom accessible', async () => {
      const html = '<button id="icon-btn"><span class="icon"></span></button>';
      const snap = await createSnapshot(html, '/e3-a11y');
      const findings = a11yEngine.analyzeResponsiveAndA11y([snap]);

      const labelFinding = findings.find((f) => f.property === 'accessibleName');
      assert.ok(labelFinding);
      assert.equal(labelFinding.category, 'ACCESSIBILITY');
      assert.equal(labelFinding.severity, 'HIGH');
    });

    it('E4: doit détecter les cibles tactiles trop réduites sur mobile (< 40x40px)', async () => {
      const html = '<button style="width: 28px; height: 28px;" aria-label="Petit bouton">X</button>';
      const snap = await createSnapshot(html, '/e4-mobile', 'MOBILE');
      const findings = a11yEngine.analyzeResponsiveAndA11y([snap]);

      const touchFinding = findings.find((f) => f.category === 'RESPONSIVE' && f.property === 'touchTargetSize');
      assert.ok(touchFinding);
      assert.equal(touchFinding.observedValue, '28x28px');
    });
  });

  // ============================================================================
  // SECTION F: Harmony Score Engine
  // ============================================================================
  describe('Section F: Harmony Score Engine', () => {
    const scoreEngine = new ScoreEngine();

    it('F1: doit attribuer un score parfait de 100/100 en l absence de finding', () => {
      const { overallScore, subScores } = scoreEngine.computeScores([]);

      assert.equal(overallScore, 100);
      assert.equal(subScores.colorHarmony, 100);
      assert.equal(subScores.typographyHarmony, 100);
      assert.equal(subScores.spacingHarmony, 100);
      assert.equal(subScores.componentHarmony, 100);
      assert.equal(subScores.crossPageHarmony, 100);
      assert.equal(subScores.responsiveA11yHarmony, 100);
    });

    it('F2: doit appliquer des déductions calibrées selon la sévérité des anomalies', () => {
      const dummyFindings: DesignHarmonyFinding[] = [
        {
          id: '1',
          category: 'COLOR',
          severity: 'CRITICAL', // -15
          confidence: 1,
          pageRoute: '/',
          property: 'bg',
          observedValue: 'x',
          evidence: [],
          recommendation: '',
          designDrift: false
        },
        {
          id: '2',
          category: 'SPACING',
          severity: 'MEDIUM', // -4
          confidence: 1,
          pageRoute: '/',
          property: 'padding',
          observedValue: 'y',
          evidence: [],
          recommendation: '',
          designDrift: true
        }
      ];

      const { overallScore, subScores } = scoreEngine.computeScores(dummyFindings);

      assert.equal(subScores.colorHarmony, 85);
      assert.equal(subScores.spacingHarmony, 96);
      assert.ok(overallScore < 100 && overallScore >= 90);
    });

    it('F3: doit garantir le clamping strict des sous-scores entre 0 et 100', () => {
      const heavyFindings: DesignHarmonyFinding[] = Array.from({ length: 10 }, (_, i) => ({
        id: `crit-${i}`,
        category: 'COLOR',
        severity: 'CRITICAL',
        confidence: 1,
        pageRoute: '/',
        property: 'color',
        observedValue: 'bad',
        evidence: [],
        recommendation: '',
        designDrift: true
      }));

      const { subScores } = scoreEngine.computeScores(heavyFindings);
      assert.equal(subScores.colorHarmony, 0); // 100 - (10 * 15) = -50 -> clamped to 0
    });

    it('F4: doit être rigoureusement déterministe et reproductible', () => {
      const findings: DesignHarmonyFinding[] = [
        {
          id: '1',
          category: 'COMPONENT',
          severity: 'HIGH',
          confidence: 0.9,
          pageRoute: '/',
          property: 'height',
          observedValue: '50px',
          evidence: [],
          recommendation: 'Fix',
          designDrift: false
        }
      ];

      const res1 = scoreEngine.computeScores(findings);
      const res2 = scoreEngine.computeScores(findings);

      assert.equal(res1.overallScore, res2.overallScore);
      assert.deepEqual(res1.subScores, res2.subScores);
    });
  });

  // ============================================================================
  // SECTION G: Recommendations & Bridges
  // ============================================================================
  describe('Section G: Recommendations & Bridges', () => {
    it('G1: le RecommendationEngine doit synthétiser des actions prioritaires sans muter le code', () => {
      const recEngine = new RecommendationEngine();
      const findings: DesignHarmonyFinding[] = [
        {
          id: '1',
          category: 'ACCESSIBILITY',
          severity: 'HIGH',
          confidence: 1,
          pageRoute: '/',
          property: 'contrastRatio',
          observedValue: '2.1:1',
          evidence: [],
          recommendation: 'Rehausser le contraste',
          designDrift: false
        },
        {
          id: '2',
          category: 'SPACING',
          severity: 'MEDIUM',
          confidence: 1,
          pageRoute: '/dashboard',
          property: 'padding',
          observedValue: '13px',
          evidence: [],
          recommendation: 'Aligner sur 16px',
          designDrift: true
        }
      ];

      const recs = recEngine.generateRecommendations(findings);
      assert.ok(recs.length >= 2);
      assert.equal(recs[0]!.category, 'ACCESSIBILITY');
      assert.equal(recs[1]!.category, 'DESIGN_DRIFT');
    });

    it('G2: le ConversationBridge doit vulgariser le score et les anomalies en français', () => {
      const bridge = new DesignHarmonyConversationBridge();
      const dummyReport = {
        reportId: 'rep-1',
        tenantId,
        projectId,
        analyzedRoutes: ['/', '/dashboard'],
        overallScore: 84,
        subScores: {
          colorHarmony: 90,
          typographyHarmony: 95,
          spacingHarmony: 80,
          shapeHarmony: 85,
          elevationHarmony: 90,
          componentHarmony: 80,
          crossPageHarmony: 75,
          responsiveA11yHarmony: 85
        },
        inferredDesignSystem: {} as unknown as InferredDesignSystem,
        findings: [
          {
            id: 'f1',
            category: 'SPACING',
            severity: 'MEDIUM',
            confidence: 0.9,
            pageRoute: '/dashboard',
            property: 'padding',
            observedValue: '13px',
            evidence: [],
            recommendation: 'Aligner sur 16px',
            designDrift: true
          }
        ],
        driftSummary: { totalDrifts: 1, criticalDrifts: 0 },
        reportHash: 'hash1',
        generatedAt: new Date().toISOString(),
        durationMs: 50
      } as unknown as DesignHarmonyReport;

      const explanation = bridge.explainDesignHarmony(dummyReport);
      assert.ok(explanation.includes('84/100'));
      assert.ok(explanation.includes('Décomposition des Sous-Scores'));
      assert.ok(explanation.includes('Design Drift Détecté'));
    });
  });

  // ============================================================================
  // SECTION H: Service Facade, Multi-Tenancy & Evolution
  // ============================================================================
  describe('Section H: Service Facade, Multi-Tenancy & Evolution', () => {
    let service: DesignHarmonyService;

    beforeEach(() => {
      service = new DesignHarmonyService();
    });

    it('H1: doit exécuter un audit complet end-to-end et produire un DesignHarmonyReport', async () => {
      const snap = await createSnapshot(sampleHarmoniousHtml);
      const report = await service.analyzeDesignHarmony({
        tenantId,
        projectId,
        snapshots: [snap]
      });

      assert.ok(report);
      assert.equal(report.tenantId, tenantId);
      assert.equal(report.projectId, projectId);
      assert.ok(report.overallScore >= 90);
      assert.ok(report.reportHash.startsWith('dhr:'));
    });

    it('H2: doit retourner le rapport depuis le cache lors d un appel identique (Cache Hit)', async () => {
      const snap = await createSnapshot(sampleHarmoniousHtml);
      const req = {
        tenantId,
        projectId,
        snapshots: [snap]
      };

      const rep1 = await service.analyzeDesignHarmony(req);
      const rep2 = await service.analyzeDesignHarmony(req);

      assert.equal(rep1.reportId, rep2.reportId);
      assert.equal(rep1.reportHash, rep2.reportHash);
    });

    it('H3: doit isoler hermétiquement les rapports par locataire (Multi-Tenant)', async () => {
      const snap = await createSnapshot(sampleHarmoniousHtml);
      const report = await service.analyzeDesignHarmony({
        tenantId: 'tenant_alpha',
        projectId: 'proj_alpha',
        snapshots: [snap]
      });

      assert.throws(
        () => service.getReport(report.reportId, 'tenant_intruder'),
        (err: unknown) => err instanceof NotFoundError
      );
    });

    it('H4: doit faire respecter les permissions RBAC (VIEWER accepté, rôle invalide rejeté)', async () => {
      const snap = await createSnapshot(sampleHarmoniousHtml);
      const report = await service.analyzeDesignHarmony(
        {
          tenantId,
          projectId,
          snapshots: [snap]
        },
        'VIEWER'
      );
      assert.ok(report);

      assert.throws(
        // @ts-expect-error test unauthorized role
        () => service.getReport(report.reportId, tenantId, 'INVALID_ROLE'),
        (err: unknown) => err instanceof ForbiddenError
      );
    });

    it('H5: compareReports doit détecter les améliorations, régressions et résolution de drift', () => {
      const prevReport = {
        reportId: 'rep-prev',
        overallScore: 75,
        findings: [
          {
            id: 'f1',
            category: 'SPACING',
            severity: 'HIGH',
            confidence: 0.9,
            pageRoute: '/dashboard',
            property: 'padding',
            observedValue: '13px',
            evidence: [],
            recommendation: '',
            designDrift: true
          }
        ]
      } as unknown as DesignHarmonyReport;

      const currReport = {
        reportId: 'rep-curr',
        overallScore: 92,
        findings: []
      } as unknown as DesignHarmonyReport;

      const comp = service.compareReports(prevReport, currReport);
      assert.equal(comp.scoreDelta, 17);
      assert.ok(comp.improvements[0]!.includes('+17 points'));
      assert.equal(comp.resolvedDrifts.length, 1);
      assert.ok(comp.resolvedDrifts[0]!.includes('padding'));
    });
  });
});
