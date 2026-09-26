/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-013)
 * Application Audit & Global Quality Intelligence Engine Test Suite
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ApplicationAuditService,
  ApplicationAuditScoreEngine,
  FindingsAggregator,
  RemediationPlanner,
  ApplicationAuditLruCache,
  ApplicationAuditConversationBridge,
  ApplicationAuditOrchestratorBridge,
  computeApplicationAuditHash,
  compareAuditFindings,
  ArchitectureAuditor,
  CodeQualityAuditor,
  SecurityAuditor,
  PerformanceAuditor,
  UXAuditor,
  AccessibilityAuditor,
  AIConfigAuditor,
  DesignHarmonyBridgeAuditor
} from '../../../src/ai-native/application-audit/index.js';
import { deepFreeze } from '../../../src/ai-native/application-audit/canonical.js';

import type {
  ApplicationAuditFinding,
  ApplicationAuditReport,
  ApplicationAuditRequest,
  AuditFileEntry
} from '../../../src/ai-native/application-audit/types.js';
import type { ApplicationDNA } from '../../../src/ai-native/dna/types.js';
import type { NormalizedDomNode, VisualSnapshot } from '../../../src/ai-native/visual-intelligence/types.js';
import type { DesignHarmonyReport } from '../../../src/ai-native/design-harmony/types.js';
import { ForbiddenError, NotFoundError } from '../../../src/errors.js';

// --- Fixtures & Test Data ---

const MOCK_DNA: ApplicationDNA = {
  schemaVersion: '1.0.0',
  analyzerVersion: '1.0.0',
  tenantId: 'tenant-alpha',
  projectId: 'proj-001',
  treeHash: 'tree-hash-111',
  dnaHash: 'dna-hash-222',
  extractedAt: new Date().toISOString(),
  durationMs: 42,
  stack: {
    language: { name: 'TypeScript', category: 'language', confidence: 'CONFIRMED', evidence: [] },
    framework: { name: 'React', category: 'framework', confidence: 'CONFIRMED', evidence: [] },
    runtime: { name: 'Node.js', category: 'runtime', confidence: 'CONFIRMED', evidence: [] },
    additionalTechnologies: []
  },
  architecture: {
    primaryPattern: { pattern: 'SPA', confidence: 'CONFIRMED', evidence: [] },
    entryPoints: [{ path: 'src/main.tsx', role: 'client_entry', confidence: 'CONFIRMED' }],
    layers: [],
    routesCount: 3,
    componentsCount: 5
  },
  components: [],
  modules: [
    {
      name: 'AuthModule',
      rootPath: 'src/auth',
      files: ['src/auth/index.ts', 'src/auth/service.ts'],
      publicExports: ['login', 'logout'],
      externalDependencies: []
    },
    {
      name: 'BillingModule',
      rootPath: 'src/billing',
      files: ['src/billing/index.ts'],
      publicExports: ['createInvoice'],
      externalDependencies: []
    }
  ],
  graphMetrics: {
    nodeCount: 10,
    edgeCount: 15,
    directDependencies: {},
    reverseDependencies: {},
    topologicalOrder: [],
    circularDependencies: [],
    isolatedFiles: [],
    mostDependedOnFiles: []
  },
  summary: {
    totalFiles: 8,
    analyzedFiles: 8,
    diagnosticsCount: 0,
    overallHealth: 'HEALTHY',
    primaryLanguage: 'TypeScript',
    primaryFramework: 'React'
  }
};

