/**
 * ÉTAPE 44 Phase 2A — exposition de la recommandation DesignHarmony dans la carte Studio.
 *
 * La recommandation est calculée par les moteurs AINT-012 (drift-detector,
 * component-harmony, cross-page-harmony, responsive-a11y-harmony), transportée
 * telle quelle dans le DTO /design (harmony.topFindings[].recommendation) et
 * désormais rendue par la carte. Le Studio est un RENDERER : aucune fabrication,
 * aucun recalcul, échappement systématique via designPanelEscape.
 */

import './_lot-b-legacy-env.js';

process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

describe('ÉTAPE 44 Phase 2A — exposition de la recommandation Design Harmony', () => {
  let server: Server;
  let baseUrl: string;
  let projectId = '';
  const tenant = 'tenant_e44p2a';
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'x-tenant-id': tenant, 'x-user-role': 'ENGINEER' };

  // Contenu réel conçu pour déclencher un finding COMPONENT déterministe :
  // 4 boutons dont 3 à hauteur modale 40px et 1 hors gabarit (64px) —
  // component-harmony exige ≥3 éléments par rôle et un dominant à ≥60%.
  // (Fragment : le normalizer statique AINT-012 analyse un fragment DOM.)
  const HTML_A = `<div><h1>Version A</h1>
<button style="height:40px">Action 1</button>
<button style="height:40px">Action 2</button>
<button style="height:40px">Action 3</button>
<button style="height:64px">Action grande</button></div>`;

  function studioSource(): string {
    return readFileSync(resolve(process.cwd(), 'apps/studio/index.html'), 'utf8');
  }

  /** Corps source de loadDesignHarmony (jusqu'aux helpers), comme en É42 P4B. */
  function loadDesignHarmonySource(): string {
    const served = studioSource();
    const fnStart = served.indexOf('async function loadDesignHarmony');
    assert.ok(fnStart > 0, 'loadDesignHarmony présente');
    return served.slice(fnStart, served.indexOf('    function designPanelSubScore'));
  }

  before(async () => {
    const { createApiServer } = await import('../src/server.js');
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
    const pres = await fetch(`${baseUrl}/api/v1/projects`, { method: 'POST', headers, body: JSON.stringify({ name: 'E44 P2A reco' }) });
    projectId = ((await pres.json()) as { project?: { id?: string } }).project!.id!;
    await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT', headers, body: JSON.stringify({ path: 'index.html', content: HTML_A })
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  // 1 — le champ recommendation RÉEL du backend est présent dans le DTO
  it('1: le DTO /design transporte la recommendation réelle des moteurs (string, non vide sur ce projet)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design`, { headers });
    assert.equal(res.status, 200);
    const body = await res.json() as { harmony: { topFindings: Array<{ recommendation: unknown }> } };
    const findings = body.harmony.topFindings;
    assert.ok(Array.isArray(findings), 'topFindings est un tableau');
    assert.ok(findings.length > 0, 'ce projet génère des findings réels');
    for (const f of findings) {
      assert.equal(typeof f.recommendation, 'string', 'recommendation toujours transportée (champ requis du backend)');
    }
    assert.ok(findings.some((f) => (f.recommendation as string).trim() !== ''),
      'au moins une recommandation réelle non vide (moteurs AINT-012)');
  });

  // 2 — le Studio affiche EXACTEMENT la valeur backend (pas de transformation)
  it('2: le Studio rend f.recommendation tel quel via designPanelEscape (valeur backend exacte)', () => {
    const fn = loadDesignHarmonySource();
    // La seule transformation est l'échappement : designPanelEscape(f.recommendation)
    assert.ok(fn.includes('designPanelEscape(f.recommendation)'),
      'la valeur affichée est la valeur backend, uniquement échappée');
    // Aucune transformation/recalcul/troncature de la recommandation
    assert.doesNotMatch(fn, /f\.recommendation\s*\.\s*(slice|substring|substr|replace|toUpperCase|toLowerCase|trim\s*\(\)\s*\+)/,
      'aucune recomposition de la recommandation');
  });

  // 3 — aucune recommandation hardcodée côté Studio
  it('3: aucune recommandation inventée/hardcodée dans le Studio (seul l état honnête est littéral)', () => {
    const served = studioSource();
    // Les libellés réels des moteurs backend ne doivent JAMAIS apparaître côté front
    for (const engineString of [
      'Harmoniser le borderRadius',
      'Remplacer la couleur non standard',
      'Augmenter le contraste entre la couleur du texte',
      'Uniformiser la hauteur de',
      'Aligner la couleur de fond de'
    ]) {
      assert.ok(!served.includes(engineString), `aucune recommandation backend copiée en dur : "${engineString}"`);
    }
  });

  // 4 — échappement fonctionnel : le mécanisme exact de la carte neutralise le HTML
  it('4: designPanelEscape (mécanisme réel de la carte) échappe les caractères HTML', () => {
    const served = studioSource();
    const fnStart = served.indexOf('function designPanelEscape(');
    const fnEnd = served.indexOf('function agentsPanelEscape');
    assert.ok(fnStart > 0, 'designPanelEscape présente');
    const fnSource = served.slice(fnStart, fnEnd > fnStart ? fnEnd : undefined);
    // Évaluation réelle de la fonction extraite du Studio (le code qui tournera dans le navigateur)
    const escapeFn = new Function(`return (${fnSource.replace(/^function designPanelEscape\(/, 'function designPanelEscape(').trim()})`)() as (t: unknown) => string;
    const evil = '<img src=x onerror=alert(1)>&"\'';
    const escaped = escapeFn(evil);
    assert.ok(!escaped.includes('<img'), 'balise neutralisée');
    assert.ok(escaped.includes('&lt;img'), '< échappé');
    assert.ok(escaped.includes('&amp;'), '& échappé');
    assert.ok(escaped.includes('&quot;'), '" échappé');
    assert.ok(escaped.includes('&#39;'), "' échappé");
    assert.ok(!escaped.includes('>'), '> échappé');
  });

  // 5 — état honnête si recommendation absente/null/vide
  it('5: recommendation absente/null/vide → état explicite "Recommandation non disponible"', () => {
    const fn = loadDesignHarmonySource();
    assert.match(fn, /Recommandation non disponible/, 'état honnête présent');
    // La branche honnête couvre les trois cas : undefined, null, chaîne vide/blanche
    assert.match(fn, /f\.recommendation !== undefined && f\.recommendation !== null && String\(f\.recommendation\)\.trim\(\) !== ''/,
      'garde explicite undefined/null/vide');
  });

  // 6 — aucun recalcul côté Studio
  it('6: aucun recalcul de la recommandation (le Studio ne produit aucune donnée)', () => {
    const fn = loadDesignHarmonySource();
    assert.doesNotMatch(fn, /recommendation[^;]*\+[^;]*recommendation/, 'aucune concaténation métier');
    assert.doesNotMatch(fn, /(?:const|let|var)\s+reco[a-zA-Z]*\s*=\s*['"`](?!$)/, 'aucune recommandation construite en dur');
  });

  // 7 — aucun polling ajouté
  it('7: aucun polling (setInterval/setTimeout/WebSocket) dans loadDesignHarmony', () => {
    const fn = loadDesignHarmonySource();
    assert.doesNotMatch(fn, /setInterval|setTimeout|WebSocket/, 'aucun polling');
  });

  // 8 — non-régression É42 : DQI / sous-scores / findings / comparison toujours rendus
  it('8: non-régression É42 — carte Design Harmony intacte (DQI, sous-scores, comparison, delta)', async () => {
    const fn = loadDesignHarmonySource();
    assert.match(fn, /DQI ' \+ data\.dqi/, 'DQI réel rendu');
    assert.match(fn, /designPanelSubScore\('Couleur', sub\.colorHarmony\)/, 'sous-scores réels rendus');
    assert.match(fn, /Findings réels \(/, 'findings réels rendus');
    assert.match(fn, /agentsPanelEscape\(cmp\.previousReportId\)/, 'comparison intacte');
    assert.match(fn, /agentsPanelEscape\(reg\)/, 'regressions intactes');
    // Le DTO réel reste consommé tel quel : le delta affiché provient du backend
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design`, { headers });
    assert.equal(res.status, 200);
  });

  // 9 — non-régression É41 : panneau Agents intact
  it('9: non-régression É41 — panneau Agents intact', () => {
    const served = studioSource();
    assert.ok(served.includes('id="agentsPanelContainer"'));
    assert.match(served, /function refreshAgentsPanel\(/);
    assert.match(served, /async function openAgentsTaskDetail\(/);
    assert.match(served, /async function openAgentsBatchDetail\(/);
  });

  // 10 — Quality Gate intact
  it('10: non-régression — Quality Gate intact (runQualityGate / showQualityGateBanner)', () => {
    const served = studioSource();
    assert.match(served, /async function runQualityGate\(/);
    assert.match(served, /function showQualityGateBanner\(/);
  });

  // Inspection — aucun backend inutile modifié par cette phase
  it('Inspection: backend intact (design.ts, DesignHarmonyService, DesignReportStore, compareReports, DQI)', () => {
    const designRoute = readFileSync(resolve(process.cwd(), 'apps/api/src/routes/design.ts'), 'utf8');
    assert.match(designRoute, /topFindings: report\.findings\.slice\(0, 10\)/, 'DTO inchangé — la recommendation était déjà transportée');
    assert.doesNotMatch(designRoute, /designPanelEscape|studio/i, 'aucune logique Studio dans la route');
    const service = readFileSync(resolve(process.cwd(), 'packages/core/src/ai-native/design-harmony/service.ts'), 'utf8');
    assert.match(service, /compareReports\(/, 'compareReports intact');
    const store = readFileSync(resolve(process.cwd(), 'packages/core/src/ai-native/design-harmony/report-store.ts'), 'utf8');
    assert.match(store, /class DesignReportStore/, 'DesignReportStore intact');
  });
});
