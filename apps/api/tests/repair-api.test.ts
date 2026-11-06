/**
 * Tests ÉTAPE 7 — route Self-Repair bornée (POST /api/v1/projects/:id/repair)
 *
 * Sans clé LLM dans l'environnement de test, la route répond 503 (aucun
 * fournisseur IA) — le test vérifie le garde-fou et le 404 projet inconnu.
 * La boucle complète (diagnosis → patch → validate) est couverte en E2E live.
 */

import './_lot-b-legacy-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
// P1-A — filet images de la réparation : le registre IA est remplacé par un
// adaptateur factice pour rejouer le patch régénéré (URLs hors réservoir).
import { aiProviderRegistry } from '../../../packages/core/src/ai/providers/registry.js';
import type {
  AIProviderAdapter,
  AIProviderGenerateRequest,
  AIProviderGenerateResponse,
} from '../../../packages/core/src/ai/providers/types.js';

const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'studio-local', 'x-user-role': 'ENGINEER' };

describe('ÉTAPE 7 : route Self-Repair', () => {
  let server: Server;
  let baseUrl: string;

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
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('1. refuse un projet inexistant (404)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/proj_inexistant/repair`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ maxIterations: 2 })
    });
    assert.equal(res.status, 404);
  });

  it('2. HTML propre -> 200, aucune réparation nécessaire (diagnosis sans erreurs runtime)', async () => {
    // Crée un projet + un HTML propre via le compte local (fallback dev)
    const create = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ name: 'Étape 7 Repair' })
    });
    assert.equal(create.status, 201);
    const pid = ((await create.json()) as { project: { id: string } }).project.id;

    const put = await fetch(`${baseUrl}/api/v1/projects/${pid}/files/content`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ path: 'index.html', content: '<!DOCTYPE html><html><head><title>OK</title></head><body><h1>Sain</h1></body></html>' })
    });
    assert.equal(put.status, 200);

    const res = await fetch(`${baseUrl}/api/v1/projects/${pid}/repair`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ maxIterations: 2 })
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      repaired: boolean;
      initialScore: number;
      finalScore: number;
      iterations: { action: string }[];
    };
    // Aucune erreur runtime détectée au diagnostic -> aucune réparation lancée
    assert.equal(body.iterations[0]!.action, 'no-repair-needed');
    assert.equal(body.finalScore, body.initialScore);
    assert.equal(body.repaired, true);
  });
});

