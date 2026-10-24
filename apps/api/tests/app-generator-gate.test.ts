/**
 * PATCH L2 — barrière d'écriture du GÉNÉRATEUR (create_file).
 *
 * Stratégie retenue : VALIDER AVANT ÉCRITURE — par conception il n'y a RIEN
 * à restaurer : un contenu non conforme n'est jamais écrit (ni workspace,
 * ni miroir FileStore), donc le contenu préexistant de chaque fichier
 * subsiste à l'identique. Per-file gate = porte partagée R3-B
 * (imageGateInspect → app-policy, checker unique) ; un refus « non résolu »
 * (fichier jamais réécrit avec succès ensuite) bloque la publication avec la
 * forme de refus P1-B existante (aucun build, done ok:false + imageIssues +
 * imageWriteRefusals additifs). La barrière terminale L1 de buildApp reste
 * en place (défense en profondeur, inchangée).
 *
 * A. Unité (handlersFor exporté ; DI d'inspecteur — le checker réel ne lève
 *    pas d'exception sur des chaînes usuelles, le fail-closed n'est pas
 *    injectable sans ce seam ; même convention que image-gate.ts) :
 *  1. checker en panne → refus fail-closed, DISQUE inchangé octet à octet ;
 *  2. violation (DI) → refus, DISQUE inchangé, comptabilité kind='images' ;
 *  3. conforme (DI) → écrit réellement, événement 'file' émis ;
 *  4. chemin hors politique → raison d'écriture propagée, rien d'écrit.
 * B. E2E (serveur réel + adaptateur factice, aucun réseau) :
 *  5. violation candidate refusée AVANT écriture : template intact au fil
 *     du flux, refus non résolu → AUCUN bundle, AUCUN miroir FileStore ;
 *  6. réécriture refusée d'un fichier PRÉEXISTANT : son contenu antérieur
 *     subsiste à l'identique sur disque ET FileStore ;
 *  7. refus multi-fichiers : le fichier interdit n'a JAMAIS existé, les
 *     autres écritures réussies sont intactes, aucun dist/ ;
 *  8. correction en boucle (réécriture conforme) → publié conforme,
 *     aucune trace du candidat refusé (ni disque, ni bundle) ;
 *  9. génération normale inchangée (contrat compatible) ;
 * 10. `undetermined` non bloquant — politique inchangée ;
 * 11. état initial préservé : rien ne détruit les fichiers légitimes.
 */

process.env.VOLACO_EXECUTION_TIMELINE = 'off';
process.env.MISTRAL_API_KEY = 'fake-key-for-tests';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { handlersFor, type ImageWriteRefusalEvent } from '../src/routes/app-generator.js';
import {
  ensureWorkspace,
  readAppFile,
  setProjectFormat,
  workspaceDir
} from '../../../packages/core/src/app-pipeline.js';
import { aiProviderRegistry } from '../../../packages/core/src/ai/providers/registry.js';
import type { AIProviderGenerateRequest, AIProviderGenerateResponse } from '../../../packages/core/src/ai/providers/types.js';
import type { AppImageInspection } from '../../../packages/core/src/image/app-policy.js';

const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant_l2_01', 'x-user-role': 'ENGINEER' };

// ---------------------------------------------------------------------------
// Contenus candidats
// ---------------------------------------------------------------------------
const APP_POISON = 'export default function App() {\n'
  + '  return (\n'
  + '    <main className="min-h-screen bg-slate-950 p-10">\n'
  + '      <img src="https://loremflickr.com/1200/800/food" alt="salle" />\n'
  + '    </main>\n'
  + '  );\n'
  + '}\n';

const BAD_COMPONENT = 'export default function Bad() {\n'
  + '  return <img src="https://loremflickr.com/900/700/food" alt="cuisine" />;\n'
  + '}\n';

const APP_CLEAN_LIT = 'export default function App() {\n'
  + '  return (\n'
  + '    <main className="min-h-screen bg-slate-950 p-10 text-slate-100">\n'
  + '      <h1 className="text-3xl font-bold">Atelier L2</h1>\n'
  + '      <img src="https://picsum.photos/seed/volaco-l2/800/520" alt="atelier" />\n'
  + '    </main>\n'
  + '  );\n'
  + '}\n';

const APP_UNDETERMINED = 'export default function App() {\n'
  + "  const picsumUrl = 'https://picsum.photos/seed/volaco-l2/800/520';\n"
  + '  return (\n'
  + '    <main className="min-h-screen bg-slate-950 p-10 text-slate-100">\n'
  + '      <img src={picsumUrl} alt="atelier" />\n'
  + '    </main>\n'
  + '  );\n'
  + '}\n';

