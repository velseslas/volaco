/**
 * PATCH P0 — F3 : la relance B1 doit repartir en CRÉATION.
 *
 * Le cycle démontré (audit) : tentative 1 sauvegardée → ap.code mis à jour →
 * relance soumise → isModification recalculé TRUE → le serveur fusionnait en
 * mode modification (sections re-échangées, images dérivées). F3 : la relance
 * envoie isModification:false — le serveur E48 remplace le site (création),
 * sans fusion, et la tentative 1 reste récupérable (révision automatique).
 *
 * Preuve serveur de BOUT EN BOUT, sans réseau ni IA payante (adaptateur
 * factice streaming, même harnais que design-dna-e52p2b/sector-contract) :
 *   1. tentative 1 : création, URL hallucinées dans les sections → F1 les
 *      reprend dans le réservoir du thème DANS le HTML réellement sauvegardé ;
 *   2. tentative 2 : mêmes { message, isModification: false } (payload exact
 *      de la relance F3) → le fichier final contient UNIQUEMENT les sections
 *      de la tentative 2 (aucune fusion), images à nouveau thématiques ;
 *   3. rollback : la révision de la tentative 1 existe toujours.
 *
 * Limite assumée : le diff-guard/rollback CLIENT reste du code navigateur,
 * non exécutable sous node --test (prouvé par lecture de code, pas ici).
 */
process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { aiProviderRegistry, type AIProviderAdapter, type AIProviderGenerateRequest, type AIProviderGenerateResponse } from '../../../packages/core/src/ai/providers/index.js';
import { THEME_IMAGE_RESOURCES } from '../../../packages/core/src/image/theme.js';

const POOL_RESTO = new Set(THEME_IMAGE_RESOURCES.restaurant.unsplash);
const H = {
  'Content-Type': 'application/json; charset=utf-8',
  'x-tenant-id': 'tenant_retry_b1',
  'x-user-role': 'ENGINEER'
};

const CANNED_ATTEMPT1 = `<!-- DESIGN_DNA: {"palette":{"bg":"#fff8f0","fg":"#3b2a1e","accent":"#c2410c"},"font":"Fraunces","mode":"light"} -->
<!-- PAGE_TITLE: La Galette — Crêperie de la Place -->
Salut ! Je construis ta crêperie section par section.
<SECTION name="header">
Je pose le header chaleureux.
<header><h1>La Galette</h1><nav>Carte · Horaires</nav></header>
</SECTION>
<SECTION name="hero">
Le hero avec une photo à sujet (URL hallucinée de mémoire).
<section><h2>Crêpes artisanales</h2><img src="https://loremflickr.com/1200/800/food?lock=9" alt="plat signature"></section>
</SECTION>
<SECTION name="galerie">
Une galerie avec une seconde URL inventée.
<section><!-- GALERIE-V1 --><img src="https://images.unsplash.com/photo-9999999999-aaaaaaaaaa?auto=format&fit=crop&w=1200&q=80" alt="salle paisible"></section>
</SECTION>
Voilà, ta crêperie est prête !`;

const CANNED_ATTEMPT2 = `<!-- DESIGN_DNA: {"palette":{"bg":"#fff8f0","fg":"#3b2a1e","accent":"#c2410c"},"font":"Fraunces","mode":"light"} -->
<!-- PAGE_TITLE: La Galette — Crêperie de la Place -->
Je relance la génération complète.
<SECTION name="header">
Header relancé.
<header><h1>La Galette</h1><nav>Menu · Avis</nav></header>
</SECTION>
<SECTION name="hero">
Hero relancé (URL hallucinée différente).
<section><h2>Galette complète</h2><img src="https://loremflickr.com/1200/800/galette?lock=2" alt="galette complète"></section>
</SECTION>
<SECTION name="menu">
<section><ul><li>Galette complète</li><li>Cidre brut</li></ul><!-- MENU-V2 --></section>
</SECTION>
Voilà, la relance est en place !`;

