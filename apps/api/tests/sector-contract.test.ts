/**
 * PATCH — CONTRAT DE THÈME GLOBAL : le secteur détecté devient une contrainte
 * explicite pour TOUT le site (palette, typo, rédaction, structure), pas
 * seulement pour les images.
 *
 * Preuves exigées : transmission réelle des contraintes (faux adaptateur
 * streaming + serveur réel, même harnais que design-dna-e52p2b), jamais une
 * simple recherche de chaîne. Aucun appel IA payant (canned responses).
 *
 * Limite avouée : ces tests prouvent la TRANSMISSION des contraintes, pas
 * leur respect visuel dans une génération réelle (pas de vision ici).
 */
import './_lot-b-legacy-env.js';

process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { aiProviderRegistry, type AIProviderAdapter, type AIProviderGenerateRequest, type AIProviderGenerateResponse } from '../../../packages/core/src/ai/providers/index.js';
import { buildRegeneratePrompts } from '../src/routes/conversation.js';
import { buildRepairPrompts } from '../src/routes/repair.js';
import { buildImageBrief, buildSectorContract, THEME_IMAGE_RESOURCES } from '../../../packages/core/src/image/theme.js';

const H = (tenant: string) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'x-tenant-id': tenant,
  'x-user-role': 'ENGINEER'
});

// Réponses canned au format <SECTION> (le parseur serveur travaille par chunk,
// comme un vrai flux token par token).
const CANNED_CREATE = `Salut ! Je construis ton restaurant.
<SECTION name="header">
Header posé.
<header><h1>Risto Test</h1></header>
</SECTION>
<SECTION name="hero">
Hero posé.
<section><h2>Bienvenue</h2><img src="https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=1200&q=80" alt="pizza"></section>
</SECTION>
Voilà, c'est prêt !`;

const CANNED_MODIFY = `OK, je passe le bouton en bleu.
<SECTION name="hero" mode="modify">
Hero modifié.
<section><h2>Garage Moderne</h2><button>OK</button></section>
</SECTION>
Voilà !`;

const FIXED_REPAIR_HTML = '<!DOCTYPE html><html><head><title>Garage Moderne</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><h1>Réparé</h1><p>Contenu sain sans erreur.</p></body></html>';

