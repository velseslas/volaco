/**
 * CLOTURE-LLM — synthèse de fin rédigée + suggestions contextuelles.
 *
 * 1. parseClosingJson : JSON valide, JSON entouré de texte, JSON invalide,
 *    résumé trop court, suggestions dédoublonnées et bornées à 3.
 * 2. generateClosing : succès, erreur du fournisseur, timeout → null.
 * 3. Flux /stream de bout en bout (Mistral simulé) : la frame « closing »
 *    arrive APRÈS « done » ; avec JSON valide → source « llm » ; sinon
 *    repli déterministe → source « fallback ».
 */
import './_lot-b-legacy-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { parseClosingJson, generateClosing, buildClosingUserPrompt } from '../src/routes/conversation.js';

process.env.MISTRAL_API_KEY = 'test-key-closing';

const FENCE = String.fromCharCode(96).repeat(3);
const FACTS = { request: 'Passe le bouton en bleu', mode: 'modify' as const, sections: [{ name: 'hero', mode: 'modify' }], gateScore: 88, findings: ['Contraste faible sur le titre'] };

describe('CLOTURE-LLM — parseClosingJson', () => {
  it('accepte un JSON valide', () => {
    const r = parseClosingJson('{"summary":"Le bouton principal est maintenant bleu et cohérent avec ta palette.","suggestions":["Ajouter un effet au survol","Changer la police du titre","Améliorer le mobile"]}');
    assert.ok(r);
    assert.equal(r!.suggestions.length, 3);
  });
  it('accepte un JSON entouré de texte ou de clôtures', () => {
    const r = parseClosingJson('Voici :\n' + FENCE + 'json\n{"summary":"Ton site a maintenant une section avis clients claire.","suggestions":["Ajouter une FAQ","Ajouter un formulaire"]}\n' + FENCE);
    assert.ok(r);
    assert.equal(r!.suggestions.length, 2);
  });
  it('refuse un JSON invalide, un résumé trop court ou absent', () => {
    assert.equal(parseClosingJson('pas du json'), null);
    assert.equal(parseClosingJson('{"summary":"ok","suggestions":[]}'), null);
    assert.equal(parseClosingJson('{"suggestions":["a b c"]}'), null);
    assert.equal(parseClosingJson('{"summary":42}'), null);
  });
  it('dédoublonne, ignore les valeurs invalides et borne à 3', () => {
    const r = parseClosingJson('{"summary":"Une synthèse suffisamment longue pour être acceptée.","suggestions":["Ajouter une FAQ","ajouter une faq",42,"x","Changer la palette","Ajouter un blog","Une quatrième idée"]}');
    assert.deepEqual(r!.suggestions, ['Ajouter une FAQ', 'Changer la palette', 'Ajouter un blog']);
  });
});

describe('CLOTURE-LLM — generateClosing', () => {
  it('retourne la synthèse quand le fournisseur répond', async () => {
    const r = await generateClosing(async () => '{"summary":"Le bouton est bleu et le reste de la page est intact.","suggestions":["Ajouter un survol","Changer le pied de page"]}', FACTS);
    assert.ok(r);
  });
  it('retourne null si le fournisseur échoue', async () => {
    assert.equal(await generateClosing(async () => { throw new Error('HTTP 500'); }, FACTS), null);
  });
  it('retourne null au timeout (sans bloquer)', async () => {
    const t0 = Date.now();
    const r = await generateClosing(() => new Promise<string>(() => { /* ne répond jamais */ }), FACTS, 50);
    assert.equal(r, null);
    assert.ok(Date.now() - t0 < 1000);
  });
  it('le prompt contient les faits réels (demande, sections, constats)', () => {
    const p = buildClosingUserPrompt(FACTS);
    assert.match(p, /bouton en bleu/);
    assert.match(p, /hero \(modify\)/);
    assert.match(p, /Contraste faible/);
  });
});

