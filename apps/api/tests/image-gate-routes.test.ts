/**
 * PATCH-R3-B — la porte d'images couvre les routes d'écriture :
 *   B1 : PUT /api/v1/projects/:id/files/content
 *   B2 : PUT /api/v1/projects/:id/files/section/:name
 *   B3 : POST /api/v1/projects/:id/revisions
 *
 * Le contenu inspecté est EXACTEMENT celui qui serait persisté ; un refus
 * (convention PATCH-2 : HTTP 200 + success:false) ne laisse AUCUN effet de
 * bord vérifiable (fichier, compteur de révisions, bundle).
 *
 * Limite documentée (seam) : le checker réel ne lève pas d'exception sur des
 * chaînes habituelles, une erreur d'inspection n'est donc PAS injectable via
 * le schéma HTTP public — le fail-closed est couvert par des tests unitaires
 * sur le seam (injection d'un inspecteur qui lève), utilisé tel quel par les
 * trois routes.
 */

process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { projectStore } from '../../../packages/core/src/identity/project.js';
import { imageGateInspect, imageGateInputsFromFilesMap } from '../src/middleware/image-gate.js';

const CONFORM_HTML = '<!DOCTYPE html><html><head><title>Porte B rac</title></head><body><p>conforme</p></body></html>';
const CONFORM_TSX = 'export default function App() {\n'
  + '  return (\n'
  + '    <main>\n'
  + '      <img src="https://picsum.photos/seed/r3bgate/800/500" alt="neutre" />\n'
  + '    </main>\n'
  + '  );\n'
  + '}\n';
const POISON_HTML = '<p><img src="https://forbidden.invalid/hero.jpg" alt="poison" /></p>';
const POISON_TSX = 'export default function App() {\n'
  + '  return (<main><img src="https://forbidden.invalid/r3b.jpg" alt="poison" /></main>);\n'
  + '}\n';
const POISON_CSS = 'body { background: url("https://forbidden.invalid/bg.png"); }\n';
const UNDETERMINED_TSX = 'export default function App() {\n'
  + '  const hero = Math.random() > 0.5 ? "a" : "b";\n'
  + '  return (<main><img src={hero} alt="indeterminee" /></main>);\n'
  + '}\n';

const SECTIONED_HTML = '<!DOCTYPE html><html><head><title>B2</title></head><body>\n'
  + '<div class="vibe-stitched" data-section="header"><header><span>S</span></header></div>\n'
  + '<div class="vibe-stitched" data-section="hero"><section><h1>Ancien</h1></section></div>\n'
  + '</body></html>';

interface RefusalShape {
  success: false;
  refused: 'images' | 'inspection-error';
  imageIssues: string[];
  requestId: string;
}

/** Contrat de refus commun (convention PATCH-2). */
const assertRefusal = (data: unknown): void => {
  const d = data as RefusalShape;
  assert.equal(d.success, false, 'un refus ne doit jamais être success:true');
  assert.ok(d.refused === 'images' || d.refused === 'inspection-error', 'refused expliqué');
  assert.ok(Array.isArray(d.imageIssues) && d.imageIssues.length > 0, 'issues formatées');
  assert.equal(typeof d.requestId, 'string');
};

