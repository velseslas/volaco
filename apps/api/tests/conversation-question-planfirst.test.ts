/**
 * FIX-QUESTION + FIX-PLANFIRST — non-régression du flux conversationnel.
 *
 * 1. Une QUESTION pure obtient une réponse texte SANS générer de page
 *    (done.updated === false, aucune section, aucun fichier écrit).
 * 2. Une demande de construction ("Crée...") garde le chemin génération
 *    (sections + done.updated === true).
 * 3. Le stream planFirst persiste le plan : POST /confirm répond 200
 *    (avant : 400 "Plan introuvable ou non actif").
 *
 * Le fetch global est remplacé par un double : seul l'appel serveur →
 * Mistral le traverse (SSE simulé) ; les requêtes du test utilisent le
 * fetch réel. MISTRAL_API_KEY=test-key force la préférence mistral.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';

process.env.MISTRAL_API_KEY = 'test-key-conv-audit';

describe('CONV Régression : question vs construction + planFirst confirmable', () => {
  let server: Server;
  let baseUrl: string;
  let sseBody = '';
  const realFetch = globalThis.fetch;
  const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'conv-reg-t1', 'x-user-role': 'OWNER' };

  before(async () => {
    // Ordre critique : le mock doit être installé AVANT createApiServer,
    // car MistralProviderAdapter capture `fetch` à sa construction
    // (bootstrap du registre). Les requêtes du test utilisent realFetch.
    globalThis.fetch = (async () => {
      return new Response(sseBody, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }) as typeof fetch;
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
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  async function setupProject(): Promise<{ projectId: string; sessionId: string }> {
    const p = await realFetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST', headers: H, body: JSON.stringify({ name: 'conv-reg' })
    });
    const pj = (await p.json()) as { project: { id: string } };
    const s = await realFetch(`${baseUrl}/api/v1/projects/${pj.project.id}/conversation/sessions`, {
      method: 'POST', headers: H, body: '{}'
    });
    const sj = (await s.json()) as { session: { sessionId: string } };
    return { projectId: pj.project.id, sessionId: sj.session.sessionId };
  }

  async function collectStream(projectId: string, sessionId: string, body: unknown): Promise<{ status: number; types: string[]; done: Record<string, unknown> | null; chatText: string }> {
    const res = await realFetch(
      `${baseUrl}/api/v1/projects/${projectId}/conversation/sessions/${sessionId}/stream`,
      { method: 'POST', headers: { ...H, Accept: 'text/event-stream' }, body: JSON.stringify(body) }
    );
    const out = { status: res.status, types: [] as string[], done: null as Record<string, unknown> | null, chatText: '' };
    if (res.status !== 200 || !res.body) return out;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      // Ligne par ligne comme le Studio (une frame `event:` + `data:`
      // partage le même bloc \n\n : le découpage par blocs raterait le data).
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        try {
          const ev = JSON.parse(line.slice(5).trim()) as { type: string; text?: string };
          out.types.push(ev.type);
          if (ev.type === 'chat' && ev.text) out.chatText += ev.text;
          if (ev.type === 'done') out.done = ev as unknown as Record<string, unknown>;
        } catch { /* ignore */ }
      }
    }
    return out;
  }

  it('1. QUESTION pure → réponse texte, done.updated === false, aucune section', async () => {
    sseBody = 'data: {"choices":[{"delta":{"content":"Voici la réponse."}}]}\n\n' + 'data: [DONE]\n\n';
    const { projectId, sessionId } = await setupProject();
    const out = await collectStream(projectId, sessionId, { message: 'Explique-moi ce projet en une phrase.' });
    assert.equal(out.status, 200);
    assert.ok(!out.types.includes('section_start'), 'aucune section construite');
    assert.ok(out.chatText.length > 0, 'réponse visible dans le chat');
    assert.ok(out.done, 'frame done reçue');
    assert.equal(out.done!['updated'], false, 'aucun fichier touché');
  });

  it('2. Construction polie ("peux-tu ajouter...") → chemin génération préservé', async () => {
    sseBody = 'data: {"choices":[{"delta":{"content":"<SECTION name=\\"hero\\" mode=\\"create\\"><h1>Salut</h1></SECTION>"}}]}\n\n' + 'data: [DONE]\n\n';
    const { projectId, sessionId } = await setupProject();
    const out = await collectStream(projectId, sessionId, { message: 'Peux-tu ajouter un titre de bienvenue ?' });
    assert.equal(out.status, 200);
    assert.ok(out.types.includes('section_start'), 'sections construites (pas de bascule question abusive)');
    assert.ok(out.done, 'frame done reçue');
    assert.equal(out.done!['updated'], true);
  });

  it('3. planFirst → le planId est confirmable (était 400 avant FIX-PLANFIRST)', async () => {
    sseBody = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n' + 'data: [DONE]\n\n';
    const { projectId, sessionId } = await setupProject();
    // capture le planId
    const res = await realFetch(
      `${baseUrl}/api/v1/projects/${projectId}/conversation/sessions/${sessionId}/stream`,
      {
        method: 'POST', headers: { ...H, Accept: 'text/event-stream' },
        body: JSON.stringify({ message: 'Crée une page portfolio', planFirst: true })
      }
    );
    assert.equal(res.status, 200);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '', planId: string | null = null, sawConfirm = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data:')) continue;
        try {
          const ev = JSON.parse(line.slice(5).trim()) as { type: string; plan?: { planId: string }; awaitingConfirmation?: boolean };
          if (ev.type === 'plan' && ev.plan?.planId) planId = ev.plan.planId;
          if (ev.type === 'done' && ev.awaitingConfirmation) sawConfirm = true;
        } catch { /* ignore */ }
      }
    }
    assert.ok(planId, 'planId émis par le stream');
    assert.ok(sawConfirm, 'attente de confirmation signalée');
    const c = await realFetch(
      `${baseUrl}/api/v1/projects/${projectId}/conversation/sessions/${sessionId}/confirm`,
      { method: 'POST', headers: H, body: JSON.stringify({ planId, approved: true }) }
    );
    const cj = (await c.json()) as { session?: { activePlan?: { status: string } }; error?: { message: string } };
    assert.equal(c.status, 200, `confirm ne doit plus 400 (reçu: ${JSON.stringify(cj).slice(0, 160)})`);
    assert.equal(cj.session?.activePlan?.status, 'APPROVED');
  });

  it('4. P2-SIGNAUX : intention + étapes progressives, premier signal < 1 s', async () => {
    sseBody = 'data: {"choices":[{"delta":{"content":"<SECTION name=\\"hero\\" mode=\\"create\\"><h1>Salut</h1></SECTION>"}}]}\n\n' + 'data: [DONE]\n\n';
    const { projectId, sessionId } = await setupProject();
    const t0 = Date.now();
    const res = await realFetch(
      `${baseUrl}/api/v1/projects/${projectId}/conversation/sessions/${sessionId}/stream`,
      {
        method: 'POST', headers: { ...H, Accept: 'text/event-stream' },
        body: JSON.stringify({ message: 'Crée une page vitrine' })
      }
    );
    assert.equal(res.status, 200);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '', raw = '', firstDataAt = 0;
    const dataEvents: Array<Record<string, unknown>> = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      // Parseur ligne par ligne comme le Studio (une frame `event:` + `data:`
      // partage le même bloc \n\n : un découpage par blocs raterait le data).
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const rawLine of lines) {
        raw += rawLine + '\n';
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        if (!firstDataAt) firstDataAt = Date.now();
        try {
          dataEvents.push(JSON.parse(line.slice(5).trim()));
        } catch { /* ignore */ }
      }
    }
    assert.ok(firstDataAt, 'au moins une frame data reçue');
    assert.ok(firstDataAt - t0 < 1000, `premier signal visuel < 1 s (mesuré ${firstDataAt - t0} ms)`);
    // Lignes `event:` nommées présentes dans le flux brut
    assert.ok(raw.includes('event: on_intent_classified'), 'ligne event: on_intent_classified émise');
    assert.ok(raw.includes('event: on_plan_step'), 'lignes event: on_plan_step émises');
    // Contenu JSON correspondant
    const intent = dataEvents.find((e) => e['type'] === 'on_intent_classified') as unknown as { category: string; confidence: number; label: string };
    assert.ok(intent && intent.category, 'intention annoncée avec catégorie');
    assert.ok(typeof intent.confidence === 'number', 'confiance fournie');
    const steps = dataEvents.filter((e) => e['type'] === 'on_plan_step') as unknown as Array<{ index: number; total: number; step: string }>;
    assert.equal(steps.length, 3, 'une frame par étape du plan (3 étapes)');
    assert.deepEqual(steps.map((s) => s.index), [1, 2, 3]);
    assert.ok(steps.every((s) => s.total === 3 && typeof s.step === 'string' && s.step.length > 0), 'index/total/titre présents');
    // Non-régression : la frame plan complète est toujours là (carte Studio)
    assert.ok(dataEvents.some((e) => e['type'] === 'plan'), 'frame plan conservée');
  });

  it('5. P3-QUESTION : réponse texte pure, disque intact, aucun build', async () => {
    sseBody = 'data: {"choices":[{"delta":{"content":"Voici les composants."}}]}\n\n' + 'data: [DONE]\n\n';
    const { projectId, sessionId } = await setupProject();
    // Référence AVANT : la création du projet seed un index.html ("Hello VibeCode")
    const beforeRes = await realFetch(`${baseUrl}/api/v1/projects/${projectId}/files/content?path=index.html`, { headers: H });
    const beforeJson = (await beforeRes.json()) as { file?: { content?: string } };
    const beforeContent = beforeJson.file?.content ?? '';
    assert.ok(beforeContent.length > 0, 'seed préexistant constaté (base de comparaison)');
    const out = await collectStream(projectId, sessionId, { message: 'Explique-moi le projet' });
    assert.equal(out.status, 200);
    assert.ok(out.types.includes('on_question_answered'), 'événement dédié émis');
    assert.ok(out.chatText.length > 0, 'réponse visible dans le chat');
    assert.ok(!out.types.includes('section_start'), 'aucune construction');
    assert.ok(!out.types.some((t) => t === 'diff'), 'aucun diff calculé');
    assert.ok(out.done, 'frame done reçue');
    assert.equal(out.done!['updated'], false, 'updated explicitement false');
    // Disque intact : le fichier est STRICTEMENT identique après le flux
    const afterRes = await realFetch(`${baseUrl}/api/v1/projects/${projectId}/files/content?path=index.html`, { headers: H });
    const afterJson = (await afterRes.json()) as { file?: { content?: string } };
    assert.equal(afterJson.file?.content ?? '', beforeContent, 'aucun octet écrit par le flux question');
  });

  it('6. P4-FINITION : done porte closingMessage + 3 suggestions cliquables', async () => {
    sseBody = 'data: {"choices":[{"delta":{"content":"<SECTION name=\\"hero\\" mode=\\"create\\"><h1>Salut</h1></SECTION>"}}]}\n\n' + 'data: [DONE]\n\n';
    const { projectId, sessionId } = await setupProject();
    const out = await collectStream(projectId, sessionId, { message: 'Crée une landing page' });
    assert.equal(out.status, 200);
    assert.ok(out.done, 'frame done reçue');
    const closing = out.done!['closingMessage'];
    assert.ok(typeof closing === 'string' && closing.length > 10, 'prise de parole de clôture présente');
    assert.ok(closing.includes('1 section'), 'clôture ancrée sur les faits (1 section créée)');
    const sugg = out.done!['suggestions'];
    assert.ok(Array.isArray(sugg) && sugg.length === 3, 'exactement 3 suggestions');
    assert.ok((sugg as unknown[]).every((s) => typeof s === 'string' && (s as string).trim().length > 0), 'suggestions textuelles non vides');
  });

  it('7. P4-FINITION (garde source) : accordéon + chips câblés dans le Studio', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(process.cwd(), 'apps/studio/index.html'), 'utf8');
    assert.ok(src.includes('build-trace-accordion'), 'accordéon présent');
    assert.ok(src.includes("event.type === 'on_plan_step'"), 'écoute on_plan_step');
    assert.ok(src.includes("event.type === 'on_intent_classified'"), 'écoute on_intent_classified');
    assert.ok(src.includes('data-suggestion'), 'chips avec data-suggestion');
    assert.ok(src.includes("getElementById('wsPromptInput')"), 'chips injectent dans le champ chat');
    assert.ok(src.includes('handleWorkspacePromptSubmit'), 'chips envoient via le submit existant');
    assert.ok(src.includes('/application-model'), 'le Studio lit le modèle applicatif serveur');
    assert.ok(src.includes('data-source="application-model"'), 'le rendu réel du modèle est identifiable');
  });

  it('8. ÉTAPE 5 : GET /conversation/memory répond 200 (routage corrigé)', async () => {
    const { projectId } = await setupProject();
    const res = await realFetch(`${baseUrl}/api/v1/projects/${projectId}/conversation/memory`, { headers: H });
    assert.equal(res.status, 200, 'la mémoire projet est servie, plus de 404 générique');
    const body = (await res.json()) as { memory?: { acceptedPlans?: unknown[] } };
    assert.ok(body.memory, 'objet mémoire retourné');
    assert.ok(Array.isArray(body.memory!.acceptedPlans), 'structure ProjectMemory réelle');
  });
});
