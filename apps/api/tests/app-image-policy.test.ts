/**
 * P1-B — politique d'images des APPS REACT (inspecteur + intégration routes).
 *
 * A. Unit (app-policy) : matrice des références — interdites / autorisées /
 *    indéterminées explicites ; faux positifs écartés (commentaires, script
 *    src, chaînes sans rapport) ; contrats de thème (briefs réservoir).
 * B. E2E (serveur réel + adaptateur Mistral FACTICE, aucun réseau) :
 *    génération avec UNE tentative de correction assistée puis réinspection
 *    obligatoire ; échec final SANS publication (aucun bundle) ; édition
 *    conforme préservée ; batch d'édition dont le fichier violateur est
 *    refusé par apply-skip (état antérieur intact) ; briefs par thème.
 *
 * Les assertions portent sur ce qui est RÉELLEMENT sauvegardé (FileStore via
 * GET /files/content), sur le workspace (readAppFile) et sur le bundle servi
 * (GET /preview-bundle) — jamais sur les prompts seuls.
 */

process.env.VOLACO_EXECUTION_TIMELINE = 'off';
process.env.MISTRAL_API_KEY = 'fake-key-for-tests';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { aiProviderRegistry } from '../../../packages/core/src/ai/providers/registry.js';
import type { AIProviderGenerateRequest, AIProviderGenerateResponse } from '../../../packages/core/src/ai/providers/types.js';
import { formatImageViolations, inspectAppImageSources } from '../../../packages/core/src/image/app-policy.js';
import { buildImageBrief } from '../../../packages/core/src/image/theme.js';
import {
  buildApp,
  ensureWorkspace,
  readAppFile,
  setProjectFormat,
  writeAppFile
} from '../../../packages/core/src/app-pipeline.js';

const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant_p1b_01', 'x-user-role': 'ENGINEER' };

const RESTO_FIRST = 'photo-1513104890138-7c749659a591';
// Lot B : le burger a quitté le pool restaurant (planche-contact) — l'oracle
// suit la table avec la planche de grillades vérifiée.
const RESTO_SECOND = 'photo-1555939594-58d7cb561ad1';
const CLINIQUE_FIRST = 'photo-1576091160399-112ba8d25d1d';

const RESTO_URL = 'https://images.unsplash.com/' + RESTO_SECOND + '?auto=format&fit=crop&w=1200&q=80';

function appTsx(imgLines: string[]): string {
  return 'export default function App() {\n  return (\n    <main className="min-h-screen bg-slate-950 p-10 text-slate-100">\n'
    + imgLines.join('\n')
    + '\n    </main>\n  );\n}\n';
}

// ============================================================================
// A. UNIT — l'inspecteur
// ============================================================================