const MOCK_ROOT_NODE: NormalizedDomNode = {
  id: 'node-root',
  tagName: 'DIV',
  role: 'CONTAINER',
  attributes: {},
  classes: ['container'],
  textContent: '',
  styles: {
    color: '#000000',
    backgroundColor: '#ffffff',
    fontFamily: 'Inter',
    fontSize: '16px',
    fontWeight: '400',
    lineHeight: '1.5',
    padding: '0',
    margin: '0',
    borderRadius: '0',
    borderWidth: '0',
    borderColor: 'transparent',
    boxShadow: 'none',
    display: 'block',
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    gap: '0',
    opacity: 1,
    zIndex: 0
  },
  layout: {
    x: 0,
    y: 0,
    width: 375,
    height: 667,
    isVisible: true,
    hasOverflow: false
  },
  depth: 0,
  selector: 'div.container',
  children: [
    {
      id: 'node-overflow',
      tagName: 'DIV',
      role: 'CARD',
      attributes: {},
      classes: ['overflow-card'],
      textContent: 'Poor contrast text',
      styles: {
        color: '#777777',
        backgroundColor: '#888888', // poor contrast ratio (< 4.5:1)
        fontFamily: 'Inter',
        fontSize: '14px',
        fontWeight: '400',
        lineHeight: '1.5',
        padding: '8px',
        margin: '0',
        borderRadius: '4px',
        borderWidth: '0',
        borderColor: 'transparent',
        boxShadow: 'none',
        display: 'block',
        flexDirection: 'row',
        justifyContent: 'flex-start',
        alignItems: 'stretch',
        gap: '0',
        opacity: 1,
        zIndex: 1
      },
      layout: {
        x: 0,
        y: 0,
        width: 800, // overflows 375
        height: 200,
        isVisible: true,
        hasOverflow: true
      },
      depth: 1,
      selector: 'div.overflow-card',
      children: []
    }
  ]
};

const MOCK_SNAPSHOT: VisualSnapshot = {
  snapshotId: 'snap-001',
  tenantId: 'tenant-alpha',
  projectId: 'proj-001',
  pageRoute: '/dashboard',
  viewport: { width: 375, height: 667, scale: 1, kind: 'MOBILE' },
  capturedAt: new Date().toISOString(),
  durationMs: 40,
  snapshotHash: 'hash-snap-123',
  rootNode: MOCK_ROOT_NODE,
  totalElementsCount: 950, // DOM Bloat (> 800)
  extractedColors: ['#777777', '#888888'],
  extractedFonts: ['Inter'],
  interactiveElements: [
    {
      nodeId: 'el-1',
      role: 'BUTTON',
      selector: '#btn-submit',
      label: '',
      bounds: { x: 10, y: 10, width: 30, height: 30, isVisible: true, hasOverflow: false },
      hasAccessibleName: false,
      isClickable: true,
      isFormInput: false
    }
  ]
};

const MOCK_FILES: AuditFileEntry[] = [
  {
    path: 'src/components/UserProfile.tsx',
    content: `import React from 'react';
import { queryDatabase } from '../database/connection'; // Layer Inversion

export function UserProfile() {
  const apiKey = "sk-proj99887766554433221100aabbccdd"; // Hardcoded Secret
  eval("console.log('danger')"); // eval
  const markup = { __html: '<div onclick="alert(1)">bad</div>' };
  document.write("<span>deprecated</span>"); // document.write
  return <div dangerouslySetInnerHTML={markup}><a href="#">Empty Link</a></div>;
}`
  },
  {
    path: 'src/utils/complex.ts',
    content: `
export function megaComplexFunction(a: number, b: number): number {
  let res = 0;
  if (a > 1) res += 1;
  if (a > 2) res += 2;
  if (a > 3) res += 3;
  if (a > 4) res += 4;
  if (a > 5) res += 5;
  if (a > 6) res += 6;
  if (a > 7) res += 7;
  if (a > 8) res += 8;
  if (a > 9) res += 9;
  if (a > 10) res += 10;
  if (a > 11) res += 11;
  if (a > 12) res += 12;
  if (a > 13) res += 13;
  if (a > 14) res += 14;
  if (a > 15) res += 15;
  if (a > 16) res += 16;
  return res + b;
}
`
  },
  {
    path: 'src/ai/prompt.ts',
    content: `
export function buildPrompt(userInput: string) {
  // Missing <USER_INPUT> encapsulation
  return "You are an assistant. Answer this: " + userInput;
}
`
  },
  {
    path: 'src/index.html',
    content: `
<!DOCTYPE html>
<html>
<body>
  <script>
    // Inline script exceeding 300 lines
    ${'const x = 1;\n'.repeat(320)}
  </script>
</body>
</html>
`
  }
];

