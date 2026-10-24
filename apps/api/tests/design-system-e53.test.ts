/**
 * CDC V8 §11 LOT 1 — endpoints Design System : artefact persisté
 * (tokens + direction appliquée + règles versionnées) et catalogue de
 * règles versionné.
 *
 * Serveur HTTP RÉEL : GET /design analyse et PERSISTE l'artefact projet ;
 * GET /design/system relit le dernier artefact réel (404 honnête avant toute
 * analyse — aucun artefact fabriqué) ; GET /design/rules expose le catalogue
 * statique versionné. Non-régression : la réponse historique de GET /design
 * conserve exactement ses champs.
 */

process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  buildAppliedDesignRules,
  designRulesInputFromTokens,
  type InferredDesignSystem
} from '../../../packages/core/src/index.js';

describe('CDC V8 §11 Lot 1 — Design System persisté (API réelle)', () => {
  let server: Server;
  let baseUrl: string;
  let projectId = '';
  let emptyProjectId = '';
  const tenant = 'tenant_lot1_ds';
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'x-tenant-id': tenant, 'x-user-role': 'ENGINEER' };

  // Styles INLINE (le pipeline visuel lit les styles inline du DOM ; un
  // <style> de document sans cssContent n'est pas appliqué — vérifié en sonde).
  const HTML = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Lot 1</title></head>
<body style="background:#111827;color:#e5e7eb;font-family:system-ui;padding:24px">
<h1 style="color:#93c5fd;font-size:30px">Design System</h1>
<div class="card" style="background:#1f2937;border-radius:8px;padding:12px;margin:8px">Carte</div>
<button style="background:#93c5fd;border:none;border-radius:4px;padding:6px 12px;color:#111827">Action</button></body></html>`;

  const HTML_V2 = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Lot 1 v2</title></head>
<body style="background:#f8fafc;color:#0f172a;font-family:Georgia,serif;padding:32px">
<h1 style="color:#0e7490;font-size:38px">Design System V2</h1>
<div class="card" style="background:#ffffff;border-radius:16px;padding:20px;margin:12px">Carte V2</div>
<button style="background:#0e7490;border:none;border-radius:12px;padding:10px 18px;color:#ffffff">Action</button></body></html>`;

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
    const pres = await fetch(`${baseUrl}/api/v1/projects`, { method: 'POST', headers, body: JSON.stringify({ name: 'Lot 1 Design System' }) });
    projectId = ((await pres.json()) as { project?: { id?: string } }).project!.id!;
    await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT', headers, body: JSON.stringify({ path: 'index.html', content: HTML })
    });

    const empty = await fetch(`${baseUrl}/api/v1/projects`, { method: 'POST', headers, body: JSON.stringify({ name: 'Lot 1 sans analyse' }) });
    emptyProjectId = ((await empty.json()) as { project?: { id?: string } }).project!.id!;
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('1. GET /design/rules → catalogue versionné (ids stables, descriptions, version sémantique)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/rules`, { headers });
    assert.equal(res.status, 200);
    const body = await res.json() as {
      version?: string;
      rules?: { id?: string; category?: string; description?: string }[];
    };
    assert.match(body.version ?? '', /^\d+\.\d+\.\d+$/);
    assert.deepEqual(
      (body.rules ?? []).map((rule) => rule.id),
      [
        'palette.reuse',
        'typography.primary-family',
        'spacing.grid-base',
        'shape.radii-range',
        'elevation.max-levels',
        'structure.semantics',
        'a11y.contrast-labels'
      ]
    );
    for (const rule of body.rules ?? []) {
      assert.ok((rule.description ?? '').trim().length > 0, `description pour ${rule.id}`);
      assert.ok((rule.category ?? '').trim().length > 0, `catégorie pour ${rule.id}`);
    }
  });

  it('2. projet inconnu → 404 honnête sur les trois routes design', async () => {
    for (const suffix of ['design', 'design/system', 'design/rules']) {
      const res = await fetch(`${baseUrl}/api/v1/projects/proj_inconnu_lot1/${suffix}`, { headers });
      assert.equal(res.status, 404, suffix);
    }
  });

  it('3. GET /design/system avant toute analyse → 404 honnête (aucun artefact fabriqué)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${emptyProjectId}/design/system`, { headers });
    assert.equal(res.status, 404);
    const body = await res.json() as { message?: string };
    assert.match(body.message ?? '', /Aucun artefact Design System persisté/);
  });

  it('4. GET /design → artefact persisté : tokens RÉELS + direction APPLIQUÉE + règles versionnées', async () => {
    const designRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design`, { headers });
    assert.equal(designRes.status, 200);
    const design = await designRes.json() as { dqi: number; designDirection: { style?: string }; tokens: { colorTokens?: { primary?: string } } };

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/system`, { headers });
    assert.equal(res.status, 200);
    const body = await res.json() as {
      system?: {
        schemaVersion?: number;
        artifactId?: string;
        tenantId?: string;
        source?: { reportId?: string; reportHash?: string; dqi?: number };
        direction?: { style?: string };
        tokens?: { colorTokens?: { primary?: string }; systemConfidence?: number };
        rules?: { catalogVersion?: string; items?: { id?: string; text?: string }[] };
      };
    };
    const system = body.system!;
    assert.equal(system.schemaVersion, 1);
    assert.match(system.artifactId ?? '', /^dsa:[0-9a-f]{16}$/);
    assert.equal(system.tenantId, tenant);
    assert.match(system.source?.reportId ?? '', /^dhr-/);
    assert.ok((system.source?.reportHash ?? '').length > 0);
    assert.equal(system.source?.dqi, design.dqi, 'DQI de l artefact = DQI réellement calculé par la route');
    assert.deepEqual(system.direction, design.designDirection, 'direction persistée = direction appliquée');
    assert.deepEqual(system.tokens, design.tokens, 'tokens persistés = tokens de la réponse /design');
    assert.match(system.rules?.catalogVersion ?? '', /^\d+\.\d+\.\d+$/);
    // Preuve forte : les règles persistées sont EXACTEMENT l'instanciation du
    // catalogue versionné sur les tokens persistés (recalcul indépendant).
    const expectedRules = buildAppliedDesignRules(designRulesInputFromTokens(system.tokens as InferredDesignSystem));
    assert.deepEqual(system.rules?.items, expectedRules, 'règles de l artefact = catalogue appliqué aux tokens persistés');
    assert.ok(expectedRules.some((rule) => rule.id === 'structure.semantics'), 'règle toujours applicable présente');
    assert.ok(expectedRules.some((rule) => rule.id === 'a11y.contrast-labels'), 'règle toujours applicable présente');
    for (const item of system.rules?.items ?? []) {
      assert.ok((item.id ?? '').trim().length > 0);
      assert.ok((item.text ?? '').trim().length > 0);
    }
  });

  it('5. GET /design inchangé : champs historiques uniquement (aucun artefact dans la réponse)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design`, { headers });
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    const knownFields = ['designDirection', 'tokens', 'harmony', 'dqi', 'requestId', 'previous', 'comparison'];
    for (const key of Object.keys(body)) {
      assert.ok(knownFields.includes(key), `champ historique attendu : ${key}`);
    }
    assert.equal('system' in body, false);
    assert.equal('artefact' in body, false);
  });

  it('6. analyse suivante (HTML modifié) → l artefact suit le dernier rapport et son DQI', async () => {
    const before = await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/system`, { headers })).json() as {
      system?: { source?: { reportId?: string } };
    };
    // HTML réellement modifié : le service produit une NOUVELLE analyse (le
    // cache du moteur ne s'applique qu'à contenu identique).
    await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT', headers, body: JSON.stringify({ path: 'index.html', content: HTML_V2 })
    });
    const design = await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/design`, { headers })).json() as { dqi: number };
    const after = await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/system`, { headers })).json() as {
      system?: { source?: { reportId?: string; dqi?: number }; recordedAt?: string };
    };
    assert.match(after.system?.source?.reportId ?? '', /^dhr-/);
    assert.notEqual(after.system?.source?.reportId, before.system?.source?.reportId, 'nouveau rapport → artefact suivi');
    assert.equal(after.system?.source?.dqi, design.dqi, 'DQI de l artefact = DQI de la dernière analyse');
    assert.ok((after.system?.recordedAt ?? '').length > 0, 'horodatage d écriture réel');
  });

  it('7. isolation : un autre tenant ne voit pas l artefact (et pas le projet)', async () => {
    const otherHeaders = { ...headers, 'x-tenant-id': 'tenant_lot1_voisin' };
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/system`, { headers: otherHeaders });
    assert.equal(res.status, 404);
  });
});