describe('P1-B unit : inspectAppImageSources', () => {

  it('1. URL distante interdite dans un attribut JSX : violation nominative (fichier/ligne/hôte)', () => {
    const inspection = inspectAppImageSources([{
      path: 'src/App.tsx',
      content: appTsx(['      <img src="https://loremflickr.com/1200/800/food" alt="Plat du jour" />'])
    }]);
    assert.equal(inspection.violations.length, 1);
    const v = inspection.violations[0]!;
    assert.equal(v.path, 'src/App.tsx');
    assert.equal(v.kind, 'img-src');
    assert.equal(v.host, 'loremflickr.com');
    assert.equal(v.line, 4);
    assert.match(v.reason, /hôte non autorisé/);
  });

  it('2. Exemptions conservées à l identique : Unsplash vérifié, picsum, data:image, chemins locaux', () => {
    const inspection = inspectAppImageSources([{
      path: 'src/App.tsx',
      content: appTsx([
        '      <img src="https://images.unsplash.com/' + RESTO_FIRST + '?auto=format&fit=crop&w=1200&q=80" alt="Plat signature" />',
        '      <img src="https://picsum.photos/seed/terrasse/800/520" alt="Terrasse" />',
        '      <img src="data:image/webp;base64,iVBORw0KGgo=" alt="Données" />',
        '      <img src="./assets/logo.jpg" alt="Logo" />',
        '      <img src="/api/v1/projects/p1/images/meal.jpg" alt="Repas" />'
      ])
    }]);
    assert.equal(inspection.violations.length, 0, 'aucune violation attendue');
    assert.equal(inspection.undetermined.length, 0, 'aucun indéterminé attendu');
  });

  it('3. ID Unsplash INVENTÉ (bien formé) : détecté', () => {
    const inspection = inspectAppImageSources([{
      path: 'src/App.tsx',
      content: appTsx(['      <img src="https://images.unsplash.com/photo-1999595959599-999999999bbb?w=1200&q=80" alt="Inventée" />'])
    }]);
    assert.equal(inspection.violations.length, 1);
    assert.match(inspection.violations[0]!.reason, /hors du réservoir vérifié/);
    assert.equal(inspection.violations[0]!.host, 'images.unsplash.com');
  });

  it('4. CSS background-image url(...) interdit : détecté (css-url)', () => {
    const inspection = inspectAppImageSources([{
      path: 'src/styles.css',
      content: '/* thème */\n.hero {\n  background-image: url(\'https://loremflickr.com/g/banquet\');\n  font-family: sans-serif;\n}\n\n.local {\n  background-image: url(\'./texture.png\');\n}\n'
    }]);
    assert.equal(inspection.violations.length, 1);
    const v = inspection.violations[0]!;
    assert.equal(v.kind, 'css-url');
    assert.equal(v.host, 'loremflickr.com');
    assert.equal(v.line, 3);
  });

  it('5. Classe Tailwind bg-[url(...)] interdite : détectée (tailwind-url)', () => {
    const inspection = inspectAppImageSources([{
      path: 'src/App.tsx',
      content: appTsx(['      <section className="bg-[url(\'https://loremflickr.com/1200/800/salle\')] bg-cover h-64" />']),
    }]);
    assert.equal(inspection.violations.length, 1);
    const v = inspection.violations[0]!;
    assert.equal(v.kind, 'tailwind-url');
    assert.equal(v.host, 'loremflickr.com');
    // la variante picsum respecte le contrat existant
    const okPicsum = inspectAppImageSources([{
      path: 'src/App.tsx',
      content: appTsx(['      <section className="bg-[url(\'https://picsum.photos/seed/x/800\')] bg-cover h-64" />']),
    }]);
    assert.equal(okPicsum.violations.length, 0);
  });

  it('6. Imports et assets locaux valides : jamais signalés', () => {
    const inspection = inspectAppImageSources([{
      path: 'src/main.tsx',
      content: 'import logo from "./assets/logo.png";\nimport router from "./router";\nconst src = "/assets/hero.avif";\n'
    }]);
    assert.equal(inspection.violations.length, 0);
    assert.equal(inspection.undetermined.length, 0);
  });

  it('7. data:image/... autorisé, y compris dans src={littéral}', () => {
    const inspection = inspectAppImageSources([{
      path: 'src/App.tsx',
      content: appTsx(['      <img src={"data:image/png;base64,iVBORw0KGgo="} alt="Intégrée" />'])
    }]);
    assert.equal(inspection.violations.length, 0);
    assert.equal(inspection.undetermined.length, 0);
  });

  it('8. Commentaires, script src et chaînes sans rapport : NON signalés', () => {
    const inspection = inspectAppImageSources([{
      path: 'src/App.tsx',
      content: appTsx([
        '      // TODO : disponible https://loremflickr.com/demo',
        '      /* <img src="https://loremflickr.com/123/456/comment" /> */',
        '      <script src="https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js"></script>',
        '      <p>Consulter la documentation des images nel CDN.</p>'
      ])
    }]);
    assert.equal(inspection.violations.length, 0);
    assert.equal(inspection.undetermined.length, 0);
  });

  it('9. Références dynamiques : état INDETERMINÉ explicite (jamais validées)', () => {
    const inspection = inspectAppImageSources([{
      path: 'src/App.tsx',
      content: appTsx([
        '      <img src={heroImage} alt="Salle" />',
        '      <img src={preferred ? "https://images.unsplash.com/' + RESTO_FIRST + '?w=100" : "https://picsum.photos/seed/alt/100"} alt="Variable" />'
      ])
    }]);
    assert.equal(inspection.violations.length, 0);
    assert.ok(inspection.undetermined.length >= 2, 'les deux expressions sont déclarées indéterminées');
    assert.match(inspection.undetermined[0]!.reason, /dynamique/, 'motif explicite documenté');
    assert.equal(inspection.undetermined[0]!.kind, 'dynamic');
  });

  it('14. Briefs thématiques transmis : réservoir restaurant/clinique + mode modify distinct', () => {
    const create = buildImageBrief('restaurant', 'create');
    assert.ok(create.includes('RÉSERVOIR vérifié'));
    assert.ok(create.includes(RESTO_FIRST), 'l ID du pool restaurant figure dans le brief');
    assert.ok(create.includes('restaurant'));
    assert.notEqual(create, buildImageBrief('restaurant', 'modify'), 'le mode modify a un texte distinct');
    const modify = buildImageBrief('clinique', 'modify');
    assert.ok(modify.includes(CLINIQUE_FIRST), 'l ID du pool clinique figure dans le brief modify');
  });

  it('formatImageViolations : format mmé lisible fichier/ligne/référence/motif', () => {
    const lines = formatImageViolations(inspectAppImageSources([{
      path: 'src/App.tsx',
      content: appTsx(['      <img src="https://loremflickr.com/9/9/x" alt="x" />'])
    }]));
    assert.equal(lines[0], '- src/App.tsx ligne 4 : https://loremflickr.com/9/9/x — hôte non autorisé : loremflickr.com');
  });
});

