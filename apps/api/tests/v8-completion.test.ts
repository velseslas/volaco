/**
 * CDC V8 — complétion des 3 derniers points : §11 (bouton Améliore le design
 * branché sur /design/improve avec approbation humaine), §12 (sandbox du
 * preview — SEC-01), §14 (walkthrough de certification).
 * Pattern source-inspection identique aux tests Studio existants (lot10…).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// dist/apps/api/tests → 4 niveaux au-dessus = racine du dépôt (sources).
const snapRoot = resolve(here, '..', '..', '..', '..');
const studio = readFileSync(join(snapRoot, 'apps', 'studio', 'index.html'), 'utf8');
const cert = readFileSync(join(snapRoot, 'docs', 'CERTIFICATION-V8.md'), 'utf8');

describe('CDC V8 — complétion finale (§11, §12, §14)', () => {
  it('§11 le Studio expose le bouton « Améliore le design » branché sur /design/improve', () => {
    assert.ok(studio.includes("btn.id = 'btnDesignImprove'"), 'bouton présent (créé par le boot script)');
    assert.ok(studio.includes('window.volacoDesignImprove'), 'handler global défini');
    assert.ok(studio.includes('/design/improve'), 'endpoint appelé');
    assert.ok(studio.includes('apply: false'), 'd abord proposition sans application');
    assert.ok(studio.includes('apply: true, approvedBy'), 'application uniquement avec approbation humaine (§21)');
  });

  it('§12 le preview est isolé par un attribut sandbox (SEC-01, sans allow-same-origin)', () => {
    assert.ok(studio.includes("frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups')"), 'harden sandbox');
    assert.ok(studio.includes('previewFrameWrapper'), 'cible le wrapper du preview');
    assert.ok(studio.includes('MutationObserver'), 'les iframes créées dynamiquement sont couvertes');
  });

  it('§14 le walkthrough de certification couvre les 8 contrôles du CDC §13', () => {
    for (const controle of ['TypeScript', 'Tests', 'Régression', 'Visual', 'Accessibility', 'Security', 'Determinism', 'Traceability']) {
      assert.ok(cert.includes(controle), `contrôle « ${controle} » documenté`);
    }
    assert.ok(cert.includes('2705'), 'preuve de suite chiffrée');
  });
});
