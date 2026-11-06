/**
 * ÉTAPE 52 Phase 2B — DNA au premier rendu : diversité prouvée.
 *
 * Le prompt de CRÉATION exige désormais, en première ligne de la réponse LLM,
 * un bloc <!-- DESIGN_DNA: {json} --> (palette + police + mode). Ce bloc est
 * capté côté serveur, retiré du HTML et appliqué au shell.
 *
 * Preuve de bout en bout SANS réseau : un provider IA factice (enregistré
 * avant la création du serveur) renvoie, pour 3 prompts différents, 3
 * réponses avec 3 empreintes DNA différentes — le HTML sauvegardé doit
 * refléter chacune (polices et palettes distinctes, bloc jamais visible).
 *
 * La modification n'est pas concernée : l'identité d'un projet reste figée
 * après sa création (anti-drift É42).
 */

import './_lot-b-legacy-env.js';

process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { aiProviderRegistry, type AIProviderAdapter, type AIProviderGenerateRequest, type AIProviderGenerateResponse } from '../../../packages/core/src/ai/providers/index.js';

interface DnaFixture {
  palette: { bg: string; fg: string; accent: string };
  font: string;
  mode: string;
  theme: string;
}

const FIXTURES: Array<{ cue: string; dna: DnaFixture; siteName: string }> = [
  {
    cue: 'boulangerie',
    dna: { palette: { bg: '#fff8f0', fg: '#3b2a1e', accent: '#d97706' }, font: 'Fraunces', mode: 'light', theme: 'boulangerie' },
    siteName: 'Boulangerie du Coin'
  },
  {
    cue: 'portfolio',
    dna: { palette: { bg: '#ffffff', fg: '#111111', accent: '#111111' }, font: 'Playfair Display', mode: 'light', theme: 'portfolio' },
    siteName: 'Portfolio Photographe'
  },
  {
    cue: 'crypto',
    dna: { palette: { bg: '#0b1220', fg: '#e2e8f0', accent: '#38bdf8' }, font: 'Space Grotesk', mode: 'dark', theme: 'crypto' },
    siteName: 'CryptoPulse'
  }
];

function dnaComment(dna: DnaFixture): string {
  return `<!-- DESIGN_DNA: ${JSON.stringify({ palette: dna.palette, font: dna.font, mode: dna.mode })} -->`;
}

function cannedResponse(dna: DnaFixture, siteName: string): string {
  return `${dnaComment(dna)}
Salut ! Je te construis ${siteName} avec l'ambiance ${dna.theme}. Header, Hero, Footer, c'est parti !

<SECTION name="header">
Je commence par le Header.
<header class="bg-[${dna.palette.bg}]"><h1 class="text-[${dna.palette.accent}]">${siteName}</h1></header>
</SECTION>

<SECTION name="hero">
Ensuite le Hero.
<section class="p-8"><h2 style="color:${dna.palette.fg}">Bienvenue</h2></section>
</SECTION>

Voilà, ${siteName} est prêt !`;
}

