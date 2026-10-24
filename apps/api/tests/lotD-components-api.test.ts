/**
 * LOT D — CDC V8 §9/§10 : surface API « contrats composants » (preuves réelles).
 *
 * Prouve que :
 *  1. GET /design/components expose le catalogue complet (variantes, états,
 *     propriétés, contraintes, relations, règles d'utilisation, a11y,
 *     responsive) + les overrides projet ;
 *  2. POST /design/components/validate est un vrai garde-fou (composant
 *     inconnu, axe/valeur/état interdits, déprécié → remplacement) ;
 *  3. PUT déprécie un composant de façon persistée et traçable (remplacement +
 *     raison + approvedBy obligatoires), DELETE restaure le catalogue ;
 *  4. GET /design/components/audit mesure les composants RÉELLEMENT rendus de
 *     la page (dépréciation utilisée = échec explicite avec remplacement) ;
 *  5. GET /design reste STRICTEMENT inchangé (7 champs) — non-régression ;
 *  6. permissions, validation et erreurs 400/403 sont respectées.
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
  .btn { background-color: #2563eb; color: #ffffff; border-radius: 8px; padding: 12px 20px; }
  .btn:hover { background-color: #1d4ed8; }
  .btn:focus-visible { outline: 2px solid #111827; }
  .btn:active { transform: scale(0.99); }
  .btn:disabled { opacity: 0.5; }
  .card { border-radius: 8px; padding: 16px; background-color: #f9fafb; }
  table { width: 100%; font-size: 16px; }
</style></head><body>
  <h1>Commandes</h1>
  <p>Un paragraphe réel de contenu pour la mesure esthétique du projet.</p>
  <button class="btn" aria-label="Commencer">Commencer</button>
  <input id="email" type="email" aria-label="Email" />
  <label for="phone">Téléphone</label>
  <input id="phone" type="tel" />
  <div class="card"><h2>Carte commandes</h2><p>Contenu réel de la carte.</p></div>
  <table aria-label="Liste des commandes">
    <caption>Commandes récentes</caption>
    <thead><tr><th scope="col">Client</th></tr></thead>
    <tbody><tr><td>Ada</td></tr></tbody>
  </table>
</body></html>`;

describe('CDC V8 Lot D — contrats composants §9/§10 (API réelle)', () => {
  let server: Server;
  let baseUrl: string;
  let projectId: string;

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
      body: JSON.stringify({ name: 'Lot D Composants' })
    });
    projectId = ((await res.json()) as { project: { id: string } }).project.id;
    const put = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ path: 'index.html', content: INDEX_HTML })
    });
    assert.equal(put.status, 200, 'index.html écrit');
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('1. GET /design/components : catalogue complet §9/§10 + overrides vides', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/components`, { headers: H });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, any>;
    assert.equal(body.catalogVersion, '1.0.0');
    assert.deepEqual(body.overrides, []);
    assert.equal(body.components.length, 9);

    const table = body.components.find((component: any) => component.id === 'data-table');
    assert.deepEqual(
      table.variants.find((axis: any) => axis.id === 'density').values,
      ['compact', 'standard', 'dense']
    );
    for (const state of ['loading', 'empty', 'error', 'success', 'selected', 'disabled']) {
      assert.ok(table.requiredStates.includes(state), `état DataTable ${state}`);
    }
    assert.equal(table.properties.spacing, 'TOKEN_CONTROLLED');
    assert.equal(table.properties.typography, 'TOKEN_CONTROLLED');
    assert.equal(table.responsive.required, true);

    for (const component of body.components) {
      assert.equal(component.status, 'AVAILABLE');
      assert.ok(component.purpose.length > 0, `${component.id} : purpose`);
      assert.ok(component.constraints.length >= 1, `${component.id} : contraintes`);
      assert.ok(component.relations.composedOf.length >= 1, `${component.id} : relations`);
      assert.ok(component.usageRules.length >= 1, `${component.id} : règles d'utilisation`);
      assert.ok(component.accessibility.length >= 1, `${component.id} : a11y`);
      assert.ok(Array.isArray(component.roles), `${component.id} : rôles de détection`);
    }
    assert.equal(typeof body.artifactAvailable, 'boolean');
  });

  it('2. POST /design/components/validate : accepte une proposition conforme, refuse le reste', async () => {
    const ok = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/components/validate`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ componentId: 'button', variants: { emphasis: 'primary', size: 'large' }, states: ['hover', 'loading'] })
    });
    assert.equal(ok.status, 200);
    const okBody = (await ok.json()) as Record<string, any>;
    assert.equal(okBody.verdict.accepted, true);
    assert.deepEqual(okBody.verdict.violations, []);

    const unknown = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/components/validate`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ componentId: 'carousel' })
    });
    const unknownBody = (await unknown.json()) as Record<string, any>;
    assert.equal(unknownBody.verdict.accepted, false);
    assert.equal(unknownBody.verdict.violations[0].code, 'UNKNOWN_COMPONENT');

    const badVariant = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/components/validate`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ componentId: 'button', variants: { emphasis: 'tertiary' } })
    });
    const badVariantBody = (await badVariant.json()) as Record<string, any>;
    assert.equal(badVariantBody.verdict.violations[0].code, 'VARIANT_VALUE_NOT_ALLOWED');

    const badState = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/components/validate`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ componentId: 'button', states: ['exploded'] })
    });
    const badStateBody = (await badState.json()) as Record<string, any>;
    assert.equal(badStateBody.verdict.violations[0].code, 'STATE_NOT_ALLOWED');
  });

  it('3. PUT /design/components/card : dépréciation persistée, trace complète, DELETE restaure', async () => {
    const put = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/components/card`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({
        status: 'DEPRECATED',
        replacementId: 'data-table',
        reason: 'Les cartes de données migrent vers le DataTable du CDC.',
        approvedBy: 'test-lot-d'
      })
    });
    assert.equal(put.status, 200);
    const putBody = (await put.json()) as Record<string, any>;
    assert.equal(putBody.updated, true);
    assert.equal(putBody.applied.status, 'DEPRECATED');
    assert.equal(putBody.applied.replacementId, 'data-table');
    assert.equal(putBody.override.updatedBy, 'test-lot-d');
    assert.equal(putBody.override.catalogVersion, '1.0.0');

    const catalog = (await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/components`, { headers: H })).json()) as Record<string, any>;
    assert.equal(catalog.overrides.length, 1);
    const card = catalog.components.find((component: any) => component.id === 'card');
    assert.equal(card.status, 'DEPRECATED');
    assert.equal(card.deprecated.replacementId, 'data-table');
    assert.match(card.deprecated.since, /^\d{4}-\d{2}-\d{2}$/);

    const validate = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/components/validate`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ componentId: 'card' })
    });
    const validateBody = (await validate.json()) as Record<string, any>;
    assert.equal(validateBody.verdict.accepted, false);
    assert.equal(validateBody.verdict.replacementId, 'data-table');
    assert.equal(validateBody.verdict.violations[0].code, 'COMPONENT_DEPRECATED');
  });

  it('4. GET /design/components/audit : composants réellement rendus, dépréciation utilisée = échec', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/components/audit?page=index.html`, { headers: H });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, any>;
    const audit = body.audit;
    assert.match(audit.auditId, /^cca-[0-9a-f]{16}$/);
    assert.equal(audit.catalogVersion, '1.0.0');
    assert.deepEqual(audit.pages, ['/'], 'index.html est la route racine');
    assert.equal(audit.summary.contracts, 9);

    const button = audit.items.find((item: any) => item.componentId === 'button');
    assert.ok(button.observedCount >= 1, 'bouton réel détecté');
    const card = audit.items.find((item: any) => item.componentId === 'card');
    assert.ok(card.observedCount >= 1, 'carte réelle détectée (classe .card)');
    const finding = card.findings.find((entry: any) => entry.code === 'COMPONENT_DEPRECATED');
    assert.ok(finding, 'dépréciation utilisée détectée');
    assert.equal(finding.severity, 'HIGH');
    assert.equal(finding.expectedValue, 'data-table');
    assert.ok(audit.summary.deprecatedUsage.includes('card'));
    assert.equal(typeof body.aqsOverall, 'number');
  });

  it('5. DELETE /design/components/card : retour catalogue + audit sans dépréciation', async () => {
    const del = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/components/card?by=test-lot-d`, { method: 'DELETE', headers: H });
    assert.equal(del.status, 200);
    const delBody = (await del.json()) as Record<string, any>;
    assert.equal(delBody.reset, true);
    assert.equal(delBody.removed, true);
    assert.equal(delBody.applied.status, 'AVAILABLE');

    const audit = (await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/components/audit?page=index.html`, { headers: H })).json()) as Record<string, any>;
    const card = audit.audit.items.find((item: any) => item.componentId === 'card');
    assert.equal(card.findings.some((entry: any) => entry.code === 'COMPONENT_DEPRECATED'), false);
    assert.ok(!audit.audit.summary.deprecatedUsage.includes('card'));
  });

  it('6. GET /design : 7 champs historiques STRICTEMENT inchangés (non-régression)', async () => {
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
  });

  it('7. permissions + validation : VIEWER refusé, approvedBy/remplacement/raison exigés', async () => {
    const forbidden = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/components/card`, {
      method: 'PUT',
      headers: VIEWER,
      body: JSON.stringify({ status: 'DISABLED', reason: 'Raison suffisamment longue.', approvedBy: 'viewer' })
    });
    assert.equal(forbidden.status, 403);

    const noApprover = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/components/card`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ status: 'DISABLED', reason: 'Raison suffisamment longue.' })
    });
    assert.equal(noApprover.status, 400);

    const noReplacement = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/components/card`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ status: 'DEPRECATED', reason: 'Raison suffisamment longue.', approvedBy: 'test-lot-d' })
    });
    assert.equal(noReplacement.status, 400);

    const shortReason = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/components/card`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ status: 'DISABLED', reason: 'court', approvedBy: 'test-lot-d' })
    });
    assert.equal(shortReason.status, 400);

    const unknownComponent = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/components/carousel`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ status: 'DISABLED', reason: 'Raison suffisamment longue.', approvedBy: 'test-lot-d' })
    });
    assert.equal(unknownComponent.status, 400);

    const unknownDelete = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/components/carousel?by=test-lot-d`, {
      method: 'DELETE',
      headers: H
    });
    assert.equal(unknownDelete.status, 400);

    const missingPage = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/components/audit?page=missing.html`, { headers: H });
    assert.equal(missingPage.status, 400);

    const missingComponentId = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/components/validate`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({})
    });
    assert.equal(missingComponentId.status, 400);
  });
});
