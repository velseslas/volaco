/**
 * P1 — TESTS DES ROUTES D'ÉCRITURE NUES (audit §14 : elles n'avaient AUCUN test).
 *
 * Trois flux SSE testés bout en bout avec un adaptateur Mistral FACTICE
 * enregistré dans le registry (aucun réseau, aucune clé) :
 * 1. /app/generate — génération d'un projet React par tool-calling
 * 2. /app/edit + /app/apply-edits — propositions différées puis application
 * 3. /conversation/sessions/:sid/stream — le pipeline HTML (sections)
 *
 * Le flag VOLACO_EXECUTION_TIMELINE=off est posé AVANT l'import dynamique du
 * serveur : le Quality Gate Chromium est désactivé pour rester rapide —
 * il est couvert par ses propres suites.
 */

process.env.VOLACO_EXECUTION_TIMELINE = 'off';
// le faux adaptateur est enregistré sous l id 'mistral' : la clé doit
// exister pour que les routes sélectionnent le provider 'mistral'
process.env.MISTRAL_API_KEY = 'fake-key-for-tests';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileStore } from '../../../packages/core/src/file-explorer/index.js';
import { writeAppFile } from '../../../packages/core/src/app-pipeline.js';
import { aiProviderRegistry } from '../../../packages/core/src/ai/providers/registry.js';
import type { AIProviderGenerateRequest, AIProviderGenerateResponse } from '../../../packages/core/src/ai/providers/types.js';

const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant_p1_01', 'x-user-role': 'ENGINEER' };

interface ScriptedTurn {
  readonly text?: string;
  readonly toolCalls?: Array<{ id: string; name: string; arguments: string }>;
}

/** Adaptateur Mistral FACTICE : rejoue un script de tours (generate) et
 * produit un flux de deltas (generateStream). Aucun réseau. */
class FakeMistralAdapter {
  public readonly descriptor = {
    providerId: 'mistral',
    providerName: 'Fake Mistral (P1)',
    models: ['codestral-latest'],
    capabilities: [] as const,
    contextWindow: 128000,
    structuredOutput: true,
    streaming: true,
    toolCalling: true,
    reasoning: false,
    vision: false,
    costMetadata: {},
    availability: 'AVAILABLE' as const,
    healthStatus: 'HEALTHY' as const
  };

  private turns: ScriptedTurn[];
  private streamScript: string;

  constructor(turns: ScriptedTurn[], streamScript = '') {
    this.turns = turns;
    this.streamScript = streamScript;
  }

  public async generate(request: AIProviderGenerateRequest): Promise<AIProviderGenerateResponse> {
    const callCount = ((this as unknown as { callCount?: number }).callCount ?? 0);
    (this as unknown as { callCount?: number }).callCount = callCount + 1;
    const turn: ScriptedTurn = this.turns[Math.min(callCount, this.turns.length - 1)] ?? { text: '' };
    return {
      text: turn.text ?? '',
      providerId: 'mistral',
      modelId: 'codestral-latest',
      latencyMs: 1,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      costUsd: 0.001,
      ...(turn.toolCalls ? { toolCalls: turn.toolCalls } : {})
    };
  }

  public async *generateStream(): AsyncGenerator<string> {
    for (const delta of this.streamScript.match(/.{1,40}/gs) || []) {
      yield delta;
    }
  }
}

const APP_TSX = `export default function App() {
  return <div className="p-8 text-lg">Projet P1</div>;
}
`;

const makeToolCall = (name: string, args: Record<string, unknown>) => ({
  id: 'call-' + Math.random().toString(36).slice(2, 6),
  name,
  arguments: JSON.stringify(args)
});