describe('PATCH secteur : contrat global transmis au fournisseur (stream HTTP)', () => {
  let server: Server;
  let baseUrl: string;
  const tenant = 'tenant_sector';
  const headers = H(tenant);
  const receivedSystemPrompts: string[] = [];
  const receivedGeneratePrompts: string[] = [];

  async function newProject(name: string): Promise<string> {
    const pres = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST', headers, body: JSON.stringify({ name })
    });
    assert.equal(pres.status, 201);
    return (((await pres.json()) as { project?: { id?: string } }).project!.id!);
  }

  async function newSession(pid: string): Promise<string> {
    const sessRes = await fetch(`${baseUrl}/api/v1/projects/${pid}/conversation/sessions`, { method: 'POST', headers });
    assert.equal(sessRes.status, 201);
    return (((await sessRes.json()) as { session?: { id?: string } }).session!.id!);
  }

  async function runStream(pid: string, sid: string, message: string, isModification: boolean): Promise<void> {
    const streamRes = await fetch(`${baseUrl}/api/v1/projects/${pid}/conversation/sessions/${sid}/stream`, {
      method: 'POST', headers,
      body: JSON.stringify({ message, isModification })
    });
    assert.equal(streamRes.status, 200);
    await streamRes.text();
  }

  async function savedHtml(pid: string): Promise<string> {
    const fileRes = await fetch(`${baseUrl}/api/v1/projects/${pid}/files/content?path=index.html`, { headers });
    assert.equal(fileRes.status, 200);
    return (((await fileRes.json()) as { file: { content: string } }).file.content);
  }

  before(async () => {
    const fakeAdapter = {
      descriptor: {
        providerId: 'fake-sector',
        providerName: 'Fake Sector',
        models: ['fake-sector-model'],
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
      generate: async (request: AIProviderGenerateRequest): Promise<AIProviderGenerateResponse> => {
        receivedGeneratePrompts.push(request.systemPrompt || '');
        return { text: FIXED_REPAIR_HTML, modelId: 'fake-sector-model', finishReason: 'STOP' } as unknown as AIProviderGenerateResponse;
      },
      generateStream: async function* (request: AIProviderGenerateRequest): AsyncIterable<string> {
        receivedSystemPrompts.push(request.systemPrompt || '');
        const canned = (request.prompt || '').includes('MODIFICATION CHIRURGICALE') || (request.prompt || '').includes('mode="modify"') || (request.prompt || '').includes('Demande de modification')
          ? CANNED_MODIFY
          : CANNED_CREATE;
        for (const line of canned.split('\n')) {
          yield line + '\n';
        }
      }
    } as unknown as AIProviderAdapter;

    aiProviderRegistry.register(fakeAdapter);

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
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('1. création restaurant : SECTEUR GLOBAL + brief images transmis, sections sauvegardées', async () => {
    const before = receivedSystemPrompts.length;
    const pid = await newProject('Sector resto');
    const sid = await newSession(pid);
    await runStream(pid, sid, 'Crée un site pour mon restaurant italien', false);
    assert.ok(receivedSystemPrompts.length > before, 'au moins un appel provider capturé');
    const sys = receivedSystemPrompts[receivedSystemPrompts.length - 1]!;
    assert.match(sys, /SECTEUR GLOBAL/, 'bloc sectoriel présent dans le prompt transmis');
    assert.match(sys, /Réserver une table/, 'CTA restaurant transmis');
    assert.match(sys, /Bella Italia/, 'contre-exemple présent (biais neutralisé explicitement)');
    assert.match(sys, /RÉSERVOIR vérifié/, 'brief images P0 présent et cohérent');
    for (const id of THEME_IMAGE_RESOURCES.restaurant.unsplash.slice(0, 3)) {
      assert.ok(sys.includes(id), 'ID restaurant imposé transmis : ' + id);
    }
    const html = await savedHtml(pid);
    assert.ok(html.includes('data-section="header"'), 'marqueurs parsés et sauvegardés');
    assert.ok(html.includes('data-section="hero"'), 'sections fusionnées');
  });

  it('2. thème autre : contrat neutre sectoriellement + réservoir d\'ambiance T0.5', async () => {
    const before = receivedSystemPrompts.length;
    const pid = await newProject('Sector neutre');
    const sid = await newSession(pid);
    await runStream(pid, sid, 'change le header en vert', false);
    const sys = receivedSystemPrompts[receivedSystemPrompts.length - 1]!;
    assert.ok(receivedSystemPrompts.length > before, 'appel capturé');
    assert.match(sys, /Contrat neutre/, 'contrat neutre transmis');
    // neutre = rien d'imposé côté secteur (le contre-exemple Bella Italia
    // reste cité comme ce qu'il NE faut PAS faire — pas comme direction) ;
    // T0.5 : les SEULES URLs transmises sont le réservoir d'ambiance neutre.
    const ids = [...sys.matchAll(/photo-[0-9a-z-]+/gi)].map((m) => m[0]);
    const poolAutre = new Set(THEME_IMAGE_RESOURCES.autre.unsplash);
    for (const id of ids) assert.ok(poolAutre.has(id), 'ID non T0.5 transmis : ' + id);
    assert.ok(!sys.includes('Réserver une table'), 'aucun CTA sectoriel imposé');
    assert.ok(!sys.includes('Demander un devis'), 'aucun CTA sectoriel imposé');
  });

  it('3. modification : préservation du thème existant (titre en contexte)', async () => {
    const pid = await newProject('Sector garage');
    await fetch(`${baseUrl}/api/v1/projects/${pid}/files/content`, {
      method: 'PUT', headers,
      body: JSON.stringify({
        path: 'index.html',
        content: '<!DOCTYPE html><html><head><title>Garage Moderne</title></head><body><div class="vibe-stitched" data-section="hero"><section><h1>Garage</h1></section></div></body></html>'
      })
    });
    const before = receivedSystemPrompts.length;
    const sid = await newSession(pid);
    await runStream(pid, sid, 'passe le bouton du hero en bleu', true);
    const sys = receivedSystemPrompts[receivedSystemPrompts.length - 1]!;
    assert.ok(receivedSystemPrompts.length > before, 'appel capturé');
    assert.match(sys, /conserve l’identité visuelle existante/, 'rappel de préservation transmis');
    assert.match(sys, /garage automobile/, 'thème déduit du titre existant');
  });

  it('4. réparation : prompt transmis avec contrat du titre existant + fichier corrigé', async () => {
    const pid = await newProject('Sector repair');
    const seedHtml = '<!DOCTYPE html><html><head><title>Garage Moderne</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><h1>Garage</h1><script>throw new Error(\'boom-sector-test\');</script></body></html>';
    const put = await fetch(`${baseUrl}/api/v1/projects/${pid}/files/content`, {
      method: 'PUT', headers,
      body: JSON.stringify({ path: 'index.html', content: seedHtml })
    });
    assert.equal(put.status, 200);
    const before = receivedGeneratePrompts.length;
    const rep = await fetch(`${baseUrl}/api/v1/projects/${pid}/repair`, {
      method: 'POST', headers, body: JSON.stringify({ maxIterations: 1 })
    });
    assert.equal(rep.status, 200);
    const body = (await rep.json()) as { iterations?: Array<{ action?: string }> };
    assert.ok(receivedGeneratePrompts.length > before, 'patch LLM appelé (erreur runtime diagnostiquée)');
    const sys = receivedGeneratePrompts[receivedGeneratePrompts.length - 1]!;
    assert.match(sys, /SECTEUR GLOBAL/, 'contrat transmis au patch de réparation');
    assert.match(sys, /garage automobile/, 'thème déduit du titre existant');
    assert.ok((body.iterations || []).some((i) => i.action === 'patch-applied'), 'patch conservé (score amélioré)');
    const html = await savedHtml(pid);
    assert.ok(!html.includes('boom-sector-test'), 'erreur corrigée dans le fichier sauvegardé');
    assert.ok(html.includes('Réparé'), 'contenu du patch sauvegardé');
  });
});

describe('PATCH secteur : prompts purs de régénération post-plan', () => {
  it('5. create : secteur + brief images dans le prompt transmis', () => {
    const r = buildRegeneratePrompts('Crée un site pour ma clinique dentaire', '<html></html>', 'Plan résumé');
    assert.equal(r.isModification, false);
    assert.equal(r.imageTheme, 'clinique');
    assert.match(r.systemPrompt, /SECTEUR GLOBAL/);
    assert.match(r.systemPrompt, /Rendez-vous| rendez-vous /, 'CTA clinique transmis');
    assert.match(r.systemPrompt, /RÉSERVOIR vérifié/);
    assert.match(r.userPrompt, /Génère l'application complète/);
  });

  it('6. modify : préservation + recopie exigées, thème du titre', () => {
    const r = buildRegeneratePrompts(
      'ajoute un bouton',
      '<html><head><title>Hôtel Riviera</title></head><body>' + 'x'.repeat(300) + '</body></html>',
      'Plan résumé'
    );
    assert.equal(r.isModification, true);
    assert.equal(r.imageTheme, 'hotel');
    assert.match(r.systemPrompt, /conserve l’identité visuelle existante/);
    assert.match(r.systemPrompt, /recopie/i);
  });
});

describe('PATCH secteur : prompts purs de réparation', () => {  it('7. buildRepairPrompts : contrat du titre + préservation, jamais de secteur imposé sans preuve', () => {
    const r = buildRepairPrompts(
      '<html><head><title>Hôtel Riviera</title></head><body>' + 'x'.repeat(150) + '</body></html>',
      ['ReferenceError: foo is not defined']
    );
    assert.equal(r.imageTheme, 'hotel');
    assert.match(r.systemPrompt, /SECTEUR GLOBAL/);
    assert.match(r.systemPrompt, /conserve l’identité visuelle existante/);
    assert.match(r.systemPrompt, /RÉSERVOIR vérifié/);
    assert.match(r.userPrompt, /Erreurs runtime observées/);
    assert.match(r.userPrompt, /foo is not defined/);
  });

  it('8. buildRepairPrompts : titre inconnu → contrat neutre', () => {
    const r = buildRepairPrompts('<html><head><title>Mon Site</title></head><body></body></html>', ['Error: x']);
    assert.equal(r.imageTheme, 'autre');
    assert.match(r.systemPrompt, /Contrat neutre/);
  });
});

describe('PATCH secteur : contenu du contrat (pur)', () => {
  it('9. six contraintes concrètes + contre-exemple Bella Italia', () => {
    const c = buildSectorContract('garage', 'create');
    for (const n of ['1. Palette', '2. Typographie', '3. Rédaction', '4. Structure', '5. Images', '6. ']) {
      assert.ok(c.includes(n), 'contrainte présente : ' + n.trim());
    }
    assert.match(c, /Bella Italia/);
    assert.match(c, /Demander un devis/);
  });

  it('10. sections compatibles avec l’ordre canonique', () => {
    assert.match(buildSectorContract('restaurant', 'create'), /reservation/);
    assert.match(buildSectorContract('saas', 'create'), /tarifs/);
  });

  it('11. autre = neutre sectoriellement, avec réservoir d\'ambiance T0.5 uniquement', () => {
    const c = buildSectorContract('autre', 'create');
    assert.match(c, /Contrat neutre/);
    // neutre = aucune palette/code sectoriel imposée (le contre-exemple
    // Bella Italia reste cité comme ce qu'il NE faut PAS faire — pas comme
    // direction). Depuis T0.5, les SEULES URLs imposées sont le réservoir
    // d'ambiance neutre (quelconques par construction — pas de code métier) :
    assert.ok(!c.match(/#[0-9a-f]{6}/i), 'aucune palette imposée');
    assert.ok(!c.includes('Réserver une table'), 'aucun CTA sectoriel imposé');
    assert.ok(!c.includes('Demander un devis'), 'aucun CTA sectoriel imposé');
    const ids = [...c.matchAll(/photo-[0-9a-z-]+/gi)].map((m) => m[0]);
    assert.equal(ids.length, 0, 'le contrat neutre ne cite aucun ID : le réservoir T0.5 est véhiculé par le brief IMAGES (test 11b + test 5)');
    const brief = buildImageBrief('autre', 'create');
    assert.match(brief, /RÉSERVOIR vérifié/, 'le réservoir d\'ambiance est transmis via le bloc IMAGES');
    const idsBrief = [...brief.matchAll(/photo-[0-9a-z-]+/gi)].map((m) => m[0]);
    assert.ok(idsBrief.length >= 12, '12 images d\'ambiance imposées par le brief');
    const poolAutre = new Set(THEME_IMAGE_RESOURCES.autre.unsplash);
    for (const id of idsBrief) assert.ok(poolAutre.has(id), 'ID non T0.5 dans un contrat neutre : ' + id);
  });
});
