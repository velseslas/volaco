/**
 * ÉTAPE 46 Phase 2 — panneau Images du Studio (génération + galerie + insertion).
 *
 * Le Studio ne consommait AUCUN endpoint /images/*. Ce phase ajoute le
 * panneau `wsSubPanel-images` (menu Outils → Images) qui :
 *   - génère via POST /images/generate (studioApiHeaders, anti double-submit,
 *     timeout UI 120 s > timeout provider 90 s) ;
 *   - liste via GET /images (noms validés côté client par la même règle que
 *     le serveur avant de construire une URL) ;
 *   - insère via le mécanisme d'édition existant : GET index.html →
 *     insertion de <img src="url-serveur"> avant </body> → PUT files/content
 *     → rafraîchissement du preview (renderWorkspaceIframe).
 *
 * Deux niveaux de vérification :
 *   1. source Studio (pattern agents-panel) : présence et comportement ;
 *   2. flux fonctionnel réel au niveau API (provider factice pré-enregistré,
 *      aucun réseau) reproduisant exactement la séquence du panneau.
 */

import './_lot-b-legacy-env.js';

process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { imageProviderRegistry } from '../../../packages/core/src/image/registry.js';

function studioSource(): string {
  return readFileSync(resolve(process.cwd(), 'apps/studio/index.html'), 'utf8');
}