// ============================================================================
// P1-A — filet images à la sauvegarde du HTML réparé.
// Chromium (réel) fournit les erreurs runtime de la page empoisonnée ; un
// adaptateur IA factice rejoue le patch régénéré contenant des URLs hors
// réservoir (loremflickr, ID Unsplash inventé). Assertions sur le HTML
// RÉELLEMENT sauvegardé, relu via GET /files/content — pas sur des mocks.
// ============================================================================
describe('P1-A : filet images à la sauvegarde du HTML réparé', () => {
  let server: Server;
  let baseUrl: string;

  // Oracles contractuels — pools thématiques de theme.ts (figés volontairement :
  // ce sont ces contenus-là qui doivent être servis pour ces secteurs).
  const P1A_PREFIX = 'https://images.unsplash.com/';
  const P1A_QUAL = '?auto=format&fit=crop&w=1200&q=80';
  // Lot B (17/10) : pool restaurant RENOUVELÉ après planche-contact — le
  // burger/croissant/café ont ruiné la page « restaurant algérien ; les 6
  // plats vérifiés au pixel remplacent. L'oracle suit la table (pizza garde
  // sa place unique pour les pizzerias).
  const RESTAURANT_POOL = [
    'photo-1513104890138-7c749659a591', 'photo-1555939594-58d7cb561ad1',
    'photo-1547592180-85f173990554', 'photo-1540189549336-e6e99c3679fe',
    'photo-1529042410759-befb1204b468', 'photo-1559847844-5315695dadae',
    'photo-1600891964092-4316c288032e',
    'photo-1517244683847-7456b63c5969', 'photo-1517248135467-4c7edcad34c4',
    'photo-1414235077428-338989a2e8c0', 'photo-1490645935967-10de6ba17061',
  ];
  // Lot B (17/10) : le pool clinique absorbe 2 IDs vérifiés (radiographie,
  // praticienne) — variété imposée par le lot ; l'oracle suit la table.
  const CLINIQUE_POOL = [
    'photo-1576091160399-112ba8d25d1d', 'photo-1576091160550-2173dba999ef',
    'photo-1588776814546-1ffcf47267a5', 'photo-1559839734-2b71ea197ec2',
  ];

  /** Adaptateur_IA factice : patch câblé par projet, ou échec forcé (cas E). */
  class ScriptedRepairAdapter {
    public readonly descriptor = {
      providerId: 'fake-repair-p1a',
      providerName: 'Fake Repair (P1-A)',
      models: ['fake-repair-model'],
      capabilities: [] as const,
      contextWindow: 128000,
      structuredOutput: true,
      streaming: false,
      toolCalling: false,
      reasoning: false,
      vision: false,
      costMetadata: {},
      availability: 'AVAILABLE' as const,
      healthStatus: 'HEALTHY' as const
    };

    private canned = new Map<string, string>();
    private failing = new Set<string>();
    private calls = new Map<string, number>();

    public setCanned(projectId: string, html: string): void {
      this.canned.set(projectId, html);
    }

    public failFor(projectId: string): void {
      this.failing.add(projectId);
    }

    public callsFor(projectId: string): number {
      return this.calls.get(projectId) ?? 0;
    }

    public async generate(request: AIProviderGenerateRequest): Promise<AIProviderGenerateResponse> {
      const projectId = request.projectId;
      this.calls.set(projectId, (this.calls.get(projectId) ?? 0) + 1);
      if (this.failing.has(projectId)) throw new Error('Fake repair provider unavailable');
      return {
        text: '```html\n' + (this.canned.get(projectId) ?? '') + '\n```',
        providerId: 'fake-repair-p1a',
        modelId: 'fake-repair-model',
        latencyMs: 1,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        costUsd: 0
      };
    }
  }

  const scripted = new ScriptedRepairAdapter();

  /** Page de départ empoisonnée : erreurs runtime garanties au diagnostic. */
  const poisoned = (title: string, boom: string): string =>
    `<!DOCTYPE html><html><head><title>${title}</title></head><body>` +
    `<script>throw new Error('${boom}-1');</script>` +
    `<script>throw new Error('${boom}-2');</script>` +
    `<script>throw new Error('${boom}-3');</script></body></html>`;

  async function createProject(name: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ name })
    });
    assert.equal(res.status, 201);
    return ((await res.json()) as { project: { id: string } }).project.id;
  }

  async function putIndex(pid: string, html: string): Promise<void> {
    const res = await fetch(`${baseUrl}/api/v1/projects/${pid}/files/content`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ path: 'index.html', content: html })
    });
    assert.equal(res.status, 200);
  }

  /** Lit le HTML RÉELLEMENT sauvegardé (pas l'objet envoyé). */
  async function readIndex(pid: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/v1/projects/${pid}/files/content?path=index.html`, { headers: H });
    assert.equal(res.status, 200);
    return ((await res.json()) as { file: { content: string } }).file.content;
  }

  /** Tous les IDs Unsplash référencés dans un HTML. */
  function unsplashIds(html: string): string[] {
    return [...html.matchAll(/images\.unsplash\.com\/(photo-[A-Za-z0-9-]+)/g)].map((m) => m[1]!);
  }

  before(async () => {
    // Seul fournisseur : le factice (aucune clé dans l'env de test ; unregister-all
    // = convention execution-e2e, garde-fou si MISTRAL_API_KEY traînait dans le shell).
    for (const d of aiProviderRegistry.list()) aiProviderRegistry.unregister(d.providerId);
    aiProviderRegistry.register(scripted as unknown as Parameters<typeof aiProviderRegistry.register>[0]);
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('A+B+D. patch restaurant avec URLs interdites -> sauvegarde nettoyée, replis onerror, pool du thème', async () => {
    const pid = await createProject('Restaurant du Lac — P1A');
    await putIndex(pid, poisoned('Restaurant du Lac', 'P1A-RESTO'));
    // Patch régénéré : 1 interdite (hôte), 1 conforme (pool restaurant), 1 inventée.
    // (images responsive-safe : le gate AQS mesure le débordement mobile — ce
    //  test vise la SANITISATION des src, pas le responsive)
    scripted.setCanned(
      pid,
      `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Restaurant du Lac</title></head><body>` +
      `<img style="max-width:100%;height:auto" src="https://loremflickr.com/1200/800/food?lock=5" alt="hors réservoir">` +
      `<img style="max-width:100%;height:auto" src="${P1A_PREFIX}photo-1513104890138-7c749659a591${P1A_QUAL}" alt="déjà conforme">` +
      `<img style="max-width:100%;height:auto" src="${P1A_PREFIX}photo-999900000009-0000000009aa${P1A_QUAL}" alt="inventée"></body></html>`
    );

    const res = await fetch(`${baseUrl}/api/v1/projects/${pid}/repair`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ maxIterations: 1 })
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { iterations: { action: string }[] };
    assert.equal(body.iterations.length, 1);
    assert.equal(body.iterations[0]!.action, 'patch-applied');
    assert.equal(scripted.callsFor(pid), 1);

    const saved = await readIndex(pid);
    // Cas A — les interdits n'existent plus dans le HTML sauvegardé.
    assert.ok(!saved.includes('loremflickr'), 'URL hors réservoir doit être réécrite');
    assert.ok(!saved.includes('photo-999900000009'), 'ID Unsplash inventé doit être réécrit');
    // Cas C — l'image déjà conforme est intacte (src exactement conservé).
    assert.ok(saved.includes(`${P1A_PREFIX}photo-1513104890138-7c749659a591${P1A_QUAL}`), 'image conforme détériorée');
    assert.ok(!saved.includes('picsum.photos'), 'aucun repli générique quand le pool existe');
    // Cas D — le thème du projet a bien été transmis au traitement : IDs du pool restaurant.
    const ids = unsplashIds(saved);
    assert.ok(ids.length >= 3, 'les 3 images du patch produisent des IDs vérifiés');
    for (const id of ids) {
      assert.ok(RESTAURANT_POOL.includes(id), `ID ${id} hors pool restaurant`);
    }
    // Cas B — repli onerror présent sur chaque <img>, format exact, cible dans le pool.
    const tags = [...saved.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    assert.equal(tags.length, 3);
    for (const tag of tags) {
      const m = /onerror="this\.onerror=null;this\.src='https:\/\/images\.unsplash\.com\/(photo-[A-Za-z0-9-]+)\?auto=format&fit=crop&w=1200&q=80'"/.exec(tag);
      assert.ok(m, `onerror de repli manquant ou mal formaté : ${tag}`);
      assert.ok(RESTAURANT_POOL.includes(m[1]!), 'cible du repli onerror hors pool restaurant');
    }
  });

  it("D. même patch empoisonné sur une clinique -> pool clinique (pas d'ID restaurant : traitement non constant)", async () => {
    const pid = await createProject('Clinique Saint-Louis — P1A');
    await putIndex(pid, poisoned('Clinique Saint-Louis', 'P1A-CLINI'));
    scripted.setCanned(
      pid,
      `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Clinique Saint-Louis</title></head><body>` +
      `<img style="max-width:100%;height:auto" src="https://loremflickr.com/1200/800/clinic?lock=7" alt="hors réservoir">` +
      `<img style="max-width:100%;height:auto" src="${P1A_PREFIX}photo-1576091160399-112ba8d25d1d${P1A_QUAL}" alt="déjà conforme">` +
      `<img style="max-width:100%;height:auto" src="${P1A_PREFIX}photo-888800000008-0000000008bb${P1A_QUAL}" alt="inventée"></body></html>`
    );

    const res = await fetch(`${baseUrl}/api/v1/projects/${pid}/repair`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ maxIterations: 1 })
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { iterations: { action: string }[] };
    assert.equal(body.iterations[0]!.action, 'patch-applied');

    const saved = await readIndex(pid);
    assert.ok(!saved.includes('loremflickr'));
    const ids = unsplashIds(saved);
    assert.ok(ids.length >= 2, 'les images interdites ont été réécrites');
    for (const id of ids) {
      assert.ok(CLINIQUE_POOL.includes(id), `ID ${id} hors pool clinique`);
      assert.ok(!RESTAURANT_POOL.includes(id), 'ID restaurant servi pour une clinique — thème constant ?');
    }
  });

  it("E. échec du fournisseur IA -> HTML de départ conservé, action patch-failed, rien d'empoisonné de sauvegardé", async () => {
    const pid = await createProject('Atelier P1A — échec fournisseur');
    await putIndex(pid, poisoned('Atelier Céramique', 'P1A-FAIL'));
    scripted.failFor(pid);

    const res = await fetch(`${baseUrl}/api/v1/projects/${pid}/repair`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ maxIterations: 1 })
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { iterations: { action: string }[] };
    assert.equal(body.iterations[0]!.action, 'patch-failed');
    assert.equal(scripted.callsFor(pid), 1);

    const saved = await readIndex(pid);
    assert.ok(saved.includes('P1A-FAIL-1'), 'le HTML de départ doit être conservé inchangé');
    assert.ok(!saved.includes('loremflickr'), 'aucun contenu d\'un patch jamais sauvegardé en cas d\'échec');
  });
});