// ============================================================================
// PATCH-1 unit — les quatre évasions démontrées par les E2E sont fermées.
// (HTML non quoté ; SVG <image href> ; style dynamique ; spread <img>.)
// Haute ligne de garde : un cas non déterminable n'est JAMAIS déclaré conforme.
// ============================================================================

describe('PATCH-1 unit : évasions fermées', () => {
  const FORBIDDEN = 'https://forbidden.invalid';

  it('P1-1. HTML src NON quoté avec hôte interdit : détecté', () => {
    const inspection = inspectAppImageSources([{
      path: 'index.html',
      content: '<!doctype html><html><body><img src=https://forbidden.invalid/photo.jpg alt="b"></body></html>'
    }]);
    assert.equal(inspection.violations.length, 1, 'la forme non quotée ne passe plus silencieusement');
    const v = inspection.violations[0]!;
    assert.equal(v.kind, 'img-src');
    assert.equal(v.host, 'forbidden.invalid');
  });

  it('P1-2. SVG <image href> avec hôte interdit : détecté (svg-image)', () => {
    const inspection = inspectAppImageSources([{
      path: 'src/App.tsx',
      content: appTsx(['      <svg viewBox="0 0 100 100"><image href="https://forbidden.invalid/s.jpg" width="100" /></svg>'])
    }]);
    assert.equal(inspection.violations.length, 1);
    assert.equal(inspection.violations[0]!.kind, 'svg-image');
    assert.equal(inspection.violations[0]!.host, 'forbidden.invalid');
  });

  it('P1-3. SVG <image xlink:href> avec hôte interdit : détecté', () => {
    const inspection = inspectAppImageSources([{
      path: 'src/App.tsx',
      content: appTsx(['      <svg viewBox="0 0 100 100"><image xlink:href="https://forbidden.invalid/x.jpg" /></svg>'])
    }]);
    assert.equal(inspection.violations.length, 1);
    assert.equal(inspection.violations[0]!.host, 'forbidden.invalid');
  });

  it('P1-4. <use href="#fragment"> local et SVG conforme : NON signalés', () => {
    const inspection = inspectAppImageSources([{
      path: 'src/App.tsx',
      content: appTsx([
        '      <svg><use href="#circle-clip" /></svg>',
        '      <svg><image href="./assets/local.png" /></svg>'
      ])
    }]);
    assert.equal(inspection.violations.length, 0);
    assert.equal(inspection.undetermined.length, 0);
  });

  it('P1-5. style url(${variable}) interpolé : violation, jamais un local silencieux', () => {
    const inspection = inspectAppImageSources([{
      path: 'src/Hero.tsx',
      content: "const [bg] = useState('https://forbidden.invalid/hero.jpg');\n"
        + "<div style={{ backgroundImage: `url(${bg})`, height: 300 }} />\n"
    }]);
    assert.equal(inspection.violations.length, 1, 'l interpolation nest plus masquée comme chemin local');
    const v = inspection.violations[0]!;
    assert.equal(v.kind, 'css-url');
    assert.match(v.reason, /dynamique/);
  });

  it('P1-6. style url(`…`) template SANS interpolation : URL statique analysée', () => {
    const bad = inspectAppImageSources([{
      path: 'src/Hero.tsx',
      content: '<div style={{ backgroundImage: `url(https://forbidden.invalid/t.jpg)`, height: 300 }} />\n'
    }]);
    assert.equal(bad.violations.length, 1, 'hôte interdit dans un template littéral sans interpolation : détecté');
    assert.equal(bad.violations[0]!.host, 'forbidden.invalid');

    const okPicsum = inspectAppImageSources([{
      path: 'src/Hero.tsx',
      content: "<div style={{ backgroundImage: `url(https://picsum.photos/seed/p1hero/800/520)` }} />\n"
    }]);
    assert.equal(okPicsum.violations.length, 0, 'picsum statique reste autorisé');
  });

  it('P1-7. style url("…") quoté statique : NON signalé (pas de faux positif)', () => {
    const inspection = inspectAppImageSources([{
      path: 'src/Hero.tsx',
      content: '<div style={{ backgroundImage: url("https://picsum.photos/seed/x/800") }} />\n'
    }]);
    assert.equal(inspection.violations.length, 0);
    assert.equal(inspection.undetermined.length, 0);
  });

  it('P1-8. <img {...imgProps} /> spread : violation (source inconnue)', () => {
    const inspection = inspectAppImageSources([{
      path: 'src/App.tsx',
      content: 'export default function App() {\n'
        + "  const imgProps = { src: 'https://forbidden.invalid/img.jpg' };\n"
        + '  return <img {...imgProps} alt="x" />;\n}\n'
    }]);
    assert.equal(inspection.violations.length, 1, 'le spread nest plus silencieux');
    const v = inspection.violations[0]!;
    assert.match(v.reason, /spread/);
  });

  it('P1-9. spread avec source INLINE locale : NON signalé', () => {
    const inspection = inspectAppImageSources([{
      path: 'src/App.tsx',
      content: 'export default function App() {\n  return <img {...{ src: "./assets/logo.png" }} alt="logo" />;\n}\n'
    }]);
    assert.equal(inspection.violations.length, 0);
    assert.equal(inspection.undetermined.length, 0);
  });

  it('P1-10. spread avec source INLINE interdite : détecté', () => {
    const inspection = inspectAppImageSources([{
      path: 'src/App.tsx',
      content: 'export default function App() {\n  return <img {...{ src: "https://forbidden.invalid/i.jpg" }} alt="x" />;\n}\n'
    }]);
    assert.equal(inspection.violations.length, 1);
    assert.equal(inspection.violations[0]!.host, 'forbidden.invalid');
  });

  it('P1-11. src littéral SUIVI dun spread : violation (le spread peut écraser à l exécution)', () => {
    const inspection = inspectAppImageSources([{
      path: 'src/App.tsx',
      content: 'export default function App() {\n'
        + "  const overrides = {};\n"
        + '  return <img src="./assets/ok.png" {...overrides} alt="x" />;\n}\n'
    }]);
    assert.equal(inspection.violations.length, 1, 'un spread APRÈS la source littérale est refusé (attribut final gagnant)');
  });

  it('P1-12. spread AVANT la source littérale : la source finale vérifiable reste la référence', () => {
    const inspection = inspectAppImageSources([{
      path: 'src/App.tsx',
      content: 'export default function App() {\n'
        + "  const base = {};\n"
        + '  return <img {...base} src="./assets/ok.png" alt="x" />;\n}\n'
    }]);
    assert.equal(inspection.violations.length, 0, 'le littéral final gagne en JSX : référence statique vérifiée');
    assert.equal(inspection.undetermined.length, 0);
  });

  it('P1-13. Les trois niveaux coexistent : violation / undetermined / conforme', () => {
    const inspection = inspectAppImageSources([
      { path: 'src/A.tsx', content: appTsx(['      <img src="https://forbidden.invalid/a.jpg" alt="a" />']) },
      { path: 'src/B.tsx', content: appTsx(['      <img src={heroImage} alt="b" />']) },
      { path: 'src/C.tsx', content: appTsx(['      <img src="https://images.unsplash.com/' + RESTO_FIRST + '?auto=format&fit=crop&w=1200&q=80" alt="c" />']) },
      { path: 'src/D.tsx', content: appTsx(['      <img src="./assets/local.png" alt="d" />']) }
    ]);
    assert.equal(inspection.violations.length, 1, 'uniquement la source interdite littérale est une violation');
    assert.ok(inspection.undetermined.length >= 1, 'src={expression} demeure explicitement undetermined');
    assert.match(inspection.undetermined[0]!.reason, /dynamique/, 'le motif undetermined reste explicite');
  });

  it('P1-14. Le contenu interdit NON quoté est détecté quelle que soit la position', () => {
    const inspection = inspectAppImageSources([{
      path: 'index.html',
      content: '<div id=root>\n  <a href=https://example-ok-site.invalid/docs>liens textes non images</a>\n'
        + '  <img src=https://forbidden.invalid/deep/x.jpg>\n</div>'
    }]);
    assert.equal(inspection.violations.length, 1, 'un lien <a href> nest pas une image : non compté ; le <img> non quoté est compté');
    assert.equal(inspection.violations[0]!.host, 'forbidden.invalid');
  });
});

