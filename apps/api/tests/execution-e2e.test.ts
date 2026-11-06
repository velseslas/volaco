/**
 * T7 — E2E EXECUTION TRANSPARENCY : génération complète avec un adaptateur
 * LLM factice, annulation RÉELLE en cours de génération, cycle REPAIR visible
 * et replay après « refresh » (CDC §46-§49).
 *
 * L'adaptateur factice est enregistré dans le registre (providerId 'mistral')
 * après désenregistrement des vrais — le stream parcourt alors le chemin de
 * production COMPLET : parse incrémental, merge, diff, gate serveur, synthèse.
 */

import './_lot-b-legacy-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { executionStore } from '../../../packages/core/src/ai-native/execution/store.js';
import { aiProviderRegistry } from '../../../packages/core/src/ai/providers/registry.js';
import { dedupeSectionBlocks } from '../src/routes/conversation.js';

const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'studio-local', 'x-user-role': 'ENGINEER' };

interface SSEEvent {
  type: string;
  executionId?: string;
  [key: string]: unknown;
}

async function streamEvents(baseUrl: string, projectId: string, body: Record<string, unknown>): Promise<SSEEvent[]> {
  const sessionRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/conversation/sessions`, {
    method: 'POST',
    headers: H
  });
  const sessionId = ((await sessionRes.json()) as { session: { sessionId: string } }).session.sessionId;
  const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/conversation/sessions/${sessionId}/stream`, {
    method: 'POST',
    headers: { ...H, Accept: 'text/event-stream' },
    body: JSON.stringify(body)
  });
  const raw = await res.text();
  lastStreamRaw = raw;
  const events: SSEEvent[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    try { events.push(JSON.parse(t.slice(5).trim())); } catch { /* ignore */ }
  }
  return events;
}

/** Corps brut de la dernière réponse SSE (pour les assertions hors frames data:). */
let lastStreamRaw = '';

/** Adaptateur LLM factice streamant un scénario réaliste section par section. */
class FakeStreamingAdapter {
  public releaseWaiting: (() => void) | null = null;
  public descriptor = {
    providerId: 'mistral',
    providerName: 'Fake Mistral (E2E)',
    models: ['fake-1'],
    capabilities: ['CODE_GENERATION'],
    contextWindow: 128000,
    structuredOutput: false,
    streaming: true,
    toolCalling: false,
    reasoning: false,
    vision: false,
    costMetadata: {},
    availability: 'AVAILABLE',
    healthStatus: 'HEALTHY'
  };
  public async generate(): Promise<{ text: string }> {
    return { text: '```html\n<!DOCTYPE html><html><body>patch factice</body></html>\n```' };
  }
  public async *generateStream(): AsyncGenerator<string> {
    const chunks = [
      'Salut ! Je modifie ta page.',
      '<SECTION name="header" mode="modify">',
      'Je modernise le header.',
      '<header><h1>Titre Moderne</h1><p>Explore ' + 'x'.repeat(30) + '</p></header>',
      '</SECTION>',
      '<SECTION name="contact" mode="add" after="header">',
      'J\u2019ajoute un contact.',
      '<section id="contact"><p>contact@exemple.fr</p></section>',
      '</SECTION>',
      // AUDIT PREVIEW — le LLM ré-émet le footer en mode create alors qu'il
      // existe : la garde d'unicité doit REMPLACER, jamais empiler.
      '<SECTION name="footer" mode="create">',
      'Je rafraichis le pied de page.',
      '<footer><p>© 2026 — nouveau pied de page</p></footer>',
      '</SECTION>',
      'Voilà, c\u2019est prêt !'
    ];
    for (const chunk of chunks) {
      // Découpe fin pour exercer le parseur incrémental du stream
      for (let i = 0; i < chunk.length; i += 24) {
        yield chunk.slice(i, i + 24);
      }
    }
  }
}

/** Adaptateur factice qui se BLOQUE au milieu du stream (test d'annulation). */
class CancelableFakeAdapter extends FakeStreamingAdapter {
  public override async *generateStream(): AsyncGenerator<string> {
    yield 'Je commence la modification... ';
    yield '<SECTION name="header" mode="modify">';
    yield '<header><h1>En cours</h1></header>';
    await new Promise<void>((resolve) => { this.releaseWaiting = resolve; });
    yield ' jamais lu après annulation';
  }
}

function installFakeAdapter(instance: FakeStreamingAdapter): void {
  for (const provider of aiProviderRegistry.list()) {
    aiProviderRegistry.unregister(provider.providerId);
  }
  aiProviderRegistry.register(instance as never);
}

const E2E_HTML = '<!DOCTYPE html><html><head><title>E2E</title></head><body>'
  + '<div class="vibe-stitched" data-section="header"><header><h1>Ancien Titre</h1><p>' + 'a'.repeat(220) + '</p></header></div>'
  + '<div class="vibe-stitched" data-section="footer"><footer><p>' + 'b'.repeat(220) + '</p></footer></div>'
  + '</body></html>';

