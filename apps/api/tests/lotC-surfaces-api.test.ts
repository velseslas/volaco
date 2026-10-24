/**
 * LOT C — CDC V8 §6/§8/§24/§29-§31 : surfaces API réelles (preuves).
 *
 * Prouve que :
 *  1. GET /design reste STRICTEMENT inchangé (aucun champ en plus) ;
 *  2. le catalogue §6 est exposé et un override persistant prime sur la
 *     dérivation (GET /design + GET /design/system), puis se réinitialise ;
 *  3. la config §8 est persistée et l'audit expose les 10 règles CDC + la
 *     règle projet, avec PASS/FAIL/UNKNOWN réels ;
 *  4. la mémoire §24 est idempotente et la supersession est non destructive ;
 *  5. les opportunités §30 se masquent/restaurent via des décisions §24 ;
 *  6. le FULL DESIGN AUDIT §31 analyse 2 pages + breakpoints et agrège
 *     qualité/harmonie/esthétique/drift/consistance/a11y/règles ;
 *  7. l'historique des améliorations est réel (vide avant tout APPLY) ;
 *  8. permissions, validation et non-régression sont respectées.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';

const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'studio-local', 'x-user-role': 'ENGINEER' };
const VIEWER = { ...H, 'x-user-role': 'VIEWER' };

const INDEX_HTML = `<!DOCTYPE html><html><head><style>
  body { background-color: #ffffff; color: #111827; font-family: Inter, sans-serif; padding: 24px; }
  h1 { font-size: 40px; margin: 0 0 16px; }
  h2 { font-size: 24px; margin: 24px 0 8px; }
  p { font-size: 16px; margin: 0 0 16px; }
  .btn { background-color: #2563eb; color: #ffffff; border-radius: 8px; padding: 12px 20px; transition: background-color 240ms ease-in-out; }
  .btn:hover { background-color: #1d4ed8; }
</style></head><body>
  <header style="background-color:#2563eb; color:#ffffff; padding:16px">Volaco</header>
  <h1>Produits</h1>
  <p>Un paragraphe réel de contenu pour la mesure esthétique.</p>
  <h2>Fonctionnalités</h2>
  <p>Un second paragraphe réel de contenu pour la mesure.</p>
  <button class="btn" aria-label="Commencer">Commencer</button>
</body></html>`;

const ABOUT_HTML = `<!DOCTYPE html><html><head><style>
  body { background-color: #ffffff; color: #111827; font-family: Inter, sans-serif; padding: 24px; }
  h1 { font-size: 40px; margin: 0 0 16px; }
  h2 { font-size: 24px; margin: 24px 0 8px; }
  p { font-size: 16px; margin: 0 0 16px; }
  .btn { background-color: #2563eb; color: #ffffff; border-radius: 8px; padding: 12px 20px; transition: background-color 240ms ease-in-out; }
  .btn:hover { background-color: #1d4ed8; }
</style></head><body>
  <header style="background-color:#111827; color:#ffffff; padding:16px">Volaco</header>
  <h1>À propos</h1>
  <p>Page secondaire avec une en-tête de couleur divergente (dérive réelle).</p>
  <button class="btn" aria-label="Nous contacter">Nous contacter</button>
</body></html>`;

describe('CDC V8 Lot C — surfaces Design (API réelle)', () => {
  let server: Server;
  let baseUrl: string;
  let projectId: string;
  let initialStyle = '';

  before(async () => {
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
    const res = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ name: 'Lot C Surfaces' })
    });
    projectId = ((await res.json()) as { project: { id: string } }).project.id;
    for (const [path, content] of [
      ['index.html', INDEX_HTML],
      ['about.html', ABOUT_HTML]
    ] as const) {
      const put = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
        method: 'PUT',
        headers: H,
        body: JSON.stringify({ path, content })
      });
      assert.equal(put.status, 200, `${path} écrit`);
    }
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('1. GET /design : réponse historique STRICTEMENT inchangée', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design`, { headers: H });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, any>;
    const knownFields = ['comparison', 'designDirection', 'dqi', 'harmony', 'previous', 'requestId', 'tokens'];
    for (const key of Object.keys(body)) {
      assert.ok(knownFields.includes(key), `champ inattendu sur GET /design : ${key}`);
    }
    for (const key of ['designDirection', 'dqi', 'harmony', 'requestId', 'tokens']) {
      assert.ok(key in body, `champ historique manquant : ${key}`);
    }
    assert.equal(typeof body.designDirection.style, 'string');
    initialStyle = body.designDirection.style;
  });

  it('2. §6 GET /design/directions : catalogue 8 dimensions + profil appliqué', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/directions`, { headers: H });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, any>;
    assert.match(body.catalogVersion, /^\d+\.\d+\.\d+$/);
    assert.ok(Array.isArray(body.presets) && body.presets.length >= 5);
    assert.equal(body.artifactAvailable, true, 'GET /design a persisté l’artefact');
    assert.ok(body.applied);
    assert.equal(body.applied.source, 'derived');
    assert.equal(typeof body.applied.professionalism, 'string');
    assert.equal(typeof body.applied.visualComplexity, 'string');
  });

  it('3. §6 override persistant : GET /design + /design/system le consomment, DELETE le retire', async () => {
    const overrideStyle = initialStyle === 'Soft & Rounded' ? 'Sharp & Technical' : 'Soft & Rounded';
    const put = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/direction`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({
        override: { style: overrideStyle, professionalism: 'Professional', density: 'Dense' },
        approvedBy: 'test-lot-c'
      })
    });
    assert.equal(put.status, 200);
    const putBody = (await put.json()) as Record<string, any>;
    assert.equal(putBody.updated, true);
    assert.equal(putBody.override.updatedBy, 'test-lot-c');
    assert.equal(putBody.applied.style, overrideStyle);
    assert.equal(putBody.applied.professionalism, 'Professional');

    const design = (await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/design`, { headers: H })).json()) as Record<string, any>;
    assert.equal(design.designDirection.style, overrideStyle, 'la direction persistée prime');
    assert.equal(design.designDirection.professionalism, 'Professional');

    const system = (await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/system`, { headers: H })).json()) as Record<string, any>;
    assert.equal(system.system.direction.style, overrideStyle);

    const directions = (await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/directions`, { headers: H })).json()) as Record<string, any>;
    assert.equal(directions.applied.source, 'override');
    assert.equal(directions.override.override.style, overrideStyle);

    const reset = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/direction`, { method: 'DELETE', headers: H });
    assert.equal(reset.status, 200);
    const resetBody = (await reset.json()) as Record<string, any>;
    assert.equal(resetBody.reset, true);
    assert.equal(resetBody.removed, true);

    const designAfter = (await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/design`, { headers: H })).json()) as Record<string, any>;
    assert.equal(designAfter.designDirection.style, initialStyle, 'retour à la dérivation déterministe');
  });

  it('4. §8 config + audit des 10 règles : règle projet et règle désactivée réellement appliquées', async () => {
    const catalogue = (await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/rules`, { headers: H })).json()) as Record<string, any>;
    assert.equal(catalogue.rules.length, 7, 'catalogue de génération inchangé (non-régression)');

    const initial = (await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/rules/config`, { headers: H })).json()) as Record<string, any>;
    assert.equal(initial.customized, false);
    assert.equal(initial.config.thresholds.maxRadiusPx, 16);

    const put = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/rules/config`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({
        approvedBy: 'test-lot-c',
        config: {
          disabledRuleIds: ['RULE-010'],
          customRules: [
            {
              id: 'CUSTOM-RADIUS-2',
              label: 'Rayon projet ≤ 2px',
              metric: 'maxRadiusPx',
              operator: '<=',
              value: 2
            }
          ]
        }
      })
    });
    assert.equal(put.status, 200);

    const audit = (await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/rules/audit`, { headers: H })).json()) as Record<string, any>;
    assert.equal(audit.audit.catalogVersion.length > 0, true);
    assert.equal(audit.audit.results.length, 10, '9 règles CDC (RULE-010 désactivée) + 1 règle projet');
    assert.equal(audit.audit.results.some((rule: any) => rule.id === 'RULE-010'), false);
    const custom = audit.audit.results.find((rule: any) => rule.id === 'CUSTOM-RADIUS-2');
    assert.equal(custom.custom, true);
    assert.equal(custom.status, 'FAIL', '8px observé > 2px attendu');
    assert.equal(audit.audit.summary.total, 10);
  });

  it('5. §24 mémoire : idempotence, liste, supersession non destructive', async () => {
    const empty = (await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/memory`, { headers: H })).json()) as Record<string, any>;
    assert.deepEqual(empty.decisions, []);

    const payload = {
      decision: 'Utiliser des tables compactes',
      reason: 'Application destinée à des utilisateurs professionnels manipulant de gros volumes.',
      approvedBy: 'test-lot-c'
    };
    const first = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/memory`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify(payload)
    });
    assert.equal(first.status, 200);
    const firstBody = (await first.json()) as Record<string, any>;
    assert.equal(firstBody.created, true);
    assert.match(firstBody.decision.id, /^dmem:[a-f0-9]{16}$/);

    const second = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/memory`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify(payload)
    });
    const secondBody = (await second.json()) as Record<string, any>;
    assert.equal(secondBody.created, false, 'même décision → aucun doublon');

    const listed = (await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/memory`, { headers: H })).json()) as Record<string, any>;
    assert.equal(listed.decisions.length, 1);
    assert.equal(listed.activeCount, 1);

    const del = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/design/memory/${encodeURIComponent(firstBody.decision.id)}?by=test-lot-c`,
      { method: 'DELETE', headers: H }
    );
    assert.equal(del.status, 200);
    const delBody = (await del.json()) as Record<string, any>;
    assert.equal(delBody.superseded, true);
    assert.equal(delBody.decision.status, 'SUPERSEDED');
    assert.equal(delBody.decision.supersededBy, 'test-lot-c');

    const after = (await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/memory`, { headers: H })).json()) as Record<string, any>;
    assert.equal(after.decisions.length, 1, 'aucune suppression');
    assert.equal(after.activeCount, 0);
  });

  it('6. §30 opportunités : ignore persistante puis restauration', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/opportunities`, { headers: H });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, any>;
    assert.equal(typeof body.target, 'number');
    assert.ok(Array.isArray(body.opportunities));
    for (const opportunity of body.opportunities) {
      assert.match(opportunity.id, /^opp-[a-z_]+$/);
      assert.ok(typeof opportunity.why === 'string' && opportunity.why.length > 0);
      assert.ok(typeof opportunity.what === 'string' && opportunity.what.length > 0);
      assert.ok(typeof opportunity.impact === 'string' && opportunity.impact.length > 0);
      assert.ok(Array.isArray(opportunity.risks));
    }

    const ignore = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/opportunities/ignore`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ opportunityId: 'opp-spacing_rhythm', reason: 'Choix produit assumé pour cette itération.', approvedBy: 'test-lot-c' })
    });
    assert.equal(ignore.status, 200);
    const ignoreBody = (await ignore.json()) as Record<string, any>;
    assert.equal(ignoreBody.ignored, true);
    assert.equal(ignoreBody.decision.kind, 'IGNORE_OPPORTUNITY');

    const ignoredList = (await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/opportunities`, { headers: H })).json()) as Record<string, any>;
    assert.ok(ignoredList.ignoredCount >= 1);

    const restore = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/opportunities/opp-spacing_rhythm/ignore?by=test-lot-c`, {
      method: 'DELETE',
      headers: H
    });
    assert.equal(restore.status, 200);
    const restoreBody = (await restore.json()) as Record<string, any>;
    assert.equal(restoreBody.restored, true);
    assert.ok(restoreBody.count >= 1);

    const restored = (await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/opportunities`, { headers: H })).json()) as Record<string, any>;
    assert.equal(restored.ignoredCount, 0);
  });

  it('7. §31 full audit : 2 pages, breakpoints, drift réel, agrégats et règles', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/audit`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ pages: ['index.html', 'about.html'] })
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, any>;
    const audit = body.audit;
    assert.match(audit.auditId, /^fda-[a-f0-9]{16}$/);
    assert.equal(audit.pages.length, 2);
    assert.deepEqual(audit.pages.map((page: any) => page.path), ['index.html', 'about.html']);
    assert.deepEqual(audit.skipped, []);
    assert.equal(audit.summary.pagesAnalyzed, 2);
    assert.ok(audit.summary.pagesMeasured >= 1, 'au moins une page réellement mesurable');
    assert.deepEqual(audit.summary.breakpoints.sort(), ['desktop 1440×900', 'mobile 390×844']);
    assert.equal(audit.summary.designDrift.status, 'DETECTED', 'en-têtes de couleurs différentes');
    assert.ok(audit.summary.designDrift.findings >= 1);
    assert.ok(audit.summary.uxConsistency !== null && audit.summary.uxConsistency < 100);
    assert.equal(audit.summary.rules.total, 20, '2 pages × (9 règles CDC + 1 règle projet)');
    assert.ok(Array.isArray(audit.summary.recommendations));
    for (const page of audit.pages) {
      assert.equal(page.subScores.length, 12);
      assert.equal(page.viewports.desktop.width, 1440);
      assert.equal(page.viewports.mobile.width, 390);
    }
    assert.ok(audit.summary.globalDesignQuality === null || typeof audit.summary.globalDesignQuality === 'number');
  });

  it('8. §29 historique des améliorations : réel et vide avant tout APPLY', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/improvements`, { headers: H });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, any>;
    assert.deepEqual(body.improvements, []);
    assert.equal(body.count, 0);
  });

  it('9. permissions + validation : VIEWER refusé, approvedBy/pages/raison exigés', async () => {
    const forbidden = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/direction`, {
      method: 'PUT',
      headers: VIEWER,
      body: JSON.stringify({ override: { style: 'Sharp & Technical' }, approvedBy: 'viewer' })
    });
    assert.equal(forbidden.status, 403);

    const noApprover = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/direction`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ override: { style: 'Sharp & Technical' } })
    });
    assert.equal(noApprover.status, 400);

    const badPage = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/audit`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ pages: ['missing.html'] })
    });
    assert.equal(badPage.status, 400);

    const badReason = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/memory`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ decision: 'Décision test', reason: 'court' })
    });
    assert.equal(badReason.status, 400);
  });

  it('10. non-régression finale : GET /design garde exactement ses champs', async () => {
    const body = (await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/design`, { headers: H })).json()) as Record<string, any>;
    const knownFields = ['comparison', 'designDirection', 'dqi', 'harmony', 'previous', 'requestId', 'tokens'];
    for (const key of Object.keys(body)) {
      assert.ok(knownFields.includes(key), `champ inattendu sur GET /design : ${key}`);
    }
  });
});