describe('ÉTAPE 52 Phase 2B — Design DNA au premier rendu (diversité prouvée)', () => {
  let server: Server;
  let baseUrl: string;
  const tenant = 'tenant_e52p2b';
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'x-tenant-id': tenant, 'x-user-role': 'ENGINEER' };

  // Capture des systemPrompt reçus par le provider (preuve d'injection)
  const receivedSystemPrompts: string[] = [];

  before(async () => {
    // Provider factice : renvoie la réponse canned correspondant au prompt,
    // et mémorise les systemPrompt pour prouver l'injection des consignes DNA.
    const fakeAdapter = {
      descriptor: {
        providerId: 'fake-dna-e52',
        providerName: 'Fake DNA E52',
        models: ['fake-dna-model'],
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
      generate: async (_request: AIProviderGenerateRequest): Promise<AIProviderGenerateResponse> => {
        return { text: '', modelId: 'fake-dna-model', finishReason: 'STOP' } as unknown as AIProviderGenerateResponse;
      },
      generateStream: async function* (request: AIProviderGenerateRequest): AsyncIterable<string> {
        receivedSystemPrompts.push(request.systemPrompt || '');
        const fixture = FIXTURES.find((f) => (request.prompt || '').includes(f.cue)) ?? FIXTURES[0]!;
        // Stream ligne par ligne : le parseur conversationnel travaille par
        // chunk (comme un vrai LLM token par token)
        for (const line of cannedResponse(fixture.dna, fixture.siteName).split('\n')) {
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

  it('le prompt de CRÉATION exige l empreinte DNA — et pas le mode modification', async () => {
    // Déclenche au moins une génération pour capturer les systemPrompt réels
    const pres = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST', headers, body: JSON.stringify({ name: 'E52 capture prompt' })
    });
    const pid = ((await pres.json()) as { project?: { id?: string } }).project!.id!;
    const sessRes = await fetch(`${baseUrl}/api/v1/projects/${pid}/conversation/sessions`, { method: 'POST', headers });
    const sessionId = ((await sessRes.json()) as { session?: { id?: string } }).session!.id!;
    const streamRes = await fetch(`${baseUrl}/api/v1/projects/${pid}/conversation/sessions/${sessionId}/stream`, {
      method: 'POST', headers,
      body: JSON.stringify({ message: 'Crée un site boulangerie pour Boulangerie du Coin', isModification: false })
    });
    assert.equal(streamRes.status, 200);
    await streamRes.text();

    // Preuve par capture : le systemPrompt RÉELLEMENT envoyé au LLM contient
    // la consigne DNA (et le prompt de modification source ne la contient pas)
    assert.ok(receivedSystemPrompts.length > 0, 'au moins un appel provider capturé');
    assert.ok(receivedSystemPrompts.every((p) => p.includes('DESIGN_DNA')), 'le systemPrompt de création porte la consigne DNA');
    assert.match(receivedSystemPrompts[0]!, /PREMIÈRE LIGNE/, 'la consigne exige le bloc en première ligne');

    // Vérification source : la modification ne régénère pas la DNA
    const served = readFileSync(resolve(process.cwd(), 'apps/api/src/routes/conversation.ts'), 'utf8');
    const modificationBlock = served.slice(
      served.indexOf('const modificationSystemPrompt'),
      served.indexOf('const systemPrompt = isModificationMode')
    );
    assert.doesNotMatch(modificationBlock, /DESIGN_DNA/, 'la modification ne régénère pas la DNA (identité figée)');
  });

  it('3 prompts différents → 3 identités distinctes appliquées au HTML sauvegardé', async () => {
    const results: Array<{ font: string; bg: string }> = [];
    for (const fixture of FIXTURES) {
      const pres = await fetch(`${baseUrl}/api/v1/projects`, {
        method: 'POST', headers, body: JSON.stringify({ name: 'E52 ' + fixture.dna.theme })
      });
      const pid = ((await pres.json()) as { project?: { id?: string } }).project!.id!;
      // Nouveau projet vide → mode création explicite (le fichier auto-créé est écrasé)
      const sessRes = await fetch(`${baseUrl}/api/v1/projects/${pid}/conversation/sessions`, { method: 'POST', headers });
      const sessionId = ((await sessRes.json()) as { session?: { id?: string } }).session!.id!;
      const streamRes = await fetch(`${baseUrl}/api/v1/projects/${pid}/conversation/sessions/${sessionId}/stream`, {
        method: 'POST', headers,
        body: JSON.stringify({ message: `Crée un site ${fixture.dna.theme} pour ${fixture.siteName}`, isModification: false })
      });
      assert.equal(streamRes.status, 200);
      await streamRes.text(); // consomme le flux SSE jusqu'à la fin

      // Le HTML sauvegardé porte l'identité de SA DNA (et jamais une autre)
      const fileRes = await fetch(`${baseUrl}/api/v1/projects/${pid}/files/content?path=index.html`, { headers });
      assert.equal(fileRes.status, 200);
      const html = ((await fileRes.json()) as { file: { content: string } }).file.content;

      assert.ok(html.includes(`family=${fixture.dna.font.replace(/\s+/g, '+')}`), `police ${fixture.dna.font} chargée`);
      assert.ok(html.includes(`background-color: ${fixture.dna.palette.bg}`), `fond ${fixture.dna.palette.bg} appliqué`);
      assert.ok(html.includes(`color: ${fixture.dna.palette.fg}`), 'couleur texte appliquée');
      assert.ok(html.includes(`text-[${fixture.dna.palette.accent}]`), "l'accent est réutilisé dans les sections (contrainte respectée)");
      assert.ok(!html.includes('DESIGN_DNA'), 'aucun bloc DNA résiduel dans le HTML servi');
      assert.ok(html.includes(fixture.siteName), 'le contenu du site est présent');
      results.push({ font: fixture.dna.font, bg: fixture.dna.palette.bg });
    }
    // Diversité prouvée mécaniquement : 3 identités toutes différentes
    const fonts = new Set(results.map((r) => r.font));
    const bgs = new Set(results.map((r) => r.bg));
    assert.equal(fonts.size, 3, '3 polices distinctes');
    assert.equal(bgs.size, 3, '3 fonds distincts');
  });
});
