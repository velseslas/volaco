/**
 * PV-03 — double génération : UN seul pont Studio→Builder et démarrage
 * non réentrant (chaque commande = 1 session + 1 flux SSE facturé).
 * Garde source (précédent : conversation-attachments.test.ts n°4).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('PV-03 : pas de double génération', () => {
  const src = readFileSync(join(process.cwd(), 'apps/studio/preview-builder-app.js'), 'utf8');

  it('1. un seul écouteur du pont start-builder-generation', () => {
    const hits = src.split('start-builder-generation').length - 1;
    assert.equal(hits, 1, `1 seul pont attendu, trouvé ${hits} (doublon = 2 générations facturées)`);
  });

  it('2. un seul déclenchement realBtn.click()', () => {
    const hits = src.split('realBtn.click()').length - 1;
    assert.equal(hits, 1, `1 seul déclenchement attendu, trouvé ${hits}`);
  });

  it('3. startRealGeneration est non réentrant (garde)', () => {
    assert.ok(src.includes('realGenerationStarting'), 'garde anti-réentrance présent');
    assert.ok(src.includes('if (realGenerationStarting) return'), 'démarrage concurrent ignoré');
  });
});