// ============================================================================
// B. E2E — génération / édition protégées (adaptateur factice)
// ============================================================================

interface ScriptedTurn {
  readonly text?: string;
  readonly toolCalls?: Array<{ id: string; name: string; arguments: string }>;
}

/** Adaptateur mistral factice qui REJOUE un script de tours et CAPTURE chaque
 * appel (systemPrompt + userPrompt) pour prouver la propagation du brief. */
class ScriptedMistralAdapter {
  public readonly descriptor = {
    providerId: 'mistral',
    providerName: 'Fake Mistral (P1-B)',
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

const makeToolCall = (name: string, args: Record<string, unknown>) => ({
  id: 'call-' + Math.random().toString(36).slice(2, 8),
  name,
  arguments: JSON.stringify(args)
});

describe('P1-B E2E : génération et édition React protégées', () => {
  let server: Server;
  let baseUrl = '';
  let genProject = '';
  let failedProject = '';
  let editProject = '';
  let briefProject = '';

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

    for (const name of ['P1-B génération', 'P1-B échec images', 'P1-B édition', 'P1-B brief édition']) {
      const res = await fetch(baseUrl + '/api/v1/projects', { method: 'POST', headers: H, body: JSON.stringify({ name }) });
      assert.equal(res.status, 201);
      const data = (await res.json()) as { project?: { id?: string }; id?: string };
      const id = (data.project || data).id as string;
      assert.ok(id, 'projet créé : ' + name);
      if (!genProject) genProject = id;
      else if (!failedProject) failedProject = id;
      else if (!editProject) editProject = id;
      else briefProject = id;
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

  async function savedContent(projectId: string, path: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content?path=${encodeURIComponent('app/' + path)}`, { headers: H });
    assert.equal(res.status, 200, 'FileStore contient app/' + path);
    const parsed = (await res.json()) as { file?: { content?: string } };
    return parsed.file?.content ?? '';
  }

  /** Pré-matérialise un projet React conforme + le bundle (référence antérieure). */
  async function materializeReactProject(projectId: string): Promise<void> {
    setProjectFormat(projectId, 'react-vite');
    ensureWorkspace(projectId);
    const app = 'import Hero from \'./Hero\';\n\n'
      + 'export default function App() {\n'
      + '  return (\n'
      + '    <main className="min-h-screen bg-slate-950 p-10 text-slate-100">\n'
      + '      <h1 className="text-3xl font-bold">Studio P1-B - version 1</h1>\n'
      + '      <Hero />\n'
      + '      <img src="' + RESTO_URL + '" alt="salle" />\n'
      + '    </main>\n'
      + '  );\n'
      + '}\n';
    const hero = 'export default function Hero() {\n  return <p>Bienvenue studio</p>;\n}\n';
    for (const [path, content] of Object.entries({ 'src/App.tsx': app, 'src/Hero.tsx': hero })) {
      const w = writeAppFile(projectId, path, content);
      assert.ok(w.ok, 'écriture workspace ' + path + ' refusée : ' + (w.reason ?? ''));
    }
    const build = await buildApp(projectId);
    assert.ok(build.ok, 'build de référence : ' + build.errors.join(' | '));
  }

  it('10. Génération : UNE tentative de correction assistée, réinspection, publication conforme', async () => {
    const adapter = new ScriptedMistralAdapter([
      // tour 1 — la LLM génère une URL interdite
      { toolCalls: [makeToolCall('create_file', { path: 'src/App.tsx', content: appTsx(['      <img src="https://loremflickr.com/1200/800/food" alt="salle" />']) })] },
      { text: 'Génération terminée.' },
      // tour 3 — le round de correction images réécrit le fichier CONFORME
      { toolCalls: [makeToolCall('create_file', { path: 'src/App.tsx', content: appTsx(['      <img src="' + RESTO_URL + '" alt="salle" />']) })] },
      { text: 'Images corrigées.' }
    ]);
    aiProviderRegistry.register(adapter as unknown as Parameters<typeof aiProviderRegistry.register>[0]);
    setProjectFormat(genProject, 'react-vite');

    const res = await fetch(`${baseUrl}/api/v1/projects/${genProject}/app/generate`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ prompt: 'un site pour un restaurant de bord de mer' })
    });
    assert.equal(res.status, 200);
    const events = await consumeSSE(res);
    const types = events.map((e) => e.type);

    const imageRepairs = events.filter((e) => e.type === 'repair' && e.reason === 'images');
    assert.equal(imageRepairs.length, 1, 'UN seul round de correction images');
    assert.ok(types.includes('build-ok'), 'build réussi');
    assert.ok(types.includes('build-error') === false, 'aucune erreur de build');
    const done = events.find((e) => e.type === 'done');
    assert.ok(done && done.ok === true, 'done ok:true');

    // le contenu sauvegardé : combine URL vérifiée CONSERVÉE à l'identique et zéro interdit
    const stored = await savedContent(genProject, 'src/App.tsx');
    assert.ok(stored.includes('"' + RESTO_URL + '"'), 'l URL vérifiée est préservée telle quelle');
    assert.ok(!stored.includes('loremflickr'), 'aucune URL interdite dans le fichier sauvegardé');

    // le bundle servi est conforme (2. préservation à l'identique au niveau build)
    const bundle = await fetch(`${baseUrl}/preview-bundle/${genProject}/`);
    assert.equal(bundle.status, 200);
    const html = await bundle.text();
    assert.ok(html.includes(RESTO_SECOND), 'le bundle contient l image de réservoir');
    assert.ok(!html.includes('loremflickr'), 'le bundle ne contient jamais l hôte interdit');

    // le round de correction a reçu : violations exactes + brief réinjecté (system)
    const repairCall = adapter.calls[2]!;
    assert.ok(repairCall.user.includes('loremflickr'), 'violations nourries au LLM (référence exacte)');
    assert.ok(repairCall.user.includes('ligne'), 'motif avec ligne');
    assert.ok(repairCall.system.includes('RÉSERVOIR vérifié'), 'brief de génération réinjecté pendant la correction');
  });

  it('11. Génération : violation persistante -> REFUS, aucune publication silencieuse', async () => {
    const violating = appTsx(['      <img src="https://loremflickr.com/1200/800/kitchen" alt="cuisine" />']);
    const adapter = new ScriptedMistralAdapter([
      // boucle de génération : un fichier violateur puis une fin de tour
      { toolCalls: [makeToolCall('create_file', { path: 'src/App.tsx', content: violating })] },
      { text: 'Génération terminée.' },
      // round de correction images : le modèle RÉÉCRIT la même violation
      { toolCalls: [makeToolCall('create_file', { path: 'src/App.tsx', content: violating })] },
      { text: 'Je considère cela corrigé.' }
    ]);
    aiProviderRegistry.register(adapter as unknown as Parameters<typeof aiProviderRegistry.register>[0]);
    setProjectFormat(failedProject, 'react-vite');

    const res = await fetch(`${baseUrl}/api/v1/projects/${failedProject}/app/generate`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ prompt: 'un site pour un restaurant' })
    });
    assert.equal(res.status, 200);
    const events = await consumeSSE(res);
    const types = events.map((e) => e.type);

    assert.equal(events.filter((e) => e.type === 'repair' && e.reason === 'images').length, 1, 'UN round images tenté');
    assert.ok(types.includes('error'), 'l échec est explicitement signalé');
    assert.ok(!types.includes('build-ok') && !types.includes('build-error'), 'AUCUN build lancé (aucune publication)');
    const done = events.find((e) => e.type === 'done');
    assert.ok(done && done.ok === false, 'done ok:false — génération NON déclarée réussie');
    const issues = done!.imageIssues as string[];
    assert.ok(Array.isArray(issues) && issues.length >= 1, 'les violations images sont listées');
    assert.ok(issues.join(' | ').includes('loremflickr'), 'la violation montrée cite l hôte interdit');

    // le bundle n'existe pas : rien n'a remplacé une version antérieure
    const bundle = await fetch(`${baseUrl}/preview-bundle/${failedProject}/`);
    assert.equal(bundle.status, 404, 'aucun bundle publié pour un échec d images');
  });

  it('13. Édition conforme : comportement existant préservé (appliquée, bundle à jour)', async () => {
    await materializeReactProject(editProject);

    const res = await fetch(`${baseUrl}/api/v1/projects/${editProject}/app/apply-edits`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        edits: [{ action: 'edit', path: 'src/App.tsx', find: 'Studio P1-B - version 1', replace: 'Studio P1-B - version 2' }]
      })
    });
    assert.equal(res.status, 200);
    const events = await consumeSSE(res);
    const types = events.map((e) => e.type);

    assert.ok(types.includes('applied'), 'l édition conforme est appliquée');
    assert.ok(!types.some((t) => t === 'apply-skip'), 'aucun skip');
    const done = events.find((e) => e.type === 'done');
    assert.ok(done && done.ok === true && done.applied === 1);

    const bundle = await fetch(`${baseUrl}/preview-bundle/${editProject}/`);
    assert.equal(bundle.status, 200);
    const html = await bundle.text();
    assert.ok(html.includes('Studio P1-B - version 2'), 'le bundle reflète l édition conforme');
    assert.ok(html.includes('Bienvenue studio'), 'Hero (importé) reste présent dans le bundle');
  });

  it('12+15. Édition : violation -> apply-skip du fichier, AUCUN écrit partiel, état antérieur intact', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${editProject}/app/apply-edits`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        edits: [
          // fichier violateur : l URL vérifiée remplacée par un hôte interdit
          { action: 'edit', path: 'src/App.tsx', find: '"' + RESTO_URL + '"', replace: '"https://loremflickr.com/1200/800/room"' },
          // autre fichier, conforme : doit passer (validité préalable de l ENSEMBLE)
          { action: 'edit', path: 'src/Hero.tsx', find: 'Bienvenue studio', replace: 'Bienvenue studio V2' }
        ]
      })
    });
    assert.equal(res.status, 200);
    const events = await consumeSSE(res);

    const skip = events.find((e) => e.type === 'apply-skip') as { path?: string; reason?: string } | undefined;
    assert.ok(skip, 'un apply-skip est émis');
    assert.equal(skip!.path, 'src/App.tsx');
    assert.match(skip!.reason ?? '', /images interdites.*loremflickr/);

    const applied = events.filter((e) => e.type === 'applied');
    assert.equal(applied.length, 1);
    assert.equal(applied[0]!.path, 'src/Hero.tsx');
    const done = events.find((e) => e.type === 'done') as { ok?: boolean; applied?: number } | undefined;
    assert.ok(done && done.applied === 1, 'un seul fichier appliqué');

    // PRÉSERVATION : src/App.tsx reste EXACTEMENT identique sur disque et FileStore
    const stored = await savedContent(editProject, 'src/App.tsx');
    assert.ok(stored.includes('"' + RESTO_URL + '"'), 'FileStore : l URL vérifiée est intacte');
    assert.ok(!stored.includes('loremflickr'), 'FileStore : aucune URL interdite');
    const onDisk = readAppFile(editProject, 'src/App.tsx');
    assert.ok(onDisk !== null && onDisk.includes('"' + RESTO_URL + '"'), 'workspace : l URL vérifiée est intacte');

    // le bundle publié : changement conforme appliqué, fichier refusé inchangé
    const bundle = await fetch(`${baseUrl}/preview-bundle/${editProject}/`);
    assert.equal(bundle.status, 200);
    const html = await bundle.text();
    assert.ok(html.includes('Bienvenue studio V2'), 'l édition conforme est publiée');
    assert.ok(html.includes(RESTO_SECOND), 'l image du fichier refusé reste celle de la version antérieure');
    assert.ok(!html.includes('loremflickr'), 'aucun hôte interdit n est publié');
  });

  it('14. Édition : le brief modify du thème est DANS le prompt réel (app/edit)', async () => {
    const expected = buildImageBrief('clinique', 'modify');
    const adapter = new ScriptedMistralAdapter([
      { toolCalls: [makeToolCall('edit_file', { path: 'src/Hero.tsx', find: 'Bienvenue', replace: 'Section soins' })] },
      { text: 'Proposition prête.' }
    ]);
    aiProviderRegistry.register(adapter as unknown as Parameters<typeof aiProviderRegistry.register>[0]);

    const res = await fetch(`${baseUrl}/api/v1/projects/${briefProject}/app/edit`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ instruction: 'ajoute une section de soins dentaires' })
    });
    assert.equal(res.status, 200);
    const events = await consumeSSE(res);
    assert.ok(events.some((e) => e.type === 'proposals'), 'propositions émises');

    const call = adapter.calls[0]!;
    assert.ok(call.system.includes(expected), 'le prompt d édition embarque le brief modify calculé pour ce thème');
  });
});