describe('F3 — relance B1 : seconde tentative en CRÉATION (remplace, ne fusionne pas)', () => {
  let server: Server;
  let baseUrl: string;
  let streamCalls = 0;

  before(async () => {
    const cannedCallsByProject = new Map<string, number>();
    const fakeAdapter = {
      descriptor: {
        providerId: 'fake-retry-b1',
        providerName: 'Fake Retry B1',
        models: ['fake-retry-model'],
        capabilities: ['TEXT' as const],
        contextWindow: 32000,
        structuredOutput: false,
        streaming: true,
        toolCalling: false,
        reasoning: false,
        vision: false,
        costMetadata: {},
        availability: 'AVAILABLE' as const,
        healthStatus: 'HEALTHY' as const
      },
      generate: async (request: AIProviderGenerateRequest): Promise<AIProviderGenerateResponse> =>
        ({ text: 'Clos avec plaisir.', modelId: 'fake-retry-model', finishReason: 'STOP' } as unknown as AIProviderGenerateResponse),
      generateStream: async function* (request: AIProviderGenerateRequest): AsyncIterable<string> {
        streamCalls += 1;
        // 1re tentative du PROJET → réponse A ; relance et suivantes → B.
        const seen = cannedCallsByProject.get(String(request.projectId)) ?? 0;
        cannedCallsByProject.set(String(request.projectId), seen + 1);
        const canned = seen === 0 ? CANNED_ATTEMPT1 : CANNED_ATTEMPT2;
        for (const line of canned.split('\n')) yield line + '\n';
      }
    } as unknown as AIProviderAdapter;
    aiProviderRegistry.register(fakeAdapter);
    const { createApiServer } = await import('../src/server.js');
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
  });

  async function savedHtml(pid: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/v1/projects/${pid}/files/content?path=index.html`, { headers: H });
    assert.equal(res.status, 200);
    return ((await res.json()) as { file: { content: string } }).file.content;
  }

  async function revisions(pid: string): Promise<Array<{ id: string; files: Record<string, { content: string }> }>> {
    const res = await fetch(`${baseUrl}/api/v1/projects/${pid}/revisions`, { headers: H });
    assert.equal(res.status, 200);
    return ((await res.json()) as { revisions: Array<{ id: string; files: Record<string, { content: string }> }> }).revisions;
  }

  it('tentative 1 : création, images hallucinées reprises dans le réservoir DANS le HTML sauvegardé', async () => {
    const pres = await fetch(`${baseUrl}/api/v1/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'Retry B1' }) });
    assert.equal(pres.status, 201);
    const pid = ((await pres.json()) as { project?: { id?: string } }).project!.id!;
    const sess = await fetch(`${baseUrl}/api/v1/projects/${pid}/conversation/sessions`, { method: 'POST', headers: H });
    assert.equal(sess.status, 201);
    const sid = ((await sess.json()) as { session?: { id?: string } }).session!.id!;

    // Payload CRÉATION explicite (identique à ce que F3 envoie pour la relance).
    const stream = await fetch(`${baseUrl}/api/v1/projects/${pid}/conversation/sessions/${sid}/stream`, {
      method: 'POST', headers: H, body: JSON.stringify({ message: 'Crée un site pour mon restaurant italien', isModification: false })
    });
    assert.equal(stream.status, 200);
    await stream.text();
    assert.equal(streamCalls, 1, 'un appel streaming par tentative');

    const html = await savedHtml(pid);
    assert.ok(html.includes('GALERIE-V1'), 'sections de la tentative 1 assemblées');
    assert.ok(!html.includes('loremflickr.com'), 'F1 E2E : URLs hallucinées absentes du HTML sauvegardé');
    const ids = [...html.matchAll(/images\.unsplash\.com\/(photo-[A-Za-z0-9-]+)/g)].map((m) => m[1]!);
    assert.ok(ids.length >= 2, 'images réécrites');
    for (const id of ids) assert.ok(POOL_RESTO.has(id), 'tout ID final appartient au réservoir restaurant : ' + id);

    const revs = await revisions(pid);
    assert.equal(revs.length, 1, 'révision automatique de la tentative 1');
    const first = revs[0]!.files['index.html'];
    assert.ok(first && first.content.includes('GALERIE-V1'), 'tentative 1 récupérable pour rollback');
  });

  it('tentative 2 (payload relance F3) : REMPLACEMENT comme création, aucune fusion, tentative 1 intacte en révision', async () => {
    const pres = await fetch(`${baseUrl}/api/v1/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'Retry B1 bis' }) });
    assert.equal(pres.status, 201);
    const pid = ((await pres.json()) as { project?: { id?: string } }).project!.id!;
    const sess = await fetch(`${baseUrl}/api/v1/projects/${pid}/conversation/sessions`, { method: 'POST', headers: H });
    assert.equal(sess.status, 201);
    const sid = ((await sess.json()) as { session?: { id?: string } }).session!.id!;

    // Tentative 1 du second cycle (le projet a du code > 200 chars après ça).
    const s1 = await fetch(`${baseUrl}/api/v1/projects/${pid}/conversation/sessions/${sid}/stream`, {
      method: 'POST', headers: H, body: JSON.stringify({ message: 'Crée un site pour mon restaurant italien', isModification: false })
    });
    assert.equal(s1.status, 200);
    await s1.text();

    // === RELANCE B1 avec F3 : le client re-soumet le MÊME texte avec
    // isModification:false (au lieu de laisser recalculer true) ===
    const s2 = await fetch(`${baseUrl}/api/v1/projects/${pid}/conversation/sessions/${sid}/stream`, {
      method: 'POST', headers: H, body: JSON.stringify({ message: 'Crée un site pour mon restaurant italien', isModification: false })
    });
    assert.equal(s2.status, 200);
    await s2.text();
    assert.equal(streamCalls, 3, 'tentative 2 = un appel streaming distinct');

    const html = await savedHtml(pid);
    assert.ok(html.includes('MENU-V2'), 'sections de la tentative 2 présentes');
    assert.ok(!html.includes('GALERIE-V1'), 'AUCUNE fusion : les sections de la tentative 1 ne sont pas conservées');
    assert.ok(!html.includes('loremflickr.com'), 'F1 E2E sur la tentative 2');
    const ids = [...html.matchAll(/images\.unsplash\.com\/(photo-[A-Za-z0-9-]+)/g)].map((m) => m[1]!);
    assert.ok(ids.length >= 2);
    for (const id of ids) assert.ok(POOL_RESTO.has(id), 'ID final au réservoir : ' + id);

    const revs = await revisions(pid);
    assert.equal(revs.length, 2, 'deux révisions : tentative 1 ET tentative 2');
    const attempt1 = revs.find((r) => r.files['index.html'] && r.files['index.html'].content.includes('GALERIE-V1'));
    assert.ok(attempt1, 'la tentative 1 reste récupérable (rollback)');
    const attempt2 = revs.find((r) => r.files['index.html'] && r.files['index.html'].content.includes('MENU-V2'));
    assert.ok(attempt2, 'la tentative 2 est la révision courante');
  });
});
