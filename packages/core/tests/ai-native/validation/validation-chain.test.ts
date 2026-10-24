/**
 * VibeCode Core — Validation
 * CDC V7.0 §25 LOT 2 — ValidationChain : chaîne unique ordonnée. Preuves.
 *
 *  - étapes ORDONNÉES (files → syntax → a11y → design → tests), verdict unique ;
 *  - le parse testé est le VRAI analyseur TypeScript (AST_SYNTAX_FATAL réel) ;
 *  - une étape non applicable est SKIP (jamais PASS fabriqué) ;
 *  - une étape qui plante est FAIL (rien n'est validé sans vérification) ;
 *  - determinisme du reportHash (contenus + statuts ; horodatage exclu).
 *
 * Déterministe : aucun réseau, aucune horloge réelle.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DESIGN_SCORE_MIN,
  ValidationChain,
  VALIDATION_CHAIN_VERSION,
  type ApplicationAuditFinding,
  type DesignHarmonyReport,
  type ValidationChainDeps,
  type VisualSnapshot
} from '../../../src/index.js';
import { TypeScriptAnalyzer } from '../../../src/ai-native/understanding/analyzers/typescript.js';
import { JsonAnalyzer } from '../../../src/ai-native/understanding/analyzers/json.js';

const CLEAN_HTML = '<!DOCTYPE html>\n<html lang="fr"><head><title>Valid</title></head><body><h1>Titre</h1></body></html>';
const CLEAN_TS = 'export function sum(a: number, b: number): number { return a + b; }\n';
const BROKEN_TS = 'export function broken( { return ; }\n';

function fakeSnapshot(): VisualSnapshot {
  return {
    pageRoute: '/',
    viewport: { kind: 'DESKTOP' },
    interactiveElements: [],
    extractedColors: ['#111827', '#ffffff'],
    rootNode: {
      id: 'root',
      tagName: 'html',
      selector: 'html',
      attributes: {},
      textContent: 'Titre',
      styles: { color: '#111827', backgroundColor: '#ffffff', fontSize: '16px', fontWeight: '400' },
      children: []
    }
  } as unknown as VisualSnapshot;
}

function fakeHarmony(score: number): DesignHarmonyReport {
  return {
    reportId: 'dhr-test',
    overallScore: score,
    driftSummary: { totalDrifts: 1, criticalDrifts: 0 },
    findings: []
  } as unknown as DesignHarmonyReport;
}

function fakeFinding(severity: ApplicationAuditFinding['severity'], title: string): ApplicationAuditFinding {
  return { id: `aaf-${title}`, severity, title, description: title } as unknown as ApplicationAuditFinding;
}

function buildChain(files: Record<string, string>, overrides?: Partial<ValidationChainDeps>): ValidationChain {
  const typeScriptAnalyzer = new TypeScriptAnalyzer();
  const jsonAnalyzer = new JsonAnalyzer();
  const deps: ValidationChainDeps = {
    fileStore: { getAllProjectFiles: () => files },
    codeIntelService: {
      analyzeSource: (content, filePath, options) => {
        const analyzer = filePath.toLowerCase().endsWith('.json') ? jsonAnalyzer : typeScriptAnalyzer;
        return analyzer.analyze(content, filePath, {
          tenantId: options?.tenantId ?? 'tenant-t',
          projectId: options?.projectId ?? 'project-p',
          fileHash: options?.fileHash ?? `h:${content.length}`,
          analyzerVersion: 'test-analyzer'
        });
      }
    },
    visualService: { analyzeVisuals: () => ({ snapshot: fakeSnapshot() }) },
    harmonyService: { analyzeDesignHarmony: () => fakeHarmony(82) },
    accessibilityAuditor: { audit: () => [] },
    ...overrides
  };
  return new ValidationChain(deps);
}

const REQUEST = { tenantId: 'tenant-t', projectId: 'project-p' };

describe('§25 ValidationChain — chaîne unique ordonnée', () => {
  it('1. projet propre → ordre des étapes + verdict PASS', async () => {
    const chain = buildChain({
      'index.html': CLEAN_HTML,
      'app/main.ts': CLEAN_TS,
      'app/main.test.ts': 'export const t = 1;\n'
    });
    const report = await chain.run(REQUEST, 'ENGINEER');
    assert.deepEqual(report.stages.map((s) => s.id), ['files', 'syntax', 'a11y', 'design', 'tests']);
    assert.equal(report.verdict, 'PASS');
    assert.equal(report.chainVersion, VALIDATION_CHAIN_VERSION);
    assert.equal(report.fileCount, 3);
    const byId = new Map(report.stages.map((s) => [s.id, s]));
    assert.equal(byId.get('files')!.status, 'PASS');
    assert.equal(byId.get('syntax')!.status, 'PASS');
    assert.equal(byId.get('a11y')!.status, 'PASS');
    assert.equal(byId.get('design')!.status, 'PASS');
    assert.equal(byId.get('tests')!.status, 'SKIP', 'des tests existent mais ne sont pas exécutables ici');
  });

  it('2. erreurs de syntaxe RÉELLES (parse TS + JSON) → syntax FAIL + verdict FAIL', async () => {
    // Parse TypeScript réel : les diagnostics de parse remontent en TSxxxx.
    const tsChain = buildChain({ 'index.html': CLEAN_HTML, 'app/broken.ts': BROKEN_TS });
    const tsReport = await tsChain.run(REQUEST, 'ENGINEER');
    const tsSyntax = tsReport.stages.find((s) => s.id === 'syntax')!;
    assert.equal(tsSyntax.status, 'FAIL');
    assert.match(tsSyntax.evidence.join('\n'), /\[(TS\d+|AST_SYNTAX_FATAL)\]/);
    assert.equal(tsReport.verdict, 'FAIL');

    // Parse JSON réel : JSON_PARSE_ERROR (severity 'error').
    const jsonChain = buildChain({ 'index.html': CLEAN_HTML, 'data.json': '{"a": }' });
    const jsonReport = await jsonChain.run(REQUEST, 'ENGINEER');
    const jsonSyntax = jsonReport.stages.find((s) => s.id === 'syntax')!;
    assert.equal(jsonSyntax.status, 'FAIL');
    assert.match(jsonSyntax.evidence.join('\n'), /JSON_PARSE_ERROR/);
    assert.equal(jsonReport.verdict, 'FAIL');
  });

  it('3. problème a11y BLOQUANT (HIGH) → a11y FAIL + verdict FAIL', async () => {
    const chain = buildChain(
      { 'index.html': CLEAN_HTML },
      { accessibilityAuditor: { audit: () => [fakeFinding('HIGH', 'Contraste insuffisant')] } }
    );
    const report = await chain.run(REQUEST, 'ENGINEER');
    const a11y = report.stages.find((s) => s.id === 'a11y')!;
    assert.equal(a11y.status, 'FAIL');
    assert.match(a11y.evidence[0]!, /^\[HIGH\]/);
    assert.equal(report.verdict, 'FAIL');
  });

  it('4. problème a11y non bloquant (MEDIUM) → WARN + PASS_WITH_WARNINGS', async () => {
    const chain = buildChain(
      { 'index.html': CLEAN_HTML },
      { accessibilityAuditor: { audit: () => [fakeFinding('MEDIUM', 'Cible tactile exiguë')] } }
    );
    const report = await chain.run(REQUEST, 'ENGINEER');
    assert.equal(report.stages.find((s) => s.id === 'a11y')!.status, 'WARN');
    assert.equal(report.verdict, 'PASS_WITH_WARNINGS');
  });

  it('5. score design sous le seuil → WARN (le seuil est celui du code)', async () => {
    const chain = buildChain(
      { 'index.html': CLEAN_HTML },
      { harmonyService: { analyzeDesignHarmony: () => fakeHarmony(DESIGN_SCORE_MIN - 8) } }
    );
    const report = await chain.run(REQUEST, 'ENGINEER');
    const design = report.stages.find((s) => s.id === 'design')!;
    assert.equal(design.status, 'WARN');
    assert.match(design.detail, new RegExp(String(DESIGN_SCORE_MIN)));
    assert.equal(report.verdict, 'PASS_WITH_WARNINGS');
  });

  it('6. aucun fichier JS/TS/JSON → syntax SKIP (jamais PASS fabriqué)', async () => {
    const chain = buildChain({ 'index.html': CLEAN_HTML });
    const report = await chain.run(REQUEST, 'ENGINEER');
    const syntax = report.stages.find((s) => s.id === 'syntax')!;
    assert.equal(syntax.status, 'SKIP');
    assert.equal(report.verdict, 'PASS');
  });

  it('7. projet vide → files FAIL + verdict FAIL', async () => {
    const chain = buildChain({});
    const report = await chain.run(REQUEST, 'ENGINEER');
    assert.equal(report.stages.find((s) => s.id === 'files')!.status, 'FAIL');
    assert.equal(report.verdict, 'FAIL');
    assert.equal(report.fileCount, 0);
  });

  it('8. reportHash déterministe (mêmes contenus → même hash ; contenu changé → hash changé)', async () => {
    const filesA = { 'index.html': CLEAN_HTML, 'app/main.ts': CLEAN_TS };
    const first = await buildChain(filesA).run(REQUEST, 'ENGINEER');
    const second = await buildChain(filesA).run(REQUEST, 'ENGINEER');
    assert.equal(first.reportHash, second.reportHash);

    const changed = await buildChain({ ...filesA, 'app/other.ts': CLEAN_TS }).run(REQUEST, 'ENGINEER');
    assert.notEqual(first.reportHash, changed.reportHash);
    assert.notEqual(first.treeHash, changed.treeHash);
  });

  it('9. entryFile imposé mais absent → erreur honnête (pas de repli silencieux)', async () => {
    const chain = buildChain({ 'index.html': CLEAN_HTML });
    await assert.rejects(
      () => chain.run({ ...REQUEST, entryFile: 'nope.html' }, 'ENGINEER'),
      /nope\.html/
    );
  });

  it('10. aucun test déclaré → étape tests PASS (rien à exécuter)', async () => {
    const chain = buildChain({ 'index.html': CLEAN_HTML });
    const report = await chain.run(REQUEST, 'ENGINEER');
    assert.equal(report.stages.find((s) => s.id === 'tests')!.status, 'PASS');
  });

  it('11. analyse visuelle en échec → a11y/design FAIL (on ne valide pas sans vérifier)', async () => {
    const chain = buildChain(
      { 'index.html': CLEAN_HTML },
      { visualService: { analyzeVisuals: () => { throw new Error('moteur visuel hs'); } } }
    );
    const report = await chain.run(REQUEST, 'ENGINEER');
    const a11y = report.stages.find((s) => s.id === 'a11y')!;
    assert.equal(a11y.status, 'FAIL');
    assert.match(a11y.detail, /moteur visuel hs/);
    assert.equal(report.stages.find((s) => s.id === 'design')!.status, 'FAIL');
    assert.equal(report.verdict, 'FAIL');
  });

  it('12. rapport et étapes gelés en profondeur', async () => {
    const chain = buildChain({ 'index.html': CLEAN_HTML });
    const report = await chain.run(REQUEST, 'ENGINEER');
    assert.ok(Object.isFrozen(report));
    assert.ok(Object.isFrozen(report.stages));
    assert.ok(Object.isFrozen(report.stages[0]));
    assert.ok(Object.isFrozen(report.stages[0]!.evidence));
  });
});