// ============================================================================
// PATCH-1 E2E — les formes précédemment publiables (audit R1) sont REFUSÉES
// par le pipeline réel (serveur réel + adaptateur factice, aucun réseau) :
// round de correction images → réinspection → refus, AUCUN bundle (404).
// Et le pattern conforme (template littéral SANS interpolation) reste publié.
// ============================================================================

describe('PATCH-1 E2E : les évasions ne sont pas publiables', () => {
  let server: Server;
  let baseUrl = '';
  let styleProject = '';
  let spreadProject = '';
  let htmlProject = '';
  let svgProject = '';
  let allowedProject = '';

  const STYLE_EVIL = 'import { useState } from \'react\';\n\n'
    + 'export default function App() {\n'
    + '  const [bg] = useState(\'https://forbidden.invalid/hero.jpg\');\n'
    + '  return (\n'
    + '    <main className="min-h-screen bg-slate-950 p-10 text-slate-100">\n'
    + '      <section style={{ backgroundImage: `url(${bg})`, height: 300 }} />\n'
    + '    </main>\n'
    + '  );\n'
    + '}\n';

  const SPREAD_EVIL = 'export default function App() {\n'
    + '  const imgProps = { src: \'https://forbidden.invalid/img.jpg\' };\n'
    + '  return (\n'
    + '    <main className="min-h-screen bg-slate-950 p-10 text-slate-100">\n'
    + '      <img {...imgProps} alt="x" />\n'
    + '    </main>\n'
    + '  );\n'
    + '}\n';

  const STYLE_OK = 'export default function App() {\n'
    + '  return (\n'
    + '    <main className="min-h-screen bg-slate-950 p-10 text-slate-100">\n'
    + '      <h1 className="text-3xl font-bold">Studio PATCH-1 conforme</h1>\n'
    + '      <section style={{ backgroundImage: `url(https://picsum.photos/seed/p1hero/800/520)` }} className="h-64 bg-cover" />\n'
    + '    </main>\n'
    + '  );\n'
    + '}\n';

  before(async () => {
    // Hygiène d'environnement : les builds Vite du describe précédent
    // persist process.env.NODE_ENV = 'production' dans CE process de test ;
    // le boot ci-dessous doit rester en développement (mode dev sans Bearer).
    delete process.env.NODE_ENV;
    const { createApiServer } = await import('../src/server.js');
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        baseUrl = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
        resolve();
      });
    });
    for (const name of ['PATCH-1 style dynamique', 'PATCH-1 spread', 'PATCH-1 html non quoté', 'PATCH-1 svg image', 'PATCH-1 conforme']) {
      const res = await fetch(baseUrl + '/api/v1/projects', { method: 'POST', headers: H, body: JSON.stringify({ name }) });
      assert.equal(res.status, 201);
      const id = ((await res.json()) as { project?: { id?: string } }).project?.id as string;
      assert.ok(id, 'projet créé : ' + name);
      if (!styleProject) styleProject = id;
      else if (!spreadProject) spreadProject = id;
      else if (!htmlProject) htmlProject = id;
      else if (!svgProject) svgProject = id;
      else allowedProject = id;
    }
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** Lecteur SSE local (identique à consumeSSE du harnais existant). */
  async function readSse(res: Response): Promise<Array<Record<string, unknown>>> {
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
        try { events.push(JSON.parse(line.slice(6)) as Record<string, unknown>); } catch { /* ignoré */ }
      }
    }
    return events;
  }

  /** Générateur d un scénario de REFUS : violation persistante → aucun bundle. */
  async function expectRefusal(projectId: string, file: string, content: string, prompt: string, mustMention: string): Promise<void> {
    const adapter = new ScriptedMistralAdapter([
      { toolCalls: [makeToolCall('create_file', { path: file, content })] },
      { text: 'Génération terminée.' },
      { toolCalls: [makeToolCall('create_file', { path: file, content })] },
      { text: 'Je considère cela corrigé.' }
    ]);
    aiProviderRegistry.register(adapter as unknown as Parameters<typeof aiProviderRegistry.register>[0]);
    setProjectFormat(projectId, 'react-vite');
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/app/generate`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ prompt })
    });
    assert.equal(res.status, 200);
    const events = await readSse(res);
    const types = events.map((e) => e.type);
    assert.equal(events.filter((e) => e.type === 'repair' && e.reason === 'images').length, 1, 'UN seul round images tenté');
    assert.ok(!types.includes('build-ok') && !types.includes('build-error'), 'AUCUN build lancé (aucune publication)');
    const done = events.find((e) => e.type === 'done') as { ok?: boolean; imageIssues?: string[] } | undefined;
    assert.ok(done && done.ok === false, 'done ok:false — génération NON déclarée réussie');
    const issues = done!.imageIssues as string[];
    assert.ok(Array.isArray(issues) && issues.length >= 1, 'les références non conformes sont listées');
    assert.ok(issues.join(' | ').includes(mustMention), 'la violation cite la référence réelle (' + mustMention + ')');
    const bundle = await fetch(`${baseUrl}/preview-bundle/${projectId}/`);
    assert.equal(bundle.status, 404, 'aucun bundle publié pour une forme non validable');
  }

  it('16. style backgroundImage url(${variable}) interpolation : REFUS + aucun bundle', async () => {
    await expectRefusal(styleProject, 'src/App.tsx', STYLE_EVIL, 'un site vitrine contemporain', 'dynamique');
  });

  it('17. <img {...imgProps} /> spread : REFUS + aucun bundle', async () => {
    await expectRefusal(spreadProject, 'src/App.tsx', SPREAD_EVIL, 'un site vitrine boutique', 'spread');
  });

  it('18. HTML <img src=…> NON quoté : REFUS + aucun bundle', async () => {
    const html = '<!doctype html>\n<html lang="fr">\n  <body>\n    <img src=https://forbidden.invalid/photo.jpg alt="b">\n  </body>\n</html>\n';
    await expectRefusal(htmlProject, 'index.html', html, 'un site vitrine simple', 'forbidden.invalid');
  });

  it('19. SVG <image href="…"> : REFUS + aucun bundle', async () => {
    const svg = 'export default function App() {\n'
      + '  return (\n'
      + '    <main className="min-h-screen bg-slate-950 p-10 text-slate-100">\n'
      + '      <svg viewBox="0 0 100 100"><image href="https://forbidden.invalid/s.jpg" width="100" /></svg>\n'
      + '    </main>\n'
      + '  );\n'
      + '}\n';
    await expectRefusal(svgProject, 'src/App.tsx', svg, 'un site vitrine illustré', 'forbidden.invalid');
  });

  it('20. style url(…) template SANS interpolation (picsum) : publié conforme, pas de faux positif', async () => {
    const adapter = new ScriptedMistralAdapter([
      { toolCalls: [makeToolCall('create_file', { path: 'src/App.tsx', content: STYLE_OK })] },
      { text: 'Génération terminée.' }
    ]);
    aiProviderRegistry.register(adapter as unknown as Parameters<typeof aiProviderRegistry.register>[0]);
    setProjectFormat(allowedProject, 'react-vite');
    const res = await fetch(`${baseUrl}/api/v1/projects/${allowedProject}/app/generate`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ prompt: 'un site vitrine avec photo neutre' })
    });
    assert.equal(res.status, 200);
    const events = await readSse(res);
    const types = events.map((e) => e.type);
    assert.ok(types.includes('build-ok'), 'la source conforme compile et se publie');
    const done = events.find((e) => e.type === 'done');
    assert.ok(done && done.ok === true, 'done ok:true pour une source conforme');

    const bundle = await fetch(`${baseUrl}/preview-bundle/${allowedProject}/`);
    assert.equal(bundle.status, 200);
    const html = await bundle.text();
    assert.ok(html.includes('picsum.photos/seed/p1hero'), 'l image statique autorisée figure dans le bundle');
    assert.ok(!html.includes('forbidden.invalid'), 'aucune référence interdite dans le bundle');
  });
});