describe('T7 : E2E — génération complète, annulation réelle, réparation visible', () => {
  let server: Server;
  let baseUrl: string;
  let projectId: string;
  let cancelAdapter: CancelableFakeAdapter;

  before(async () => {
    delete process.env.MISTRAL_API_KEY;
    delete process.env.GEMINI_API_KEY;
    // Heartbeat SSE accéléré : pendant le blocage de l'adaptateur factice,
    // des pings doivent maintenir la connexion ouverte (fiabilité §17).
    process.env.VOLACO_SSE_HEARTBEAT_MS = '80';
    cancelAdapter = new CancelableFakeAdapter();
    installFakeAdapter(new FakeStreamingAdapter());
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
      body: JSON.stringify({ name: 'T7 E2E' })
    });
    projectId = ((await res.json()) as { project: { id: string } }).project.id;
    await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ path: 'index.html', content: E2E_HTML })
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('11. génération complète : événements réels ordonnés, diffs, gate, synthèse, replay', async () => {
    const events = await streamEvents(baseUrl, projectId, {
      message: 'Modernise le header et ajoute un contact',
      isModification: true
    });

    // Le flux va jusqu'au done avec un HTML réellement modifié
    const done = events.find((e) => e.type === 'done') as
      { updated?: boolean; html?: string; gate?: { score: number } | null; synthesis?: { text: string } } | undefined;
    assert.ok(done && done.updated, 'le flux doit se terminer par un done final');
    assert.ok((done.html || '').includes('Titre Moderne'), 'le HTML final contient la section modifiée');
    assert.ok((done.html || '').includes('contact@exemple.fr'), 'le HTML final contient la section ajoutée');

    // Frames de diff réelles émises (modify + add + create-footer)
    const diffFrames = events.filter((e) => e.type === 'diff') as unknown as Array<{ section: string; added: number; applied?: boolean }>;
    assert.equal(diffFrames.length, 3, 'une frame diff par section');
    assert.ok(diffFrames.every((d) => d.applied === true && d.added > 0), 'diffs appliqués avec ajouts réels');

    // UNICITÉ — le footer ré-émis en mode create est REMPLACÉ, pas empilé :
    // exactement 1 <footer> et 1 data-section="footer" dans le document final.
    const footerTags = ((done.html || '').match(/<footer[\s>]/gi) || []).length;
    assert.equal(footerTags, 1, 'footer ×1 (la garde d unicité a remplacé, pas dupliqué)');
    const footerSections = ((done.html || '').match(/data-section="footer"/g) || []).length;
    assert.equal(footerSections, 1, 'un seul bloc data-section="footer"');

    // Le gate serveur a tourné et son résultat est dans la frame
    assert.ok(done.gate && typeof done.gate.score === 'number', 'event.gate porte le score réel du Quality Gate');

    // La synthèse finale est une phrase honnête avec chiffres
    assert.ok(
      done.synthesis && /section/.test(done.synthesis.text) && /Quality Gate/.test(done.synthesis.text) && /s\b/.test(done.synthesis.text),
      'synthèse : sections, gate, durée — ' + (done.synthesis ? done.synthesis.text : 'absente')
    );

    // Traçabilité complète côté store
    const executionId = events.find((e) => e.type === 'start')!.executionId!;
    const record = executionStore.getExecution(executionId)!;
    assert.equal(record.status, 'COMPLETED');
    const types = record.events.map((e) => e.type);
    for (const expected of ['EXECUTION_STARTED', 'FILE_READ', 'PLAN_CREATED', 'FILE_MODIFIED', 'FILE_CREATED', 'DIFF_GENERATED', 'VALIDATION_STARTED', 'VALIDATION_COMPLETED', 'EXECUTION_COMPLETED', 'SUMMARY_GENERATED']) {
      assert.ok((types as string[]).includes(expected), `l'événement ${expected} doit être persisté`);
    }
    const seqs = record.events.map((e) => e.seq);
    for (let i = 1; i < seqs.length; i++) assert.ok(seqs[i]! > seqs[i - 1]!, 'seq strictement croissante');

    // Bilan réel (header modify + contact add + footer create-remplacé)
    assert.equal(record.summary?.sectionsModified, 1);
    assert.equal(record.summary?.sectionsCreated, 2);
    assert.ok((record.summary?.addedLines || 0) > 0, 'lignes ajoutées réelles');
    assert.ok(record.summary?.revisionId, 'révision automatique liée');
    assert.equal(record.summary?.score, done.gate!.score, 'score du bilan = score du gate');

    // Replay (refresh) : la dernière exécution est servie complète
    const latestRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/executions/latest`, { headers: H });
    const latest = (await latestRes.json()) as { execution: { executionId: string; events: unknown[]; status: string } };
    assert.equal(latest.execution.executionId, executionId);
    assert.equal(latest.execution.status, 'COMPLETED');
    assert.ok(latest.execution.events.length >= 10, 'replay complet disponible');
  });

  it('12. cycle REPAIR visible sur l\u2019exécution de la génération', async () => {
    const latestRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/executions/latest`, { headers: H });
    const latest = (await latestRes.json()) as { execution: { executionId: string } };
    const executionId = latest.execution.executionId;

    const repairRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/repair`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ maxIterations: 2, executionId })
    });
    assert.equal(repairRes.status, 200);
    const repairRecord = executionStore.getExecution(executionId)!;
    const repairTypes = repairRecord.events.map((e) => e.type);
    assert.ok(repairTypes.includes('REPAIR_STARTED'), 'REPAIR_STARTED persisté');
    assert.ok(repairTypes.includes('REPAIR_COMPLETED'), 'REPAIR_COMPLETED persisté (réussie, no-repair-needed ou rollback honnête)');
  });

  it('13. annulation en cours de génération : flux stoppé, rien n\u2019est sauvegardé, statut ⏹', async () => {
    const beforeRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, { headers: H });
    const htmlBefore = ((await beforeRes.json()) as { file?: { content?: string } }).file?.content || '';

    installFakeAdapter(cancelAdapter);
    const streamPromise = streamEvents(baseUrl, projectId, {
      message: 'Modifie le header (sera annulé)',
      isModification: true
    });
    // Laisse le stream démarrer et se bloquer au milieu de la section
    await new Promise((r) => setTimeout(r, 400));
    const running = executionStore.listExecutions('studio-local', projectId).find((r) => r.status === 'RUNNING');
    assert.ok(running, 'une exécution est active pendant le stream');
    const cancelRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/executions/${running.executionId}/cancel`, {
      method: 'POST', headers: H
    });
    assert.equal(((await cancelRes.json()) as { cancelled: boolean }).cancelled, true);
    // Débloque le générateur : le route doit casser à la vérification du flag
    if (cancelAdapter.releaseWaiting) cancelAdapter.releaseWaiting();
    const events = await streamPromise;

    assert.ok(events.some((e) => e.type === 'cancelled'), 'le serveur confirme l\u2019annulation');
    assert.ok(!events.some((e) => e.type === 'done'), 'aucun done après annulation');
    assert.ok(lastStreamRaw.includes(': ping'), 'le heartbeat SSE a maintenu la connexion pendant le silence');
    const record = executionStore.getExecution(running.executionId)!;
    assert.equal(record.status, 'CANCELLED');
    assert.equal(record.cancelReason, 'user_cancel');

    // Rien n'a été écrasé : le fichier garde son contenu d'avant
    const afterRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, { headers: H });
    const htmlAfter = ((await afterRes.json()) as { file?: { content?: string } }).file?.content || '';
    assert.equal(htmlAfter, htmlBefore, 'le fichier existant n\u2019est pas touché par une génération annulée');
  });

  it('14. déduplication : dernier bloc data-section gagne, uniques conservés', () => {
    const dirty = '<div data-section="a">A1</div><div data-section="b">B</div><div data-section="a">A2</div><div data-section="c">C</div>';
    const clean = dedupeSectionBlocks(dirty);
    assert.equal((clean.match(/data-section="a"/g) || []).length, 1, 'a ×1');
    assert.ok(clean.includes('A2') && !clean.includes('A1'), 'la DERNIÈRE version de a gagne');
    assert.ok(clean.includes('B') && clean.includes('C'), 'les sections uniques sont intactes');

    // Page sans doublon : inchangée
    const cleanPage = '<div data-section="x">X</div><div data-section="y">Y</div>';
    assert.equal(dedupeSectionBlocks(cleanPage), cleanPage);
  });

  it('15. le gate détecte la duplication structurelle (98/100 impossible sur footer ×3)', async () => {
    // Page volontairement polluée : 3 footers, 3 headers
    const dirtyPage = '<!DOCTYPE html><html><head><title>Dup</title></head><body>'
      + '<div data-section="header"><header><h1>H</h1></header></div>'.repeat(3)
      + '<div data-section="main"><p>Contenu</p></div>'
      + '<div data-section="footer"><footer><p>F</p></footer></div>'.repeat(3)
      + '</body></html>';
    await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT', headers: H, body: JSON.stringify({ path: 'index.html', content: dirtyPage })
    });
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/visual/analyze`, { method: 'POST', headers: H });
    assert.equal(res.status, 200);
    const gate = (await res.json()) as { score: number; findings: Array<{ severity: string; title: string }> };
    assert.ok(gate.score <= 85, 'une page avec footer ×3 ne peut plus afficher 98/100 (score: ' + gate.score + ')');
    const titles = gate.findings.map((f) => f.title).join(' | ');
    assert.ok(titles.includes('Sections dupliquées'), 'finding « Sections dupliquées » présent');
    assert.ok(/Structure dupliquée/.test(titles), 'finding « Structure dupliquée » (header/footer multiples) présent');
    assert.ok(gate.findings.some((f) => f.severity === 'HIGH'), 'la duplication est au moins HIGH');
  });
});