describe('CORE-API P1 : routes d écriture nues (SSE mocké)', () => {
  let server: Server;
  let baseUrl: string;
  let projectId = '';

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

    // projet de test
    const pres = await fetch(`${baseUrl}/api/v1/projects`, { headers: H, body: JSON.stringify({ name: 'P1 SSE App' }), method: 'POST' });
    assert.equal(pres.status, 201);
    const pdata = (await pres.json()) as { project?: { id?: string }; id?: string };
    projectId = (pdata.project || pdata).id as string;
    assert.ok(projectId, 'projet créé');
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  /** Consomme une réponse SSE et renvoie les événements parsés. */
  async function consumeSSE(res: Response): Promise<Array<Record<string, unknown>>> {
    const events: Array<Record<string, unknown>> = [];
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = raw.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        try { events.push(JSON.parse(line.slice(6))); } catch { /* ignoré */ }
      }
    }
    return events;
  }

  it('1. /app/generate : l IA écrit les fichiers via tool-calling, build OK, done', async () => {
    aiProviderRegistry.register(new FakeMistralAdapter([
      { toolCalls: [makeToolCall('create_file', { path: 'src/App.tsx', content: APP_TSX })] },
      { text: 'Projet généré.' }
    ]) as unknown as Parameters<typeof aiProviderRegistry.register>[0]);

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/app/generate`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ prompt: 'un site minimaliste' })
    });
    assert.equal(res.status, 200);
    const events = await consumeSSE(res);

    const types = events.map((e) => e.type);
    assert.ok(types.includes('start'), 'start émis');
    assert.ok(types.includes('file'), 'événement fichier émis');
    assert.ok(types.includes('build-ok'), 'build réussi');
    const done = events.find((e) => e.type === 'done');
    assert.ok(done && done.ok === true, 'done ok:true');
    assert.ok((done!.files as string[]).includes('src/App.tsx'), 'le fichier généré est listé');

    // le bundle est servi et contient le composant
    const bundle = await fetch(`${baseUrl}/preview-bundle/${projectId}/`);
    assert.equal(bundle.status, 200);
    assert.ok((await bundle.text()).includes('Projet P1'), 'le bundle embarque l app générée');
  });

  it('2. /app/edit : propositions DIFFÉRÉES (rien d écrit avant confirmation)', async () => {
    aiProviderRegistry.register(new FakeMistralAdapter([
      { toolCalls: [makeToolCall('edit_file', { path: 'src/App.tsx', find: 'Projet P1', replace: 'Projet P1 ÉDITÉ' })] },
      { text: 'Modifications proposées.' }
    ]) as unknown as Parameters<typeof aiProviderRegistry.register>[0]);

    // état AVANT : le contenu doit être intact (mode différé)
    const before = fileStore.getFile('tenant_p1_01', projectId, 'app/src/App.tsx');
    const beforeContent = before?.content ?? '';

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/app/edit`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ instruction: 'change le texte' })
    });
    assert.equal(res.status, 200);
    const events = await consumeSSE(res);
    const proposals = events.find((e) => e.type === 'proposals');
    assert.ok(proposals, 'proposals émis');
    assert.equal((proposals!.edits as unknown[]).length, 1, 'une proposition collectée');

    // rien n'a été écrit (différé)
    const after = fileStore.getFile('tenant_p1_01', projectId, 'app/src/App.tsx');
    assert.equal(after?.content, beforeContent, 'le fichier est INTACT avant confirmation');

    // 3. /app/apply-edits : application + révision + rebuild
    const applyRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/app/apply-edits`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ edits: (proposals!.edits as unknown[]).map((e) => ({ action: 'edit', path: (e as { path: string }).path, find: 'Projet P1', replace: 'Projet P1 ÉDITÉ' })) })
    });
    assert.equal(applyRes.status, 200);
    const applyEvents = await consumeSSE(applyRes);
    const done = applyEvents.find((e) => e.type === 'done');
    assert.ok(done && done.ok === true && done.applied === 1, 'application + build réussis');

    const updated = fileStore.getFile('tenant_p1_01', projectId, 'app/src/App.tsx');
    assert.ok(String(updated?.content).includes('Projet P1 ÉDITÉ'), 'la source est mise à jour');
  });

  it('4. /app/apply-edits : find NON UNIQUE → apply-skip honnête (rien de cassé)', async () => {
    // deux occurrences de 'Projet P1 ÉDITÉ' ? non — on tente un find multi-occurrences
    const edits = [{ action: 'edit', path: 'src/App.tsx', find: 'Projet', replace: 'X' }];
    // 'Projet' apparaît au moins une fois — pour rendre NON unique, on duplique d'abord via une édition directe du fichier de travail
    // dupliquer 'Projet' dans le WORKSPACE (source réelle de apply-edits)
    const current = fileStore.getFile('tenant_p1_01', projectId, 'app/src/App.tsx');
    writeAppFile(projectId, 'src/App.tsx', String(current?.content).replace('Projet P1 ÉDITÉ', 'Projet P1 ÉDITÉ Projet'));
    const applyRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/app/apply-edits`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ edits })
    });
    const events = await consumeSSE(applyRes);
    const skip = events.find((e) => e.type === 'apply-skip');
    assert.ok(skip, 'apply-skip émis');
    assert.match(String(skip.reason), /non unique/);
    const done = events.find((e) => e.type === 'done');
    assert.ok(done, 'le flux termine proprement');
  });

  it('5. /app/status : format react-vite après génération', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/app/status`, { headers: H });
    const data = (await res.json()) as { format?: string };
    assert.equal(data.format, 'react-vite');
  });

  it('6. /conversation/…/stream : le pipeline HTML produit les sections et sauvegarde', async () => {
    const streamScript = 'Voici votre site.\n\n<SECTION name="header">\nJe pose le header.\n<header class="p-4"><h1>Stream P1</h1></header>\n</SECTION>\n\nTerminé !';
    aiProviderRegistry.register(new FakeMistralAdapter([], streamScript) as unknown as Parameters<typeof aiProviderRegistry.register>[0]);

    const sres = await fetch(`${baseUrl}/api/v1/projects/${projectId}/conversation/sessions`, { method: 'POST', headers: H });
    assert.equal(sres.status, 201);
    const sdata = (await sres.json()) as { session?: { sessionId?: string } };
    const sessionId = sdata.session?.sessionId as string;

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/conversation/sessions/${sessionId}/stream`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ message: 'crée un site', isModification: false })
    });
    assert.equal(res.status, 200);
    const events = await consumeSSE(res);

    const types = events.map((e) => e.type);
    assert.ok(types.includes('section_start'), 'section_start émis');
    assert.ok(types.includes('section_end'), 'section_end émis');
    const done = events.find((e) => e.type === 'done');
    assert.ok(done, 'done émis');
    assert.equal(done!.updated, true, 'fichier sauvegardé');

    // le fichier contient la section générée
    const fres = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content?path=index.html`, { headers: H });
    const fdata = (await fres.json()) as { file?: { content?: string } };
    assert.ok(String(fdata.file?.content).includes('Stream P1'), 'index.html contient la section générée');
  });
});