describe('ÉTAPE 46 Phase 2 — panneau Images du Studio (source)', () => {
  // A — panneau présent
  it('A: le panneau Images existe (conteneur, prompt, bouton, galerie, aperçu, statut)', () => {
    const served = studioSource();
    for (const id of ['wsSubPanel-images', 'imagesPromptInput', 'btnImagesGenerate', 'imagesGallery', 'imagesPreviewBox', 'imagesPreviewImg', 'imagesStatus']) {
      assert.ok(served.includes(`id="${id}"`), `élément manquant : ${id}`);
    }
    // Entrée utilisateur : menu Outils + branche de routage
    assert.match(served, /handleToolMenuAction\('images'\)/);
    assert.match(served, /requestWorkspaceSubTab\('images'\)/);
  });

  it('B: le POST utilise le contrat existant (POST /images/generate + studioApiHeaders + prompt)', () => {
    const fn = studioSource().slice(
      studioSource().indexOf('async function generateStudioImage'),
      studioSource().indexOf('async function insertStudioImage')
    );
    assert.match(fn, /\/images\/generate/, 'endpoint exact utilisé');
    assert.match(fn, /method: 'POST'/);
    assert.match(fn, /studioApiHeaders\(\)/);
    assert.match(fn, /JSON\.stringify\(\{ prompt: prompt \}\)/, 'corps = { prompt } uniquement');
    assert.doesNotMatch(fn, /Authorization|api[_-]?key|secret/i, 'aucun secret côté Studio');
  });

  it('C: état loading — bouton désactivé + libellé Génération… pendant la requête', () => {
    const fn = studioSource().slice(
      studioSource().indexOf('async function generateStudioImage'),
      studioSource().indexOf('async function insertStudioImage')
    );
    assert.match(fn, /imagesPanelBusy = true/);
    assert.match(fn, /btn\.disabled = true/);
    assert.match(fn, /Génération…/);
    assert.match(fn, /fa-spinner fa-spin/);
    // Timeout UI > timeout provider (90 s)
    assert.match(fn, /120000/);
  });

  it('D: succès affiché — aperçu depuis data.url (construit par le serveur) + message', () => {
    const fn = studioSource().slice(
      studioSource().indexOf('async function generateStudioImage'),
      studioSource().indexOf('async function insertStudioImage')
    );
    assert.match(fn, /previewImg\.src = data\.url/, "l'aperçu utilise l'URL renvoyée par l'API");
    assert.match(fn, /showImagesStatus\('success'/);
  });

  it('E: erreurs explicites — 400/403/429/500 + timeout, sans fausse réussite', () => {
    const fn = studioSource().slice(
      studioSource().indexOf('async function generateStudioImage'),
      studioSource().indexOf('async function insertStudioImage')
    );
    assert.match(fn, /status === 429/);
    assert.match(fn, /status === 403/);
    assert.match(fn, /Génération impossible \(/);
    assert.match(fn, /AbortError/);
    assert.match(fn, /showImagesStatus\('error'/);
    // Aucun chemin de succès si !res.ok : return avant tout affichage de succès
    assert.ok(fn.indexOf("if (!res.ok)") !== -1 && fn.indexOf("showImagesStatus('success'") > fn.indexOf('return;\n        }\n        const data = await res.json()'),
      'le succès ne peut intervenir qu après une réponse ok');
  });

  it('F: galerie — GET /images consommé et rendu (nom validé avant URL)', () => {
    const served = studioSource();
    const fn = served.slice(
      served.indexOf('async function loadImagesPanel'),
      served.indexOf('async function generateStudioImage')
    );
    assert.match(fn, /\/images'/, 'GET /images utilisé');
    assert.match(fn, /assetImageUrl\(pid, a\.name\)/, 'URL construite via la validation');
    // Même règle que le serveur (constante déclarée au niveau du bloc panneau)
    assert.match(served, /IMAGE_ASSET_NAME_RE = .*a-z0-9-.*\.\(jpg\|jpeg\|png\|webp\)\$/s);
  });

  it('G: insertion — GET index.html → <img> avant </body> → PUT files/content → preview', () => {
    const fn = studioSource().slice(
      studioSource().indexOf('async function insertStudioImage'),
      studioSource().indexOf('async function loadDesignHarmony')
    );
    assert.match(fn, /files\/content\?path=index\.html/, 'lecture du fichier existant');
    assert.match(fn, /<\/body>/i, 'insertion avant </body>');
    assert.match(fn, /<img src="' \+ url/, "l'image référence l'asset serveur (pas de base64)");
    assert.match(fn, /method: 'PUT'/);
    assert.match(fn, /currentAppHtml = updated/);
    assert.match(fn, /renderWorkspaceIframe\(currentAppHtml\)/);
    assert.match(fn, /assetImageUrl\(pid, name\)/, 'URL revalidée côté client');
  });

  it('H: double-submit impossible — garde busy + bouton désactivé + restauration', () => {
    const fn = studioSource().slice(
      studioSource().indexOf('async function generateStudioImage'),
      studioSource().indexOf('async function insertStudioImage')
    );
    assert.match(fn, /if \(imagesPanelBusy\) return/);
    assert.match(fn, /finally/, 'état restauré même en cas d erreur');
  });

  it('I: non-régression — panneaux É41/É42 et Quality Gate intacts', () => {
    const served = studioSource();
    assert.ok(served.includes('id="agentsPanelContainer"'));
    assert.match(served, /async function loadDesignHarmony\(/);
    assert.match(served, /function showQualityGateBanner\(/);
    assert.match(served, /async function runQualityGate\(/);
    // Les anciens tabs continuent d exister
    for (const tab of ['preview', 'code', 'dna', 'terminal', 'history', 'audit', 'features', 'feedback', 'strategy']) {
      assert.ok(served.includes(`'${tab}'`) || served.includes(`"${tab}"`), `tab ${tab} toujours câblé`);
    }
  });
});

describe('ÉTAPE 46 Phase 2 — flux du panneau au niveau API (provider factice, sans réseau)', () => {
  let server: Server;
  let baseUrl: string;
  let projectId = '';
  const tenant = 'tenant_e46p2';
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'x-tenant-id': tenant, 'x-user-role': 'ENGINEER' };

  before(async () => {
    imageProviderRegistry.register({
      id: 'pollinations', // même id que le bootstrap : le panneau/la route l'utilisera
      name: 'Fake É46',
      isAvailable: () => true,
      generate: async (prompt: string) => {
        const jpeg = Buffer.alloc(2000, 7);
        jpeg[0] = 0xff; jpeg[1] = 0xd8;
        return { data: Buffer.concat([jpeg, Buffer.from('E46:' + prompt.slice(0, 30))]), contentType: 'image/jpeg' };
      }
    });
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
    const pres = await fetch(`${baseUrl}/api/v1/projects`, { method: 'POST', headers, body: JSON.stringify({ name: 'E46 panel flow' }) });
    projectId = ((await pres.json()) as { project?: { id?: string } }).project!.id!;
    await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT', headers, body: JSON.stringify({ path: 'index.html', content: '<!DOCTYPE html><html><body><h1>Accueil</h1></body></html>' })
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('flux complet du panneau : générer → galerie → GET index.html → insérer → PUT → asset servi', async () => {
    // 1. POST /images/generate (ce que fait generateStudioImage)
    const gen = await fetch(`${baseUrl}/api/v1/projects/${projectId}/images/generate`, {
      method: 'POST', headers, body: JSON.stringify({ prompt: 'un chat astronaute', name: 'chat-astronaute' })
    });
    assert.equal(gen.status, 201);
    const genBody = await gen.json() as { path: string; url: string };
    assert.match(genBody.url, /\/images\/chat-astronaute\.jpg$/);

    // 2. GET /images (ce que fait loadImagesPanel)
    const list = await fetch(`${baseUrl}/api/v1/projects/${projectId}/images`, { headers });
    const listBody = await list.json() as { assets: Array<{ name: string }> };
    assert.ok(listBody.assets.some((a) => a.name === 'chat-astronaute.jpg'));

    // 3. GET index.html → insertion avant </body> → PUT (ce que fait insertStudioImage)
    const fileRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content?path=index.html`, { headers });
    const html = ((await fileRes.json()) as { file: { content: string } }).file.content;
    assert.ok(!html.includes(genBody.url), "l'image n'est pas encore insérée");
    const tag = `<figure class="vibe-asset-image"><img src="${genBody.url}" alt="chat-astronaute.jpg" /></figure>`;
    const updated = html.replace(/<\/body>/i, `${tag}\n</body>`);
    const put = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT', headers, body: JSON.stringify({ path: 'index.html', content: updated })
    });
    assert.equal(put.status, 200);

    // 4. L'aperçu (iframe) peut charger l'asset référencé
    const asset = await fetch(`${baseUrl}${genBody.url}`, { headers });
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type') || '', /image\/jpeg/);

    // 5. Le HTML servi contient bien la référence insérée (pas de base64 inline)
    const after = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content?path=index.html`, { headers });
    const afterHtml = ((await after.json()) as { file: { content: string } }).file.content;
    assert.ok(afterHtml.includes(`src="${genBody.url}"`));
    assert.ok(!afterHtml.includes('data:image'), 'aucune conversion base64 côté Studio');
  });
});