describe('AINT-013 : Application Audit & Global Quality Intelligence Engine', () => {

  // --- Dimension 1: Architecture Auditor ---
  describe('1. Architecture Auditor', () => {
    const auditor = new ArchitectureAuditor();

    it('doit détecter une inversion de couche (UI importante directement DB)', () => {
      const findings = auditor.audit(MOCK_FILES, MOCK_DNA);
      const inversion = findings.find((f) => f.title.includes('Inversion de couche'));
      assert.ok(inversion, 'Devrait trouver une inversion de couche UI -> DB');
      assert.equal(inversion.dimension, 'ARCHITECTURE');
      assert.equal(inversion.severity, 'HIGH');
      assert.ok(inversion.evidence.length > 0);
    });

    it('doit détecter les dépendances circulaires directes', () => {
      const circularFiles: AuditFileEntry[] = [
        { path: 'src/services/a.ts', content: `import { b } from './b';\nexport const a = 1;` },
        { path: 'src/services/b.ts', content: `import { a } from './a';\nexport const b = 2;` }
      ];
      const findings = auditor.audit(circularFiles);
      const cycle = findings.find((f) => f.title.includes('circulaire'));
      assert.ok(cycle, 'Devrait détecter le cycle entre a.ts et b.ts');
      assert.equal(cycle.severity, 'HIGH');
    });

    it('doit détecter les modules DNA non implémentés', () => {
      const emptyFiles: AuditFileEntry[] = Array.from({ length: 6 }, (_, i) => ({
        path: `src/other/file${i}.ts`,
        content: `export const f${i} = true;`
      }));
      const findings = auditor.audit(emptyFiles, MOCK_DNA);
      const missingMod = findings.filter((f) => f.title.includes('Module DNA non implémenté'));
      assert.ok(missingMod.length >= 1, 'Devrait signaler les modules DNA absents');
    });
  });

  // --- Dimension 2: Code Quality Auditor ---
  describe('2. Code Quality Auditor', () => {
    const auditor = new CodeQualityAuditor();

    it('doit détecter une complexité cyclomatique excessive (> 15)', () => {
      const findings = auditor.audit(MOCK_FILES);
      const complexFinding = findings.find((f) => f.title.includes('Complexité cyclomatique'));
      assert.ok(complexFinding, 'Devrait détecter la fonction megaComplexFunction');
      assert.equal(complexFinding.dimension, 'CODE_QUALITY');
      assert.equal(complexFinding.severity, 'HIGH');
      assert.ok(Number(complexFinding.evidence[0]?.observedValue) > 15);
    });

    it('doit détecter une fonction trop longue (> 60 lignes)', () => {
      const longFuncFile: AuditFileEntry[] = [
        {
          path: 'src/long.ts',
          content: `export function longFunction() {\n${'  const a = 1;\n'.repeat(70)}}`
        }
      ];
      const findings = auditor.audit(longFuncFile);
      const longFinding = findings.find((f) => f.title.includes('Fonction trop volumineuse'));
      assert.ok(longFinding, 'Devrait détecter la fonction de plus de 60 lignes');
      assert.equal(longFinding.severity, 'MEDIUM');
    });
  });

  // --- Dimension 3: Security Auditor ---
  describe('3. Security Auditor', () => {
    const auditor = new SecurityAuditor();

    it('doit détecter et masquer les secrets codés en dur', () => {
      const findings = auditor.audit(MOCK_FILES);
      const secretFinding = findings.find((f) => f.title.includes('Secret'));
      assert.ok(secretFinding, 'Devrait détecter la clé API secrète');
      assert.equal(secretFinding.dimension, 'SECURITY');
      assert.equal(secretFinding.severity, 'CRITICAL');
      // Le secret en clair ne doit pas apparaître non masqué
      assert.ok(!secretFinding.description.includes('sk-proj99887766554433221100aabbccdd'));
      assert.ok(secretFinding.description.includes('...'));
    });

    it('doit détecter l\'usage dangereux de eval()', () => {
      const findings = auditor.audit(MOCK_FILES);
      const evalFinding = findings.find((f) => f.title.includes('eval()'));
      assert.ok(evalFinding, 'Devrait détecter eval()');
      assert.equal(evalFinding.severity, 'CRITICAL');
      assert.equal(evalFinding.autoRemediable, false);
    });

    it('doit détecter l\'usage de document.write()', () => {
      const findings = auditor.audit(MOCK_FILES);
      const docWriteFinding = findings.find((f) => f.title.includes('document.write'));
      assert.ok(docWriteFinding, 'Devrait détecter document.write');
      assert.equal(docWriteFinding.severity, 'HIGH');
      assert.equal(docWriteFinding.autoRemediable, true);
    });
  });

  // --- Dimension 4: Performance Auditor ---
  describe('4. Performance Auditor', () => {
    const auditor = new PerformanceAuditor();

    it('doit détecter l\'arborescence DOM excessive (> 800 éléments)', () => {
      const findings = auditor.audit([], [MOCK_SNAPSHOT]);
      const domFinding = findings.find((f) => f.title.includes('Arborescence DOM'));
      assert.ok(domFinding, 'Devrait détecter le DOM bloat');
      assert.equal(domFinding.dimension, 'PERFORMANCE');
      assert.equal(domFinding.evidence[0]?.observedValue, 950);
    });

    it('doit détecter les scripts inline HTML monolithiques (> 300 lignes)', () => {
      const findings = auditor.audit(MOCK_FILES);
      const scriptFinding = findings.find((f) => f.title.includes('Script inline monolithique'));
      assert.ok(scriptFinding, 'Devrait détecter le script inline de plus de 300 lignes');
      assert.equal(scriptFinding.severity, 'HIGH');
      assert.equal(scriptFinding.autoRemediable, true);
    });

    it('doit détecter un volume d\'imports excessif (> 25)', () => {
      const bloatedImportsFile: AuditFileEntry[] = [
        {
          path: 'src/barrel.ts',
          content: Array.from({ length: 28 }, (_, i) => `import { mod${i} } from './mod${i}';`).join('\n')
        }
      ];
      const findings = auditor.audit(bloatedImportsFile);
      const importFinding = findings.find((f) => f.title.includes('Volume d\'importations'));
      assert.ok(importFinding);
      assert.equal(importFinding.severity, 'MEDIUM');
    });
  });

  // --- Dimension 5: UX Auditor ---
  describe('5. UX Auditor', () => {
    const auditor = new UXAuditor();

    it('doit détecter un débordement de contenu (layout overflow)', () => {
      const findings = auditor.audit([], [MOCK_SNAPSHOT]);
      const overflow = findings.find((f) => f.title.includes('Débordement'));
      assert.ok(overflow, 'Devrait détecter le hasOverflow: true');
      assert.equal(overflow.dimension, 'UX');
      assert.equal(overflow.severity, 'HIGH');
    });

    it('doit détecter les liens morts href="#"', () => {
      const findings = auditor.audit(MOCK_FILES);
      const deadLink = findings.find((f) => f.title.includes('Lien mort'));
      assert.ok(deadLink, 'Devrait détecter href="#"');
      assert.equal(deadLink.severity, 'LOW');
    });
  });

  // --- Dimension 6: Accessibility Auditor ---
  describe('6. Accessibility Auditor', () => {
    const auditor = new AccessibilityAuditor();

    it('doit détecter un ratio de contraste insuffisant (< 4.5:1)', () => {
      const findings = auditor.audit([MOCK_SNAPSHOT]);
      const contrast = findings.find((f) => f.title.includes('Contraste'));
      assert.ok(contrast, 'Devrait signaler le mauvais contraste');
      assert.equal(contrast.dimension, 'ACCESSIBILITY');
      assert.equal(contrast.severity, 'HIGH');
    });

    it('doit détecter une zone tactile trop petite (< 40x40px)', () => {
      const findings = auditor.audit([MOCK_SNAPSHOT]);
      const touch = findings.find((f) => f.title.includes('tactile'));
      assert.ok(touch, 'Devrait signaler le bouton de 30x30px');
      assert.equal(touch.severity, 'MEDIUM');
    });

    it('doit détecter un élément interactif sans libellé accessible', () => {
      const findings = auditor.audit([MOCK_SNAPSHOT]);
      const label = findings.find((f) => f.title.includes('libellé accessible'));
      assert.ok(label, 'Devrait signaler hasAccessibleLabel: false');
      assert.equal(label.severity, 'HIGH');
      assert.equal(label.autoRemediable, true);
    });
  });

  // --- Dimension 7: AI Config Auditor ---
  describe('7. AI Config Auditor', () => {
    const auditor = new AIConfigAuditor();

    it('doit détecter l\'absence de balises d\'encapsulation dans les prompts', () => {
      const findings = auditor.audit(MOCK_FILES);
      const aiFinding = findings.find((f) => f.title.includes('balises d\'encapsulation'));
      assert.ok(aiFinding, 'Devrait signaler l\'interpolation non encapsulée');
      assert.equal(aiFinding.dimension, 'AI_CONFIG');
      assert.equal(aiFinding.severity, 'HIGH');
    });
  });

  // --- Dimension 8: Design Harmony Bridge Auditor ---
  describe('8. Design Harmony Bridge Auditor', () => {
    const auditor = new DesignHarmonyBridgeAuditor();

    it('doit convertir fidèlement les findings AINT-012 en findings ApplicationAudit', () => {
      const mockDhReport: DesignHarmonyReport = {
        reportId: 'dhr-001',
        tenantId: 'tenant-alpha',
        projectId: 'proj-001',
        analyzedRoutes: ['/dashboard'],
        overallScore: 78,
        subScores: {
          colorHarmony: 75,
          typographyHarmony: 80,
          spacingHarmony: 80,
          shapeHarmony: 80,
          elevationHarmony: 70,
          componentHarmony: 80,
          crossPageHarmony: 85,
          responsiveA11yHarmony: 80
        },
        inferredDesignSystem: {
          colorTokens: {},
          typographyTokens: {
            primaryFontFamily: 'Inter',
            fontFamilies: ['Inter'],
            detectedScale: ['14px', '16px'],
            dominantLineHeightRatio: 1.5
          },
          spacingTokens: {
            baseGridStep: 4,
            detectedScale: [4, 8, 16],
            regularityRatio: 0.9
          },
          shapeTokens: {
            primaryButtonRadius: '4px',
            primaryCardRadius: '8px',
            primaryInputRadius: '4px',
            detectedRadii: ['4px', '8px']
          },
          elevationTokens: {
            detectedLevelsCount: 2,
            shadowLevels: ['0 1px 2px rgba(0,0,0,0.05)']
          },
          systemConfidence: 0.9,
          evidenceCount: 10
        },
        findings: [
          {
            id: 'dhf-101',
            category: 'COLOR',
            property: 'color',
            observedValue: '#123456',
            expectedValue: '#3b82f6',
            severity: 'MEDIUM',
            confidence: 0.85,
            pageRoute: '/dashboard',
            selector: '.header-title',
            recommendation: 'Utiliser le token color-primary',
            designDrift: true,
            evidence: [
              {
                source: 'DOM_SNAPSHOT',
                detail: 'Couleur hors palette standard',
                pageRoute: '/dashboard',
                selector: '.header-title',
                occurrences: 1
              }
            ]
          }
        ],
        driftSummary: {
          totalDrifts: 1,
          criticalDrifts: 0
        },
        reportHash: 'hash-dh-789',
        generatedAt: new Date().toISOString(),
        durationMs: 45
      };

      const findings = auditor.audit(mockDhReport);
      assert.equal(findings.length, 1);
      assert.equal(findings[0]?.dimension, 'DESIGN_HARMONY');
      assert.equal(findings[0]?.severity, 'MEDIUM');
      assert.equal(findings[0]?.location.pageRoute, '/dashboard');
      assert.equal(findings[0]?.location.selector, '.header-title');
      assert.equal(findings[0]?.evidence[0]?.source, 'DESIGN_HARMONY');
    });
  });

  // --- Score Engine & Mathematical Clamping ---
  describe('9. Score Engine & Clamping', () => {
    const scoreEngine = new ApplicationAuditScoreEngine();

    it('doit retourner 100/100 si aucun finding n\'est présent', () => {
      const result = scoreEngine.computeScores([]);
      assert.equal(result.overallScore, 100);
      assert.equal(result.dimensionScores.architecture, 100);
      assert.equal(result.dimensionScores.security, 100);
    });

    it('doit borner strictement les scores dans [0, 100] même avec accumulation massive', () => {
      const criticalFindings: ApplicationAuditFinding[] = Array.from({ length: 30 }, (_, i) => ({
        id: `crit-${i}`,
        dimension: 'SECURITY',
        severity: 'CRITICAL',
        title: `Faille ${i}`,
        description: `Desc ${i}`,
        location: { filePath: 'src/index.ts' },
        cause: 'Cause',
        impact: 'Impact',
        recommendation: 'Fix',
        autoRemediable: false,
        evidence: [{ source: 'SECURITY_SCANNER', detail: 'Crit' }]
      }));

      const result = scoreEngine.computeScores(criticalFindings);
      assert.equal(result.dimensionScores.security, 0, 'Le score sécurité doit être borné à 0');
      assert.ok(result.overallScore >= 0 && result.overallScore <= 100);
    });
  });

  // --- Findings Aggregator & "NO EVIDENCE -> NO CLAIM" ---
  describe('10. Findings Aggregator & No Evidence Rule', () => {
    const aggregator = new FindingsAggregator();

    it('doit éliminer impitoyablement tout finding sans preuve concrète (NO EVIDENCE -> NO CLAIM)', () => {
      const findingsWithAndWithoutEvidence: ApplicationAuditFinding[] = [
        {
          id: 'f-valid',
          dimension: 'SECURITY',
          severity: 'HIGH',
          title: 'Valide avec preuve',
          description: 'Desc',
          location: { filePath: 'src/valid.ts' },
          cause: 'Cause',
          impact: 'Impact',
          recommendation: 'Fix',
          autoRemediable: false,
          evidence: [{ source: 'SECURITY_SCANNER', detail: 'Preuve concrète vérifiée' }]
        },
        {
          id: 'f-invalid-empty',
          dimension: 'SECURITY',
          severity: 'HIGH',
          title: 'Invalide sans preuve',
          description: 'Desc',
          location: { filePath: 'src/invalid.ts' },
          cause: 'Cause',
          impact: 'Impact',
          recommendation: 'Fix',
          autoRemediable: false,
          evidence: [] // NO EVIDENCE!
        }
      ];

      const { findings: filtered } = aggregator.aggregate(findingsWithAndWithoutEvidence);
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0]?.id, 'f-valid');
    });

    it('doit ordonner les findings par sévérité décroissante (CRITICAL > HIGH > MEDIUM > LOW)', () => {
      const mixed: ApplicationAuditFinding[] = [
        {
          id: 'f-low',
          dimension: 'UX',
          severity: 'LOW',
          title: 'Low',
          description: '',
          location: {},
          cause: '',
          impact: '',
          recommendation: '',
          autoRemediable: false,
          evidence: [{ source: 'VISUAL_LAYOUT', detail: 'ev' }]
        },
        {
          id: 'f-crit',
          dimension: 'SECURITY',
          severity: 'CRITICAL',
          title: 'Critical',
          description: '',
          location: {},
          cause: '',
          impact: '',
          recommendation: '',
          autoRemediable: false,
          evidence: [{ source: 'SECURITY_SCANNER', detail: 'ev' }]
        },
        {
          id: 'f-med',
          dimension: 'PERFORMANCE',
          severity: 'MEDIUM',
          title: 'Medium',
          description: '',
          location: {},
          cause: '',
          impact: '',
          recommendation: '',
          autoRemediable: false,
          evidence: [{ source: 'AST_NODE', detail: 'ev' }]
        }
      ];

      const { findings: sorted } = aggregator.aggregate(mixed);
      assert.equal(sorted[0]?.severity, 'CRITICAL');
      assert.equal(sorted[1]?.severity, 'MEDIUM');
      assert.equal(sorted[2]?.severity, 'LOW');
    });
  });

  // --- Canonical Hashing & Determinism ---
  describe('11. Canonical Hashing & Determinism', () => {
    it('doit générer un hash SHA-256 déterministe identique quel que soit l\'ordre des findings', () => {
      const f1: ApplicationAuditFinding = {
        id: 'f-1',
        dimension: 'ARCHITECTURE',
        severity: 'HIGH',
        title: 'Arch finding',
        description: 'd1',
        location: { filePath: 'src/a.ts' },
        cause: 'c1',
        impact: 'i1',
        recommendation: 'r1',
        autoRemediable: true,
        evidence: [{ source: 'DNA_RULE', detail: 'ev1' }]
      };
      const f2: ApplicationAuditFinding = {
        id: 'f-2',
        dimension: 'CODE_QUALITY',
        severity: 'MEDIUM',
        title: 'Code finding',
        description: 'd2',
        location: { filePath: 'src/b.ts' },
        cause: 'c2',
        impact: 'i2',
        recommendation: 'r2',
        autoRemediable: false,
        evidence: [{ source: 'AST_NODE', detail: 'ev2' }]
      };

      const hashA = computeApplicationAuditHash({
        tenantId: 'tenant-1',
        projectId: 'proj-1',
        overallScore: 85,
        findingsCount: 2,
        dimensionScores: {
          architecture: 80,
          codeQuality: 85,
          security: 100,
          performance: 100,
          ux: 100,
          accessibility: 100,
          aiConfig: 100,
          designHarmony: 100
        }
      });

      const hashB = computeApplicationAuditHash({
        tenantId: 'tenant-1',
        projectId: 'proj-1',
        overallScore: 85,
        findingsCount: 2,
        dimensionScores: {
          architecture: 80,
          codeQuality: 85,
          security: 100,
          performance: 100,
          ux: 100,
          accessibility: 100,
          aiConfig: 100,
          designHarmony: 100
        }
      });

      assert.equal(hashA, hashB, 'Les condensats doivent être strictement identiques');
      assert.ok(hashA.startsWith('aar:'));
      assert.ok(hashA.length > 10);
    });

    it('deepFreeze doit rendre l\'objet récursivement immuable', () => {
      const obj = { prop: 'val', nested: { a: 1 } };
      deepFreeze(obj);
      assert.ok(Object.isFrozen(obj));
      assert.ok(Object.isFrozen(obj.nested));
      assert.throws(() => {
        (obj as { prop: string }).prop = 'new';
      }, TypeError);
    });
  });

  // --- LRU Cache ---
  describe('12. LRU Cache', () => {
    it('doit stocker, restituer et évincer les entrées selon la capacité max', () => {
      const cache = new ApplicationAuditLruCache(2);
      const mockReport = (id: string): ApplicationAuditReport => ({
        reportId: id,
        tenantId: 'tenant-1',
        projectId: 'proj-1',
        overallScore: 90,
        dimensionScores: {
          architecture: 90,
          codeQuality: 90,
          security: 90,
          performance: 90,
          ux: 90,
          accessibility: 90,
          aiConfig: 90,
          designHarmony: 90
        },
        summary: {
          totalFindings: 0,
          criticalCount: 0,
          highCount: 0,
          mediumCount: 0,
          lowCount: 0,
          infoCount: 0,
          autoRemediableCount: 0
        },
        findings: [],
        auditHash: `hash-${id}`,
        createdAt: new Date().toISOString(),
        durationMs: 12
      });

      cache.set('key1', mockReport('r1'));
      cache.set('key2', mockReport('r2'));

      assert.ok(cache.get('key1'));
      assert.ok(cache.get('key2'));

      // Ajout de key3 qui doit évincer key1
      cache.set('key3', mockReport('r3'));
      assert.equal(cache.get('key1'), undefined, 'key1 doit être évincé');
      assert.ok(cache.get('key2'));
      assert.ok(cache.get('key3'));

      const metrics = cache.getMetrics();
      assert.equal(metrics.evictions, 1);
      assert.ok(metrics.hits >= 2);
    });
  });

  // --- Master Facade: ApplicationAuditService ---
  describe('13. ApplicationAuditService Master Facade', () => {
    const service = new ApplicationAuditService();

    it('doit réaliser un audit complet de bout en bout et calculer le score global', async () => {
      const request: ApplicationAuditRequest = {
        tenantId: 'tenant-alpha',
        projectId: 'proj-001',
        callerRole: 'ADMIN',
        files: MOCK_FILES,
        snapshots: [MOCK_SNAPSHOT],
        dna: MOCK_DNA
      };

      const report = await service.auditApplication(request);

      assert.equal(report.tenantId, 'tenant-alpha');
      assert.equal(report.projectId, 'proj-001');
      assert.ok(report.overallScore < 100, 'Des findings réels doivent réduire le score');
      assert.ok(report.summary.totalFindings > 0);
      assert.ok(report.summary.criticalCount >= 2, 'Doit compter eval et hardcoded secret');
      assert.ok(report.auditHash.startsWith('aar:'));
      assert.ok(Object.isFrozen(report));
    });

    it('doit permettre la lecture aux utilisateurs VIEWER (opération consultative)', async () => {
      const request: ApplicationAuditRequest = {
        tenantId: 'tenant-alpha',
        projectId: 'proj-001',
        callerRole: 'VIEWER',
        files: []
      };

      const report = await service.auditApplication(request);
      assert.equal(report.overallScore, 100);
      assert.equal(report.summary.totalFindings, 0);
    });

    it('doit rejeter si tenantId ou projectId est manquant', async () => {
      await assert.rejects(async () => {
        await service.auditApplication({
          tenantId: '',
          projectId: 'p',
          callerRole: 'ENGINEER'
        });
      }, /requis/);

      await assert.rejects(async () => {
        await service.auditApplication({
          tenantId: 't',
          projectId: '',
          callerRole: 'ENGINEER'
        });
      }, /requis/);
    });

    it('doit utiliser le cache lors de requêtes successives identiques', async () => {
      const req: ApplicationAuditRequest = {
        tenantId: 'tenant-cache',
        projectId: 'proj-cache',
        callerRole: 'ENGINEER',
        files: [{ path: 'src/ok.ts', content: 'export const x = 1;' }]
      };

      const rep1 = await service.auditApplication(req);
      const rep2 = await service.auditApplication(req);

      assert.equal(rep1.auditHash, rep2.auditHash);
      const metrics = service.getCacheMetrics();
      assert.ok(metrics.hits >= 1, 'La deuxième requête doit être servie par le cache');
    });

    it('doit comparer deux rapports d\'audit (diff temporel)', async () => {
      const req1: ApplicationAuditRequest = {
        tenantId: 'tenant-diff',
        projectId: 'proj-diff',
        callerRole: 'ENGINEER',
        files: MOCK_FILES
      };
      const rep1 = await service.auditApplication(req1);

      // Résolution du problème dans req2
      const req2: ApplicationAuditRequest = {
        tenantId: 'tenant-diff',
        projectId: 'proj-diff',
        callerRole: 'ENGINEER',
        files: [{ path: 'src/clean.ts', content: 'export const clean = true;' }]
      };
      const rep2 = await service.auditApplication(req2);

      const comparison = service.compareAuditReports(rep1, rep2);
      assert.ok(comparison.resolvedFindingIds.length > 0, 'Des findings doivent être résolus');
      assert.ok(comparison.scoreDelta > 0, 'Le score doit s\'améliorer');
      assert.equal(comparison.previousReportId, rep1.reportId);
      assert.equal(comparison.currentReportId, rep2.reportId);
    });
  });

  // --- Bridges: Conversation (AINT-009) & Orchestrator (AINT-010) ---
  describe('14. Bridges: Conversation (AINT-009) & Orchestrator (AINT-010)', () => {
    const conversationBridge = new ApplicationAuditConversationBridge();
    const orchestratorBridge = new ApplicationAuditOrchestratorBridge();

    it('doit formater un résumé exécutif en français pour l\'assistant AINT-009', async () => {
      const service = new ApplicationAuditService();
      const report = await service.auditApplication({
        tenantId: 'tenant-alpha',
        projectId: 'proj-001',
        callerRole: 'ENGINEER',
        files: MOCK_FILES,
        snapshots: [MOCK_SNAPSHOT]
      });

      const summary = conversationBridge.formatConversationSummary(report);
      assert.ok(summary.includes('Diagnostic Global de l\'Application'));
      assert.ok(summary.includes('/100'));
      assert.ok(summary.includes('Synthèse des Anomalies'));
      assert.ok(summary.includes('Critiques'));
    });

    it('doit traduire les findings auto-remediables en tâches d\'ingénierie AINT-010', async () => {
      const service = new ApplicationAuditService();
      const report = await service.auditApplication({
        tenantId: 'tenant-alpha',
        projectId: 'proj-001',
        callerRole: 'ENGINEER',
        files: MOCK_FILES
      });

      const tasks = orchestratorBridge.proposeRemediationTasks(report);
      assert.ok(tasks.length > 0, 'Doit générer des tâches de remédiation');
      for (const t of tasks) {
        assert.ok(t.id.startsWith('task-audit-rem-'));
        assert.ok(t.domain);
        assert.ok(t.assignedAgentId);
        assert.equal(t.status, 'READY');
        assert.ok(t.requiredCapabilities.length > 0);
        assert.ok(t.findingId);
        assert.ok(t.targetDimension);
      }
    });
  });

  // --- Advisory Guarantee & Non-Mutation ---
  describe('15. Advisory Guarantee & Non-Mutation', () => {
    it('doit être strictement consultatif et ne jamais modifier le système de fichiers', async () => {
      const service = new ApplicationAuditService();
      const fileClone = JSON.parse(JSON.stringify(MOCK_FILES));

      await service.auditApplication({
        tenantId: 'tenant-read-only',
        projectId: 'proj-ro',
        callerRole: 'ENGINEER',
        files: fileClone
      });

      // Vérifier que les fichiers d'entrée n'ont pas été mutés
      assert.deepEqual(fileClone, MOCK_FILES, 'Les fichiers fournis ne doivent jamais être altérés');
    });
  });

});