const APP_V1 = 'export default function App() {\n  return <main className="p-10">Salle L2 version un</main>;\n}\n';
const HERO_CLEAN = 'export default function Hero() {\n  return <section className="py-10">Galerie L2</section>;\n}\n';
const GALLERY_CLEAN = 'export default function Gallery() {\n  return <p className="mt-6">Images L2</p>;\n}\n';

const makeToolCall = (name: string, args: Record<string, unknown>) => ({
  id: 'call-l2-' + Math.random().toString(36).slice(2, 8),
  name,
  arguments: JSON.stringify(args)
});

/** HOTFIX HS-1 — accès explicite aux handlers du générateur : échoue clairement
 * si le handler attendu est absent (aucun appel implicite d'un handler optionnel). */
function requireHandler(
  handlers: Record<string, (args: Record<string, unknown>) => unknown>,
  name: string
): (args: Record<string, unknown>) => unknown {
  const fn = handlers[name];
  assert.ok(fn, `le handler ${name} est obligatoire (contrat du générateur)`);
  return fn;
}

interface ScriptedTurn {
  readonly text?: string;
  readonly toolCalls?: Array<{ id: string; name: string; arguments: string }>;
}

/** Adaptateur mistral factice : rejoue un script de tours, capture les prompts. */
class ScriptedMistralAdapter {
  public readonly descriptor = {
    providerId: 'mistral',
    providerName: 'Fake Mistral (L2)',
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

  public readonly calls: Array<{ system: string; user: string }> = [];
  private turns: ScriptedTurn[];
  private count = 0;

  constructor(turns: ScriptedTurn[]) {
    this.turns = turns;
  }

  public async generate(request: AIProviderGenerateRequest): Promise<AIProviderGenerateResponse> {
    this.calls.push({ system: request.systemPrompt ?? '', user: request.prompt ?? '' });
    const turn = this.turns[Math.min(this.count, this.turns.length - 1)] ?? { text: '' };
    this.count += 1;
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
    yield '';
  }
}

// ---------------------------------------------------------------------------
// A. Unité — handlersFor appelé directement ; le workspace (disque) est RÉEL.
// ---------------------------------------------------------------------------
describe('PATCH L2 unité : contrôle AVANT écriture (handlersFor)', () => {
  const tenantId = 'tenant_l2_unit';
  const projectId = 'proj_l2_unit_01';
  let templateApp = '';
  const sse: Array<Record<string, unknown>> = [];
  const emit = (data: Record<string, unknown>): void => { sse.push(data); };

  before(() => {
    ensureWorkspace(projectId, true); // template frais (état pré-génération)
    const initial = readAppFile(projectId, 'src/App.tsx');
    assert.ok(initial !== null, 'le template contient src/App.tsx');
    templateApp = initial;
  });

  it('1. checker en panne → refus fail-closed, DISQUE inchangé octet à octet', () => {
    const refusals: ImageWriteRefusalEvent[] = [];
    const handlers = handlersFor(tenantId, projectId, emit, {
      inspector: () => { throw new Error('checker en panne (injecté)'); },
      onImageWriteRefusal: (e) => refusals.push(e)
    });
    const before = readAppFile(projectId, 'src/App.tsx');
    const createFile = requireHandler(handlers, 'create_file');
    const result = createFile({ path: 'src/App.tsx', content: APP_CLEAN_LIT });
    assert.match(String(result), /^ERREUR: inspection des images impossible/, 'refus fail-closed explicite');
    assert.equal(readAppFile(projectId, 'src/App.tsx'), before, 'aucune écriture : contenu préexistant intact');
    assert.equal(before, templateApp, 'l état préexistant est bien celui du template');
    assert.equal(refusals.length, 1, 'la route est notifiée du refus');
    assert.equal(refusals[0]!.kind, 'inspection-error');
    assert.equal(refusals[0]!.path, 'src/App.tsx');
    assert.ok(!sse.some((e) => e.type === 'file'), 'aucun événement écriture émis');
  });

  it('2. violation (DI) → refus, DISQUE inchangé, comptabilité kind=images', () => {
    const refusals: ImageWriteRefusalEvent[] = [];
    const inspector = (files: ReadonlyArray<{ path: string; content: string }>): AppImageInspection => ({
      violations: [{
        path: files[0]!.path,
        kind: 'img-src' as const,
        url: 'https://forbidden.invalid/photo.jpg',
        host: 'forbidden.invalid',
        line: 3,
        status: 'violation' as const,
        reason: 'hôte interdit par la politique'
      }],
      undetermined: []
    });
    const handlers = handlersFor(tenantId, projectId, emit, {
      inspector,
      onImageWriteRefusal: (e) => refusals.push(e)
    });
    const createFile = requireHandler(handlers, 'create_file');
    const result = createFile({ path: 'src/App.tsx', content: APP_POISON });
    assert.match(String(result), /^ERREUR: images interdites/, 'refus politique explicite');
    assert.ok(String(result).includes('forbidden.invalid'), 'la raison cite la référence exacte');
    assert.equal(readAppFile(projectId, 'src/App.tsx'), templateApp, 'aucune écriture : contenu préexistant intact');
    assert.equal(refusals.length, 1);
    assert.equal(refusals[0]!.kind, 'violations');
    assert.ok(refusals[0]!.issues.some((i) => i.includes('forbidden.invalid')));
    assert.ok(!sse.some((e) => e.type === 'file'));
  });

  it('3. conforme (DI clean explicit) → écrit réellement + événement file', () => {
    let inspected: ReadonlyArray<{ path: string; content: string }> = [];
    const inspector = (files: ReadonlyArray<{ path: string; content: string }>): AppImageInspection => {
      inspected = files;
      return { violations: [], undetermined: [] };
    };
    const handlers = handlersFor(tenantId, projectId, emit, { inspector });
    const createFile = requireHandler(handlers, 'create_file');
    const result = createFile({ path: 'src/components/Dial.tsx', content: HERO_CLEAN });
    assert.match(String(result), /^OK — fichier/, 'écriture autorisée pour un contenu conforme');
    assert.equal(readAppFile(projectId, 'src/components/Dial.tsx'), HERO_CLEAN, 'le contenu exact est sur disque');
    assert.equal(inspected.length, 1, 'le contenu CANDIDAT exact a été inspecté');
    assert.equal(inspected[0]!.path, 'src/components/Dial.tsx');
    assert.equal(inspected[0]!.content, HERO_CLEAN);
    assert.ok(sse.some((e) => e.type === 'file' && e.path === 'src/components/Dial.tsx'), 'un événement file est émis');
  });

  it('4. chemin hors politique → raison d écriture propagée, rien écrit', () => {
    const handlers = handlersFor(tenantId, projectId, emit, {});
    const createFile = requireHandler(handlers, 'create_file');
    const result = createFile({ path: 'README.md', content: 'contenu hors src' });
    assert.match(String(result), /^ERREUR: .*path-non-autorise/, 'la raison de writeAppFile est propagée');
    assert.equal(readAppFile(projectId, 'README.md'), null, 'aucun fichier créé');
  });
});

// ---------------------------------------------------------------------------
// B. E2E — /app/generate réel ; état disque vérifié de bout en bout.
// ---------------------------------------------------------------------------
describe('PATCH L2 E2E : génération refusée sans contenu dangereux persistant', () => {
  let server: Server;
  let baseUrl = '';
  const projectIds: string[] = [];

  before(async () => {
    const { createApiServer } = await import('../src/server.js');
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        baseUrl = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
        resolve();
      });
    });
    for (const name of ['L2 refus simple', 'L2 refus fichier', 'L2 réécriture refusee', 'L2 refus multi', 'L2 correction boucle', 'L2 undetermined', 'L2 état initial']) {
      const res = await fetch(baseUrl + '/api/v1/projects', { method: 'POST', headers: H, body: JSON.stringify({ name }) });
      assert.equal(res.status, 201);
      const data = (await res.json()) as { project?: { id?: string }; id?: string };
      const id = (data.project || data).id as string;
      assert.ok(id, 'projet créé : ' + name);
      projectIds.push(id);
    }
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

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