/** Ouvre un serveur API réel (port 0) pour un tenant dédié (pas de clear()). */
const openServer = async (
  tenantId: string,
  projectName: string
): Promise<{ server: Server; baseUrl: string; projectId: string }> => {
  const project = projectStore.createProject(tenantId, projectName);
  const instance = createApiServer({ port: 0 });
  const server = instance.server;
  const baseUrl = await new Promise<string>((resolve) => {
    server.listen(0, () => {
      const address = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
  return { server, baseUrl, projectId: project.id };
};

const closeServer = (server: Server): Promise<void> =>
  new Promise<void>((resolve) => {
    server.close(() => resolve());
  });

const H = (tenant: string) => ({
  'Content-Type': 'application/json',
  'X-Tenant-Id': tenant,
  'X-User-Role': 'ENGINEER'
});

const putContent = async (
  baseUrl: string,
  projectId: string,
  tenant: string,
  path: string,
  content: string
): Promise<Response> => {
  return fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
    method: 'PUT',
    headers: H(tenant),
    body: JSON.stringify({ path, content })
  });
};

const getContent = async (
  baseUrl: string,
  projectId: string,
  tenant: string,
  path: string
): Promise<Response> => {
  return fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`, {
    headers: { 'X-Tenant-Id': tenant }
  });
};

const countRevisions = async (
  baseUrl: string,
  projectId: string,
  tenant: string
): Promise<number> => {
  const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions`, {
    headers: { 'X-Tenant-Id': tenant }
  });
  assert.equal(res.status, 200);
  const data = (await res.json()) as { revisions: Array<{ id: string }> };
  return data.revisions.length;
};

// ============================================================================
// GARDE PARTAGÉ — unitaire (le même helper est appelé par B1, B2, B3)
// ============================================================================

describe('PATCH-R3-B unit : garde partagé image-gate', () => {
  it('U1. violation détectée : issues formatées citant chemin et URL interdite', () => {
    const out = imageGateInspect([{ path: 'src/App.tsx', content: POISON_TSX }]);
    assert.equal(out.kind, 'violations');
    const joined = out.imageIssues.join('\n');
    assert.ok(joined.includes('forbidden.invalid'), 'URL exacte citée : ' + joined);
    assert.ok(joined.includes('src/App.tsx'), 'chemin cité : ' + joined);
  });

  it('U2. contenu conforme : aucune entrave', () => {
    const out = imageGateInspect([
      { path: 'src/App.tsx', content: CONFORM_TSX },
      { path: 'index.html', content: CONFORM_HTML }
    ]);
    assert.equal(out.kind, 'clean');
    assert.equal(out.imageIssues.length, 0);
  });

  it('U3. exception du vérificateur : refus fail-closed (le doute refuse, jamais accepté)', () => {
    const out = imageGateInspect([{ path: 'index.html', content: '<p>peu importe</p>' }], () => {
      throw new Error('inspection virtuelle en échec');
    });
    assert.equal(out.kind, 'inspection-error');
    assert.ok(out.imageIssues[0]!.includes('fail-closed'), 'motif fail-closed : ' + out.imageIssues[0]);
    assert.ok(out.imageIssues[0]!.includes('inspection virtuelle en échec'), 'détail conservé court');
  });

  it('U4. undetermined : état distinct, non bloquant, jamais déclaré conforme', () => {
    const out = imageGateInspect([{ path: 'src/App.tsx', content: UNDETERMINED_TSX }]);
    assert.equal(out.kind, 'clean', 'undetermined n est pas une violation');
    assert.equal(out.imageIssues.length, 0);
    assert.ok(out.undeterminedCount >= 1, 'compteur exposé distinctement');
  });

  it('U5. carte files : seules les valeurs string non vides, préfixe app/ dépouillé côté inspection', () => {
    const inputs = imageGateInputsFromFilesMap({
      'app/src/App.tsx': CONFORM_TSX,
      'app/assets/blob.png': 'blob-non-scanne-extension-non-inspectable',
      'index.html': CONFORM_HTML,
      'empty.txt': '',
      'notstring.json': 42
    });
    assert.deepEqual(
      inputs.map((i) => i.path),
      ['src/App.tsx', 'assets/blob.png', 'index.html'],
      'préfixe app/ dépouillé, string vides et non-strings ignorées'
    );
    // un poison inside .png : extension non inspectable → la politique ne le
    // classe pas comme violation (aucun faux refus de fichier non concerné).
    const png = imageGateInspect(imageGateInputsFromFilesMap({ 'app/assets/blob.png': POISON_TSX }));
    assert.equal(png.kind, 'clean');
    // le poison inside .tsx : détecté, chemin rapporté SANS le préfixe app/
    const tsx = imageGateInspect(imageGateInputsFromFilesMap({ 'app/src/App.tsx': POISON_TSX }));
    assert.equal(tsx.kind, 'violations');
    assert.ok(tsx.imageIssues.join('\n').includes('src/App.tsx'));
  });
});

// ============================================================================
// B1 — PUT /files/content
// ============================================================================

describe('PATCH-R3-B B1 : PUT /files/content', () => {
  let server: Server;
  let baseUrl = '';
  let projectId = '';
  const tenant = 'tenant_imggate_b1';

  before(async () => {
    ({ server, baseUrl, projectId } = await openServer(tenant, 'Projet Porte B1'));
  });
  after(async () => {
    await closeServer(server);
  });

  const H1 = H(tenant);

  it('1. écriture légitime acceptée — contrat de succès préservé, contenu relisible à l identique', async () => {
    const res = await putContent(baseUrl, projectId, tenant, 'index.html', CONFORM_HTML);
    assert.equal(res.status, 200);
    const data = (await res.json()) as { result: { path: string; sha256: string; workspaceSynced: boolean }; requestId: string };
    assert.equal(data.result.path, 'index.html');
    assert.equal(data.result.sha256.length, 64);
    assert.equal(typeof data.requestId, 'string');

    const get = await getContent(baseUrl, projectId, tenant, 'index.html');
    assert.equal(get.status, 200);
    const g = (await get.json()) as { file: { content: string } };
    assert.equal(g.file.content, CONFORM_HTML, 'identité byte-à-byte');
  });

  it('2. contenu interdit refusé — le fichier absent reste absent (aucune écriture)', async () => {
    const res = await putContent(baseUrl, projectId, tenant, 'app/src/App.tsx', POISON_TSX);
    assert.equal(res.status, 200, 'convention PATCH-2 : refus HTTP 200');
    const data = await res.json() as unknown;
    assertRefusal(data);
    assert.equal((data as RefusalShape).refused, 'images');
    assert.ok((data as RefusalShape).imageIssues.join('\n').includes('forbidden.invalid'));

    const get = await getContent(baseUrl, projectId, tenant, 'app/src/App.tsx');
    assert.equal(get.status, 404, 'aucun fichier créé par la tentative refusée');
  });

  it('3. contenu antérieur intact après refus (réécriture toxique refusée)', async () => {
    const res = await putContent(baseUrl, projectId, tenant, 'index.html', POISON_HTML);
    assert.equal(res.status, 200);
    const data = await res.json() as unknown;
    assertRefusal(data);
    assert.equal((data as RefusalShape).refused, 'images');

    const get = await getContent(baseUrl, projectId, tenant, 'index.html');
    const g = (await get.json()) as { file: { content: string } };
    assert.equal(g.file.content, CONFORM_HTML, 'octet pour octet, l antérieur est intact');
  });

  it('4. fichier non concerné par la politique (md) : retour légitime conservé', async () => {
    const notes = '# Notes\n<img src="https://forbidden.invalid/notes.jpg">\n';
    const res = await putContent(baseUrl, projectId, tenant, 'notes.md', notes);
    assert.equal(res.status, 200);
    const data = (await res.json()) as { result: { path: string } };
    assert.equal(data.result.path, 'notes.md');
    const get = await getContent(baseUrl, projectId, tenant, 'notes.md');
    const g = (await get.json()) as { file: { content: string } };
    assert.equal(g.file.content, notes, 'le type non inspectable ne subit aucun refus');
  });

  it('5. poison CSS url() refusé via la même porte', async () => {
    const res = await putContent(baseUrl, projectId, tenant, 'app/src/styles.css', POISON_CSS);
    assert.equal(res.status, 200);
    const data = await res.json() as unknown;
    assertRefusal(data);
    assert.equal((data as RefusalShape).refused, 'images');
    const get = await getContent(baseUrl, projectId, tenant, 'app/src/styles.css');
    assert.equal(get.status, 404, 'aucun fichier créé');
  });

  it('6. permissions préservées : VIEWER reste 403 (le contenu passe la porte, le RBAC antérieur s applique)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenant, 'X-User-Role': 'VIEWER' },
      body: JSON.stringify({ path: 'viewer.html', content: '<p>ok</p>' })
    });
    assert.equal(res.status, 403, 'le contrôle RBAC préexistant est intact');
  });
});