describe('CLOTURE-LLM — flux /stream de bout en bout', () => {
  let server: Server;
  let baseUrl: string;
  let closingJson = '';
  const realFetch = globalThis.fetch;
  const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'closing-t1', 'x-user-role': 'OWNER' };
  // É53 LOT B — le fragment dégénéré d'origine (« <h1>Salut</h1> », ~60
  // caractères) est sous le seuil de document viable (>100) : avec l'autorité
  // de vérité, ce flux n'écrit RIEN (done updated:false, sans closing). Pour
  // tester l'objet réel de cette suite (closing « llm » vs « fallback » APRÈS
  // done), le mock produit une création viable qui passe le seuil, se
  // persiste, et déclenche la clôture.
  const SSE = 'data: {"choices":[{"delta":{"content":"<SECTION name=\\"hero\\" mode=\\"create\\"><h1>Bienvenue</h1><p>Une page d\'accueil claire et chaleureuse pour vos visiteurs, avec un message direct dès l\'arrivée.</p>"}}]}\n\n' + 'data: {"choices":[{"delta":{"content":"</SECTION>"}}]}\n\n' + 'data: [DONE]\n\n';

  before(async () => {
    globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
      let wantsStream = true;
      try { wantsStream = JSON.parse(String(init?.body ?? '{}')).stream === true; } catch { /* défaut : flux */ }
      if (wantsStream) return new Response(SSE, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: closingJson } }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => { server.listen(0, () => { baseUrl = 'http://127.0.0.1:' + (server.address() as AddressInfo).port; resolve(); }); });
  });
  after(async () => {
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
  });

  async function run(message: string): Promise<{ types: string[]; closing: Record<string, unknown> | null; done: Record<string, unknown> | null }> {
    const p = await realFetch(baseUrl + '/api/v1/projects', { method: 'POST', headers: H, body: JSON.stringify({ name: 'closing' }) });
    const pj = (await p.json()) as { project: { id: string } };
    const s = await realFetch(baseUrl + '/api/v1/projects/' + pj.project.id + '/conversation/sessions', { method: 'POST', headers: H, body: '{}' });
    const sj = (await s.json()) as { session: { sessionId: string } };
    const res = await realFetch(baseUrl + '/api/v1/projects/' + pj.project.id + '/conversation/sessions/' + sj.session.sessionId + '/stream', { method: 'POST', headers: { ...H, Accept: 'text/event-stream' }, body: JSON.stringify({ message }) });
    const out = { types: [] as string[], closing: null as Record<string, unknown> | null, done: null as Record<string, unknown> | null };
    const text = await res.text();
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      try {
        const ev = JSON.parse(line.slice(5).trim()) as { type: string };
        out.types.push(ev.type);
        if (ev.type === 'closing') out.closing = ev as unknown as Record<string, unknown>;
        if (ev.type === 'done') out.done = ev as unknown as Record<string, unknown>;
      } catch { /* ignore */ }
    }
    return out;
  }

  it('JSON valide → closing source « llm », émise après done', async () => {
    closingJson = '{"summary":"J\'ai posé un en-tête de bienvenue clair, il donne le ton dès l\'arrivée sur la page.","suggestions":["Ajouter un bouton principal","Choisir une palette chaude","Ajouter une section avis"]}';
    const out = await run('Crée une page de bienvenue');
    assert.ok(out.done && out.closing, 'done et closing reçus');
    assert.equal(out.done!['closingPending'], true);
    assert.ok(out.types.indexOf('closing') > out.types.indexOf('done'), 'closing après done');
    assert.equal(out.closing!['source'], 'llm');
    assert.match(String(out.closing!['closingMessage']), /en-tête de bienvenue/);
    assert.deepEqual(out.closing!['suggestions'], ['Ajouter un bouton principal', 'Choisir une palette chaude', 'Ajouter une section avis']);
  });

  it('réponse invalide du fournisseur → closing source « fallback » (textes déterministes)', async () => {
    closingJson = 'désolé, pas de JSON ici';
    const out = await run('Crée une page de bienvenue');
    assert.ok(out.closing);
    assert.equal(out.closing!['source'], 'fallback');
    assert.match(String(out.closing!['closingMessage']), /C'est en place/);
    assert.equal((out.closing!['suggestions'] as string[]).length, 3);
  });
});