  async function savedContent(projectId: string, path: string, expectStatus = 200): Promise<string> {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content?path=${encodeURIComponent('app/' + path)}`, { headers: H });
    assert.equal(res.status, expectStatus, 'FileStore : ' + path);
    if (expectStatus !== 200) return '';
    const parsed = (await res.json()) as { file?: { content?: string } };
    return parsed.file?.content ?? '';
  }

  /** La génération reconstruit le workspace depuis le template (reset) :
   * capture ici l'état template attendu pour comparaison octet à octet. */
  function templateAppSnapshot(projectId: string): string {
    ensureWorkspace(projectId, true);
    const content = readAppFile(projectId, 'src/App.tsx');
    assert.ok(content !== null, 'template présent');
    return content;
  }

  it('5. violation candidate refusée AVANT écriture : template intact, refus non résolu → aucun bundle, aucun miroir', async () => {
    const projectId = projectIds[0]!;
    const template = templateAppSnapshot(projectId);

    aiProviderRegistry.register(new ScriptedMistralAdapter([
      { toolCalls: [makeToolCall('create_file', { path: 'src/App.tsx', content: APP_POISON })] },
      { text: 'Génération terminée.' },
      { text: 'Je ne peux rien corriger.' }
    ]) as unknown as Parameters<typeof aiProviderRegistry.register>[0]);
    setProjectFormat(projectId, 'react-vite');

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/app/generate`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ prompt: 'un site pour un restaurant' })
    });
    assert.equal(res.status, 200);
    const events = await consumeSSE(res);
    const types = events.map((e) => e.type);

    // la forme de refus P1-B est préservée : round tenté, aucun build
    assert.equal(events.filter((e) => e.type === 'repair' && e.reason === 'images').length, 1, 'UN round images tenté');
    assert.ok(types.includes('error'), 'l échec est explicitement signalé');
    assert.ok(!types.includes('build-ok') && !types.includes('build-error'), 'AUCUN build lancé (aucune publication)');
    const done = events.find((e) => e.type === 'done') as { ok?: boolean; imageIssues?: string[]; imageWriteRefusals?: Array<{ path: string; kind: string; issues: string[] }> };
    assert.ok(done && done.ok === false, 'done ok:false');
    assert.ok(Array.isArray(done.imageIssues) && done.imageIssues.length >= 1, 'les refus sont listés dans imageIssues');
    assert.ok(done.imageIssues!.join(' | ').includes('loremflickr'), 'la violation montrée cite l hôte interdit');
    assert.ok(done.imageWriteRefusals && done.imageWriteRefusals.length === 1, 'imageWriteRefusals additif renseigné');
    assert.equal(done.imageWriteRefusals![0]!.path, 'src/App.tsx');
    assert.equal(done.imageWriteRefusals![0]!.kind, 'violations');

    // DISQUE : le template est intact octet à octet — RIEN (template, ni
    // miroir FileStore, ni bundle) ne témoigne du candidat refusé.
    assert.equal(readAppFile(projectId, 'src/App.tsx'), template, 'workspace : contenu préexistant intact octet à octet');
    await savedContent(projectId, 'src/App.tsx', 404);
    const bundle = await fetch(`${baseUrl}/preview-bundle/${projectId}/`);
    assert.equal(bundle.status, 404, 'aucun bundle publié');
  });

  it('6. réécriture refusée du fichier PRÉEXISTANT : contenu antérieur subsiste (disque + FileStore)', async () => {
    const projectId = projectIds[1]!;
    templateAppSnapshot(projectId);

    aiProviderRegistry.register(new ScriptedMistralAdapter([
      { toolCalls: [makeToolCall('create_file', { path: 'src/App.tsx', content: APP_V1 })] },
      { toolCalls: [makeToolCall('create_file', { path: 'src/App.tsx', content: APP_POISON })] },
      { toolCalls: [makeToolCall('create_file', { path: 'src/components/Hero.tsx', content: HERO_CLEAN })] },
      { text: 'Génération terminée.' },
      { text: 'Je renonce à corriger.' }
    ]) as unknown as Parameters<typeof aiProviderRegistry.register>[0]);
    setProjectFormat(projectId, 'react-vite');

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/app/generate`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ prompt: 'un site pour un atelier' })
    });
    assert.equal(res.status, 200);
    const events = await consumeSSE(res);

    const done = events.find((e) => e.type === 'done') as { ok?: boolean; imageWriteRefusals?: Array<{ path: string }> };
    assert.ok(done && done.ok === false, 'done ok:false (refus non résolu)');
    assert.equal(done.imageWriteRefusals!.length, 1);
    assert.equal(done.imageWriteRefusals![0]!.path, 'src/App.tsx');

    // l'écriture v1 a bien été appliquée puis la réécriture interdite n'a
    // RIEN écrasé : disque ET miroir FileStore = APP_V1 exact.
    assert.equal(readAppFile(projectId, 'src/App.tsx'), APP_V1, 'workspace : présence contenu antérieur');
    assert.equal(await savedContent(projectId, 'src/App.tsx'), APP_V1, 'FileStore : contenu antérieur (pas de réécriture pirate)');
    assert.equal(readAppFile(projectId, 'src/components/Hero.tsx'), HERO_CLEAN, 'l autre écriture réussie est intacte');
    const bundle = await fetch(`${baseUrl}/preview-bundle/${projectId}/`);
    assert.equal(bundle.status, 404, 'aucun bundle publié');
  });

  it('7. refus multi-fichiers : le fichier interdit n a JAMAIS existé, le reste est intact, aucun dist/', async () => {
    const projectId = projectIds[2]!;
    templateAppSnapshot(projectId);

    aiProviderRegistry.register(new ScriptedMistralAdapter([
      { toolCalls: [makeToolCall('create_file', { path: 'src/components/Hero.tsx', content: HERO_CLEAN })] },
      { toolCalls: [makeToolCall('create_file', { path: 'src/components/Bad.tsx', content: BAD_COMPONENT })] },
      { toolCalls: [makeToolCall('create_file', { path: 'src/components/Gallery.tsx', content: GALLERY_CLEAN })] },
      { text: 'Génération terminée.' },
      { text: 'Je renonce.' }
    ]) as unknown as Parameters<typeof aiProviderRegistry.register>[0]);
    setProjectFormat(projectId, 'react-vite');

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/app/generate`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ prompt: 'un site galerie' })
    });
    assert.equal(res.status, 200);
    const events = await consumeSSE(res);
    const done = events.find((e) => e.type === 'done') as { ok?: boolean; imageWriteRefusals?: Array<{ path: string }> };
    assert.ok(done && done.ok === false, 'done ok:false');
    assert.ok(done.imageWriteRefusals!.some((r) => r.path === 'src/components/Bad.tsx'), 'le refus multi est tracé');

    // le fichier interdit n'a JAMAIS existé sur disque ni dans le miroir
    assert.equal(readAppFile(projectId, 'src/components/Bad.tsx'), null, 'aucun fichier interdit sur disque');
    await savedContent(projectId, 'src/components/Bad.tsx', 404);
    // …et les écritures réussies de la MÊME génération sont intactes
    assert.equal(readAppFile(projectId, 'src/components/Hero.tsx'), HERO_CLEAN);
    assert.equal(readAppFile(projectId, 'src/components/Gallery.tsx'), GALLERY_CLEAN);
    assert.equal(existsSync(join(workspaceDir(projectId), 'dist')), false, 'AUCUN dist/ (aucun build de publication)');
    const bundle = await fetch(`${baseUrl}/preview-bundle/${projectId}/`);
    assert.equal(bundle.status, 404, 'aucun bundle publié');
  });

  it('8. correction en boucle → publié conforme ; aucune trace du candidat refusé', async () => {
    const projectId = projectIds[3]!;
    templateAppSnapshot(projectId);

    aiProviderRegistry.register(new ScriptedMistralAdapter([
      { toolCalls: [makeToolCall('create_file', { path: 'src/App.tsx', content: APP_POISON })] },
      { text: 'Génération terminée.' },
      { toolCalls: [makeToolCall('create_file', { path: 'src/App.tsx', content: APP_CLEAN_LIT })] },
      { text: 'Corrigé dans la boucle.' }
    ]) as unknown as Parameters<typeof aiProviderRegistry.register>[0]);
    setProjectFormat(projectId, 'react-vite');

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/app/generate`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ prompt: 'un site simple' })
    });
    assert.equal(res.status, 200);
    const events = await consumeSSE(res);
    const types = events.map((e) => e.type);

    assert.ok(types.includes('build-ok'), 'build réussi après correction en boucle');
    const done = events.find((e) => e.type === 'done') as { ok?: boolean; imageWriteRefusals?: Array<{ path: string }> };
    assert.ok(done && done.ok === true, 'done ok:true');
    assert.ok(done.imageWriteRefusals && done.imageWriteRefusals.length === 1, 'transparence additif : le refus résolu est tracé');

    assert.equal(readAppFile(projectId, 'src/App.tsx'), APP_CLEAN_LIT, 'le contenu conforme exact est sur disque');
    assert.equal(await savedContent(projectId, 'src/App.tsx'), APP_CLEAN_LIT, 'FileStore : seul le conforme est persisté');
    const bundle = await fetch(`${baseUrl}/preview-bundle/${projectId}/`);
    assert.equal(bundle.status, 200);
    const html = await bundle.text();
    assert.ok(html.includes('Atelier L2'), 'le bundle reflète la génération');
    assert.ok(!html.includes('loremflickr') && !html.includes('forbidden.invalid'), 'aucune référence interdite dans le bundle');
  });

  it('9. génération normale inchangée (contrat compatible)', async () => {
    const projectId = projectIds[4]!;
    templateAppSnapshot(projectId);

    aiProviderRegistry.register(new ScriptedMistralAdapter([
      { toolCalls: [makeToolCall('create_file', { path: 'src/components/Hero.tsx', content: HERO_CLEAN })] },
      { toolCalls: [makeToolCall('create_file', { path: 'src/App.tsx', content: APP_CLEAN_LIT })] },
      { text: 'Génération terminée.' }
    ]) as unknown as Parameters<typeof aiProviderRegistry.register>[0]);
    setProjectFormat(projectId, 'react-vite');

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/app/generate`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ prompt: 'un site propre' })
    });
    assert.equal(res.status, 200);
    const events = await consumeSSE(res);
    const types = events.map((e) => e.type);

    assert.ok(types.includes('build-ok'));
    const done = events.find((e) => e.type === 'done') as { ok?: boolean; files?: string[]; imageWriteRefusals?: unknown };
    assert.ok(done && done.ok === true, 'done ok:true');
    assert.ok((done.files as string[]).includes('src/App.tsx'), 'le fichier est listé dans done');
    assert.equal(done.imageWriteRefusals, undefined, 'aucun refus — champ additif absent');
    assert.equal(readAppFile(projectId, 'src/components/Hero.tsx'), HERO_CLEAN);
    const bundle = await fetch(`${baseUrl}/preview-bundle/${projectId}/`);
    assert.equal(bundle.status, 200);
  });

  it('10. undetermined non bloquant : politique inchangée, le contenu est écrit et publié', async () => {
    const projectId = projectIds[5]!;
    templateAppSnapshot(projectId);

    aiProviderRegistry.register(new ScriptedMistralAdapter([
      { toolCalls: [makeToolCall('create_file', { path: 'src/App.tsx', content: APP_UNDETERMINED })] },
      { text: 'Génération terminée.' }
    ]) as unknown as Parameters<typeof aiProviderRegistry.register>[0]);
    setProjectFormat(projectId, 'react-vite');

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/app/generate`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ prompt: 'un site minimal' })
    });
    assert.equal(res.status, 200);
    const events = await consumeSSE(res);
    const types = events.map((e) => e.type);

    assert.ok(types.includes('build-ok'), 'undetermined ne bloque pas (politique L1/L7 inchangée)');
    assert.ok(!types.includes('repair'), 'aucun round images pour du undetermined');
    const done = events.find((e) => e.type === 'done') as { ok?: boolean };
    assert.ok(done && done.ok === true, 'done ok:true');
    assert.equal(readAppFile(projectId, 'src/App.tsx'), APP_UNDETERMINED, 'le contenu candidat est écrit tel quel');
    assert.equal(await savedContent(projectId, 'src/App.tsx'), APP_UNDETERMINED, 'FileStore : persisté tel quel');
    const bundle = await fetch(`${baseUrl}/preview-bundle/${projectId}/`);
    assert.equal(bundle.status, 200);
    const html = await bundle.text();
    assert.ok(html.includes('picsum.photos/seed/volaco-l2'), 'l image autorisée figure dans le bundle');
  });

  it('11. état initial préservé : un flux sans écriture du LLM n altère pas les fichiers legit du template', async () => {
    const projectId = projectIds[6]!;
    const template = templateAppSnapshot(projectId);
    const cssBefore = readAppFile(projectId, 'src/index.css');
    assert.ok(cssBefore !== null);

    aiProviderRegistry.register(new ScriptedMistralAdapter([
      { toolCalls: [makeToolCall('create_file', { path: 'src/App.tsx', content: APP_POISON })] },
      { text: 'fin.' }
    ]) as unknown as Parameters<typeof aiProviderRegistry.register>[0]);
    setProjectFormat(projectId, 'react-vite');

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/app/generate`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ prompt: 'un site refusé net' })
    });
    assert.equal(res.status, 200);
    const events = await consumeSSE(res);
    const done = events.find((e) => e.type === 'done') as { ok?: boolean };
    assert.ok(done && done.ok === false, 'done ok:false');

    // le template (fichiers legit préexistants au sens du flux) est intact
    assert.equal(readAppFile(projectId, 'src/App.tsx'), template, 'App.tsx = template');
    assert.equal(readAppFile(projectId, 'src/index.css'), cssBefore, 'index.css intact');
  });
});