// ============================================================================
// B2 — PUT /files/section/:name
// ============================================================================

describe('PATCH-R3-B B2 : PUT /files/section', () => {
  let server: Server;
  let baseUrl = '';
  let projectId = '';
  const tenant = 'tenant_imggate_b2';

  before(async () => {
    ({ server, baseUrl, projectId } = await openServer(tenant, 'Projet Porte B2'));
    const seed = await putContent(baseUrl, projectId, tenant, 'index.html', SECTIONED_HTML);
    assert.equal(seed.status, 200);
  });
  after(async () => {
    await closeServer(server);
  });

  const putSection = async (name: string, html: string): Promise<Response> => {
    return fetch(`${baseUrl}/api/v1/projects/${projectId}/files/section/${name}`, {
      method: 'PUT',
      headers: H(tenant),
      body: JSON.stringify({ html })
    });
  };

  const content = async (): Promise<string> => {
    const get = await getContent(baseUrl, projectId, tenant, 'index.html');
    return ((await get.json()) as { file: { content: string } }).file.content;
  };

  it('1. modification légitime acceptée : applied:true + revisionId (contrat préservé)', async () => {
    const res = await putSection('hero', '<section><h1>Nouveau</h1></section>');
    assert.equal(res.status, 200);
    const data = (await res.json()) as { applied: boolean; revisionId?: string };
    assert.equal(data.applied, true);
    assert.ok(data.revisionId, 'la révision légitime est créée');

    const html = await content();
    assert.ok(html.includes('<div class="vibe-stitched" data-section="hero"><section><h1>Nouveau</h1></section></div>'));
    assert.ok(html.includes('data-section="header"'), 'header intact');
  });

  it('2. violation refusée AVANT toute écriture : fichier, compteur de révisions et bundle intacts', async () => {
    const before = await content();
    const revBefore = await countRevisions(baseUrl, projectId, tenant);
    const bundleBefore = await fetch(`${baseUrl}/preview-bundle/${projectId}/`);

    const res = await putSection('hero', '<section><img src="https://forbidden.invalid/sec.jpg" alt="p" /></section>');
    assert.equal(res.status, 200);
    const data = await res.json() as unknown;
    assertRefusal(data);
    assert.equal((data as RefusalShape).refused, 'images');
    assert.ok((data as RefusalShape).imageIssues.join('\n').includes('forbidden.invalid'));

    assert.equal(await content(), before, 'octet pour octet : aucun fichier écrit');
    assert.equal(await countRevisions(baseUrl, projectId, tenant), revBefore, 'aucune révision dérivée');
    // projet HTML : aucun bundle n existe ; le 404 STABLE au minimum prouve
    // qu aucun build n a été déclenché par le refus (preuve faible assumée —
    // la préservation d un bundle existant est couverte par PATCH-2/MCP).
    const bundleAfter = await fetch(`${baseUrl}/preview-bundle/${projectId}/`);
    assert.equal(bundleBefore.status, 404);
    assert.equal(bundleAfter.status, 404);
  });

  it('3. séquences de remplacement $&, $1, $\' : LITTÉRALES dans le contenu injecté', async () => {
    const tricky = "A$&B$1C$'D";
    const res = await putSection('hero', `<section>${tricky}</section>`);
    assert.equal(res.status, 200);
    const data = (await res.json()) as { applied: boolean };
    assert.equal(data.applied, true, 'contenu conforme : accepté');

    const html = await content();
    assert.ok(
      html.includes('<div class="vibe-stitched" data-section="hero"><section>A$&B$1C$\'D</section></div>'),
      'séquences $ stockées à l identique : ' + html
    );
    assert.ok(!html.includes('data-section="hero"><div'), 'aucun remplacement $& (le match passé n est pas injecté)');
  });

  it('4. section absente et contenu inchangé : comportement antérieur conservé, pas de révision', async () => {
    const revBefore = await countRevisions(baseUrl, projectId, tenant);

    const miss = await putSection('footer', '<footer>f</footer>');
    assert.equal(miss.status, 200);
    const missData = (await miss.json()) as { applied: boolean; reason?: string };
    assert.equal(missData.applied, false);
    assert.equal(missData.reason, 'section-not-found');

    const same = await putSection('hero', '<section>A$&B$1C$\'D</section>');
    assert.equal(same.status, 200);
    const sameData = (await same.json()) as { applied: boolean; reason?: string };
    assert.equal(sameData.applied, false);
    assert.equal(sameData.reason, 'unchanged');

    assert.equal(await countRevisions(baseUrl, projectId, tenant), revBefore, 'aucune révision pour un no-op');
  });

  it('5. plusieurs correspondances : seule la PREMIÈRE occurrence est remplacée', async () => {
    const dupHtml = '<!DOCTYPE html><html><head><title>Dup</title></head><body>\n'
      + '<div class="vibe-stitched" data-section="dup"><section><em>premier</em></section></div>\n'
      + '<div class="vibe-stitched" data-section="dup"><section><span>second-intact</span></section></div>\n'
      + '</body></html>';
    const seed = await putContent(baseUrl, projectId, tenant, 'index.html', dupHtml);
    assert.equal(seed.status, 200);

    const res = await putSection('dup', '<b>FIRST</b>');
    assert.equal(res.status, 200);
    const data = (await res.json()) as { applied: boolean };
    assert.equal(data.applied, true);

    const html = await content();
    assert.equal(html.split('<b>FIRST</b>').length - 1, 1, 'un seul bloc remplacé');
    assert.ok(html.indexOf('<b>FIRST</b>') < html.indexOf('second-intact'), 'le PREMIER bloc est remplacé');
    assert.ok(html.includes('<span>second-intact</span>'), 'le second bloc reste intact');
  });
});

