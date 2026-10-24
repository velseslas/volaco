import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runEngineeringPreflight } from '../../../src/ai-native/validation/engineering-preflight.js';

const validHtml = [
  '<!DOCTYPE html>',
  '<html lang="fr"><head><meta charset="UTF-8"><title>Préflight V7</title></head>',
  '<body><main><h1>Bienvenue</h1><p>Un contenu visible et suffisamment long pour être validé.</p></main></body>',
  '</html>'
].join('\n');

describe('V7 — préflight d’ingénierie HTML avant mutation', () => {
  it('accepte un document complet et expose un hash réel', () => {
    const report = runEngineeringPreflight(validHtml, 'index.html');

    assert.equal(report.verdict, 'PASS');
    assert.equal(report.passed, true);
    assert.deepEqual(report.blockers, []);
    assert.deepEqual(report.warnings, []);
    assert.match(report.contentHash, /^[a-f0-9]{64}$/);
    assert.equal(report.path, 'index.html');
    assert.ok(report.byteLength > 100);
    assert.ok(report.checks.some((item) => item.id === 'document-envelope' && item.status === 'PASS'));
  });

  it('refuse un fragment sans enveloppe de document', () => {
    const fragment = '<div><section><h1>Titre</h1><p>' + 'Contenu '.repeat(30) + '</p></section></div>';
    const report = runEngineeringPreflight(fragment, 'index.html');

    assert.equal(report.verdict, 'FAIL');
    assert.equal(report.passed, false);
    assert.ok(report.blockers.some((blocker) => blocker.includes('Enveloppe de document')));
  });

  it('alerte sans bloquer sur un conteneur majeur mal fermé', () => {
    const malformed = [
      '<!DOCTYPE html>',
      '<html><head><title>Test</title></head><body><main><div><section>',
      '<h1>Contenu suffisamment long pour dépasser le seuil minimal du préflight.</h1>',
      '</div></section></main></body></html>'
    ].join('\n');
    const report = runEngineeringPreflight(malformed, 'index.html');

    assert.equal(report.verdict, 'PASS_WITH_WARNINGS');
    assert.equal(report.passed, true);
    assert.ok(report.warnings.some((warning) => warning.includes('Équilibre des conteneurs majeurs')));
  });

  it('refuse un octet nul et un document hors plafond', () => {
    const nullReport = runEngineeringPreflight(validHtml + '\0', 'index.html');
    assert.equal(nullReport.verdict, 'FAIL');
    assert.ok(nullReport.blockers.some((blocker) => blocker.includes('octet nul')));

    const huge = validHtml + '\n<!-- ' + 'x'.repeat(5 * 1024 * 1024) + ' -->';
    const hugeReport = runEngineeringPreflight(huge, 'index.html');
    assert.equal(hugeReport.verdict, 'FAIL');
    assert.ok(hugeReport.blockers.some((blocker) => blocker.includes('Taille du document')));
  });

  it('alerte sur les marqueurs internes résiduels', () => {
    const report = runEngineeringPreflight(
      validHtml.replace('</body>', '<p>PAGE_TITLE: fuite</p></body>'),
      'index.html'
    );

    assert.equal(report.verdict, 'PASS_WITH_WARNINGS');
    assert.ok(report.warnings.some((warning) => warning.includes('Marqueurs internes')));
  });
});