// ============================================================================
// B3 — POST /revisions
// ============================================================================

describe('PATCH-R3-B B3 : POST /revisions', () => {
  let server: Server;
  let baseUrl = '';
  let projectId = '';
  const tenant = 'tenant_imggate_b3';

  before(async () => {
    ({ server, baseUrl, projectId } = await openServer(tenant, 'Projet Porte B3'));
  });
  after(async () => {
    await closeServer(server);
  });

  const postRevision = async (body: object): Promise<Response> => {
    return fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions`, {
      method: 'POST',
      headers: H(tenant),
      body: JSON.stringify(body)
    });
  };

  it('1. révision légitime acceptée : 201, champs et chemins conservés', async () => {
    const res = await postRevision({
      message: 'Initial légitime',
      author: 'gate-b3',
      files: { 'index.html': CONFORM_HTML, 'app/src/App.tsx': CONFORM_TSX },
      decisions: [{ id: 'd1' }],
      provenance: { source: 'USER', prompt: 'création conforme' }
    });
    assert.equal(res.status, 201);
    const data = (await res.json()) as { revision: { id: string; revisionNumber: number; files: Record<string, { hash: string }>; author: string } };
    assert.equal(typeof data.revision.id, 'string');
    assert.ok(data.revision.files['index.html'], 'artefact index.html conservé');
    assert.ok(data.revision.files['app/src/App.tsx'], 'artefact app/src/App.tsx conservé (chemin intact)');
    assert.equal(data.revision.files['app/src/App.tsx'].hash.length, 64);
    assert.equal(data.revision.author, 'gate-b3');

    const list = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions`, { headers: { 'X-Tenant-Id': tenant } });
    const listing = (await list.json()) as { revisions: Array<{ id: string; author: string; message: string }> };
    assert.ok(
      listing.revisions.some((r) => r.id === data.revision.id && r.author === 'gate-b3' && r.message === 'Initial légitime'),
      'les champs soumis sont restitués'
    );
  });

  it('2. contenu interdit refusé : aucune révision ni artefact partiel (mixte clean + poison)', async () => {
    const revBefore = await countRevisions(baseUrl, projectId, tenant);
    const res = await postRevision({
      message: 'Mélange poison',
      files: { 'index.html': CONFORM_HTML, 'app/src/App.tsx': POISON_TSX }
    });
    assert.equal(res.status, 200);
    const data = await res.json() as unknown;
    assertRefusal(data);
    assert.equal((data as RefusalShape).refused, 'images');
    assert.ok((data as RefusalShape).imageIssues.join('\n').includes('forbidden.invalid'));
    assert.ok((data as { revision?: unknown }).revision === undefined, 'aucune révision partielle');
    assert.equal(await countRevisions(baseUrl, projectId, tenant), revBefore, 'compteur inchangé');
  });

  it('3. regression PATCH-2 exclue : rollback d une révision conforme continue de restaurer', async () => {
    const created = await postRevision({
      message: 'Suspend',
      files: { 'index.html': '<html><body>Suspend</body></html>' }
    });
    assert.equal(created.status, 201);
    const rev = ((await created.json()) as { revision: { id: string } }).revision.id;

    // mutation du FileStore PUIS rollback : le contenu de la révision cible
    // est restauré par le chemin PATCH-2 (gate rollback intacte).
    const mutate = await putContent(baseUrl, projectId, tenant, 'index.html', '<html><body>Modifié après</body></html>');
    assert.equal(mutate.status, 200);

    const rb = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions/${rev}/rollback`, {
      method: 'POST',
      headers: H(tenant)
    });
    assert.equal(rb.status, 200);
    const rbData = (await rb.json()) as { rollbackRevision: { files: Record<string, { content: string }> } };
    const rollbackFiles = rbData.rollbackRevision.files;
    const rollbackHtml = rollbackFiles['index.html'];
    assert.ok(rollbackHtml, 'la révision de rollback contient index.html');
    assert.equal(rollbackHtml.content, '<html><body>Suspend</body></html>');

    const get = await getContent(baseUrl, projectId, tenant, 'index.html');
    const g = (await get.json()) as { file: { content: string } };
    assert.equal(g.file.content, '<html><body>Suspend</body></html>', 'FileStore restauré par le rollback');
  });

  it('4. chemin sans préfixe app/ : la politique s applique aussi (html inspectable)', async () => {
    const revBefore = await countRevisions(baseUrl, projectId, tenant);
    const res = await postRevision({ message: 'Poison sans app/', files: { 'index.html': POISON_HTML } });
    assert.equal(res.status, 200);
    const data = await res.json() as unknown;
    assertRefusal(data);
    assert.equal((data as RefusalShape).refused, 'images');
    assert.equal(await countRevisions(baseUrl, projectId, tenant), revBefore);
  });
});
