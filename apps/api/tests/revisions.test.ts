import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { projectStore } from '../../../packages/core/src/identity/project.js';
import { revisionStore } from '../../../packages/core/src/model/revision-store.js';

describe('FND-004 : Revisions & Application Model HTTP Integration Tests', () => {
  let server: Server;
  let baseUrl: string;
  const testTenant = 'tenant_revisions_secure';
  let projectId: string;

  before(async () => {
    const proj = projectStore.createProject(testTenant, 'Projet Revisions Securise');
    projectId = proj.id;

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

  it('doit crÃ©er la premiÃ¨re rÃ©vision d un projet et calculer le hash SHA-256 des fichiers', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': testTenant,
        'X-User-Role': 'ENGINEER'
      },
      body: JSON.stringify({
        message: 'Initial Scaffold',
        files: {
          'index.html': '<html><body>Initial</body></html>'
        },
        provenance: { source: 'USER', prompt: 'CrÃ©ation initiale' }
      })
    });

    assert.equal(res.status, 201);
    const body = (await res.json()) as any;
    assert.equal(body.revision.revisionNumber, 1);
    assert.ok(body.revision.files['index.html']);
    assert.equal(body.revision.files['index.html'].hash.length, 64);
  });

  it('doit crÃ©er une seconde rÃ©vision et lister l historique dans l ordre chronologique', async () => {
    const postRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': testTenant,
        'X-User-Role': 'ENGINEER'
      },
      body: JSON.stringify({
        message: 'Second Commit',
        files: { 'index.html': '<html><body>Updated</body></html>' }
      })
    });
    assert.equal(postRes.status, 201);

    const listRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions`, {
      headers: { 'X-Tenant-Id': testTenant, 'X-User-Role': 'VIEWER' }
    });

    assert.equal(listRes.status, 200);
    const listBody = (await listRes.json()) as any;
    assert.equal(listBody.revisions.length, 2);
    assert.equal(listBody.revisions[0].revisionNumber, 1);
    assert.equal(listBody.revisions[1].revisionNumber, 2);
  });

  it('doit exÃ©cuter un rollback vers la rÃ©vision 1 et produire une rÃ©vision 3 restaurÃ©e', async () => {
    const listRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions`, {
      headers: { 'X-Tenant-Id': testTenant, 'X-User-Role': 'VIEWER' }
    });
    const { revisions } = (await listRes.json()) as any;
    const rev1Id = revisions[0].id;

    const rbRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions/${rev1Id}/rollback`, {
      method: 'POST',
      headers: { 'X-Tenant-Id': testTenant, 'X-User-Role': 'ENGINEER' }
    });

    assert.equal(rbRes.status, 200);
    const rbBody = (await rbRes.json()) as any;
    assert.equal(rbBody.rollbackRevision.revisionNumber, 3);
    assert.equal(rbBody.rollbackRevision.files['index.html'].content, '<html><body>Initial</body></html>');
    assert.equal(rbBody.rollbackRevision.provenance.source, 'SYSTEM_REPAIR');
  });

  it('doit rejeter l accÃ¨s aux rÃ©visions par un locataire rival (Ã‰tanchÃ©itÃ© Multi-Tenant)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions`, {
      headers: { 'X-Tenant-Id': 'tenant_pirate_other', 'X-User-Role': 'VIEWER' }
    });
    assert.equal(res.status, 404);
  });
});

// ============================================================================
// PATCH-2 — le rollback ne peut PLUS publier des images interdites.
// Le contenu EXACT de la révision cible est inspecté avant toute écriture :
// refus -> ni FileStore, ni workspace, ni révision dérivée, ni build.
// Un contenu conforme roule normalement ; un rebuild en échec n'est PAS un
// succès (success !== true, dernier bundle valide préservé). La politique
// appliquée aux références indéterminées (undetermined) est celle du pipeline
// existant : non bloquantes à la réinspection, jamais déclarées conformes.
// ============================================================================

describe('PATCH-2 : le rollback ne publie jamais des images interdites', () => {
  let server: Server;
  let baseUrl = '';
  const tenant = 'tenant_rev_rollback_p2';
  let projectId = '';

  const H = { 'Content-Type': 'application/json', 'X-Tenant-Id': tenant, 'X-User-Role': 'ENGINEER' };

  const CONFORM_TSX = 'export default function App() {\n'
    + '  return (\n'
    + '    <main className="min-h-screen bg-slate-950 p-10 text-slate-100">\n'
    + '      <h1 className="text-xl">Rollback PATCH-2 conforme</h1>\n'
    + '      <img src="https://picsum.photos/seed/p2rollback/800/520" alt="neutre" />\n'
    + '    </main>\n'
    + '  );\n'
    + '}\n';

  const POISON_TSX = 'export default function App() {\n'
    + '  return (\n'
    + '    <main className="min-h-screen bg-slate-950 p-10 text-slate-100">\n'
    + '      <img src="https://forbidden.invalid/p2.jpg" alt="poison" />\n'
    + '    </main>\n'
    + '  );\n'
    + '}\n';

  const UNDETERMINED_TSX = 'export default function App() {\n'
    + '  return (\n'
    + '    <main className="min-h-screen bg-slate-950 p-10 text-slate-100">\n'
    + '      <img src={heroImage} alt="inconnue" />\n'
    + '    </main>\n'
    + '  );\n'
    + '}\n';

  const BROKEN_TSX = 'export default function App() {\n'
    + '  return (\n'
    + '    <main className="min-h-screen bg-slate-950 p-10 text-slate-100">\n'
    + '      <span>sans fin\n'
    + '    </main>\n'
    + '  );\n'
    + '}\n';

  before(async () => {
    const proj = projectStore.createProject(tenant, 'Projet Rollback PATCH-2');
    projectId = proj.id;
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        baseUrl = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function revCount(): Promise<number> {
    const l = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions`, { headers: H });
    assert.equal(l.status, 200);
    return ((await l.json()) as { revisions: unknown[] }).revisions.length;
  }

  async function fileContent(path: string): Promise<{ status: number; content: string }> {
    const r = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`, { headers: H });
    const content = r.status === 200 ? (((await r.json()) as { file?: { content?: string } }).file?.content ?? '') : '';
    return { status: r.status, content };
  }

  async function bundle(): Promise<{ status: number; text: string }> {
    const r = await fetch(`${baseUrl}/preview-bundle/${projectId}/`);
    const text = r.status === 200 ? await r.text() : '';
    return { status: r.status, text };
  }

  async function makeRevision(message: string, files: Record<string, string>, expected = 201): Promise<string> {
    const r = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions`, {
      method: 'POST', headers: H, body: JSON.stringify({ message, files })
    });
    assert.equal(r.status, expected);
    return ((await r.json()) as { revision: { id: string } }).revision.id;
  }

  // PATCH-R3-B : depuis la porte B3, POST /revisions refuse de PERSISTER des
  // contenus interdits (couverture amont). La semence « poison historique »
  // s'injecte donc par l'API cœur — exactement le chemin par lequel un
  // contenu antérieur à la porte a pu exister. Aucune assertion du test
  // PATCH-2 n'est modifiée : on prouve toujours que le ROLLBACK refuse.
  function seedLegacyRevision(message: string, files: Record<string, string>): string {
    return revisionStore.createRevision(tenant, projectId, {
      message,
      author: 'legacy',
      files,
      provenance: { source: 'USER', prompt: message, triggerRequestId: 'legacy-seed' }
    }).id;
  }

  it('1. état de base : publication conforme via rollback (v1 -> v2), bundle servi', async () => {
    const rev1 = await makeRevision('v1 conforme', { 'app/src/App.tsx': CONFORM_TSX });
    assert.equal(await revCount(), 1);
    const rb = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions/${rev1}/rollback`, { method: 'POST', headers: H });
    assert.equal(rb.status, 200);
    const body = (await rb.json()) as { success?: boolean; restoredFiles?: number };
    assert.equal(body.success, true);
    assert.equal(body.restoredFiles, 1);
    assert.equal(await revCount(), 2);
    const b = await bundle();
    assert.equal(b.status, 200);
    assert.ok(b.text.includes('p2rollback'), 'le bundle contient l image conforme');
    assert.ok(!b.text.includes('forbidden.invalid'));
  });

  it('2. rollback d une révision EMPOISONNÉE : REFUS — aucune écriture, aucun build, aucune révision dérivée', async () => {
    seedLegacyRevision('v3 empoisonnée', { 'app/src/App.tsx': POISON_TSX });
    assert.equal(await revCount(), 3);
    const before = await fileContent('app/src/App.tsx');
    assert.ok(before.content.includes('p2rollback'), 'FileStore actif : contenu conforme antérieur');

    const list = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions`, { headers: H });
    const revId = (((await list.json()) as { revisions: Array<{ id: string }> }).revisions)[2]!.id;

    const rb = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions/${revId}/rollback`, { method: 'POST', headers: H });
    assert.equal(rb.status, 200);
    const body = (await rb.json()) as { success?: boolean; refused?: string; imageIssues?: string[] };
    assert.equal(body.success, false, 'PAS de succès mensonger');
    assert.equal(body.refused, 'images');
    assert.ok(Array.isArray(body.imageIssues) && body.imageIssues.length > 0);
    assert.ok(body.imageIssues.join(' | ').includes('forbidden.invalid'), 'la violation cite la référence exacte');

    // AUCUNE révision dérivée : l'historique reste à 3.
    assert.equal(await revCount(), 3);

    // ÉTAT ACTIF INTACT : le FileStore et le bundle publiés sont inchangés.
    const after = await fileContent('app/src/App.tsx');
    assert.equal(after.content, before.content, 'FileStore inchangé après refus');
    assert.ok(!after.content.includes('forbidden.invalid'), 'aucun poison écrit');
    const b = await bundle();
    assert.equal(b.status, 200, 'le bundle publié reste servi');
    assert.ok(b.text.includes('p2rollback'), 'le bundle reste la version conforme');
    assert.ok(!b.text.includes('forbidden.invalid'), 'aucun poison publié — aucun build du rollback refusé');
  });

  it('3. rollback d une révision CONFORME : succès normal (aucune régression)', async () => {
    const list = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions`, { headers: H });
    const revId = (((await list.json()) as { revisions: Array<{ id: string }> }).revisions)[0]!.id;
    const rb = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions/${revId}/rollback`, {
      method: 'POST', headers: H
    });
    assert.equal(rb.status, 200);
    const body = (await rb.json()) as { success?: boolean; restoredFiles?: number };
    assert.equal(body.success, true);
    assert.equal(body.restoredFiles, 1);
    assert.equal(await revCount(), 4, 'une révision de rollback est créée');
    const b = await bundle();
    assert.equal(b.status, 200);
    assert.ok(b.text.includes('p2rollback'), 'le rollback conforme republie le contenu vérifié');
  });

  it('4. échec de BUILD post-rollback : réponse d échec explicite (jamais success:true), dernier bundle valide préservé', async () => {
    await makeRevision('v5 non compilable', { 'app/src/App.tsx': BROKEN_TSX });
    assert.equal(await revCount(), 5);
    const list = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions`, { headers: H });
    const revId = (((await list.json()) as { revisions: Array<{ id: string }> }).revisions)[4]!.id;

    const rb = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions/${revId}/rollback`, { method: 'POST', headers: H });
    assert.equal(rb.status, 200);
    const body = (await rb.json()) as { success?: boolean; buildFailed?: boolean; buildErrors?: string[]; restoredFiles?: number };
    assert.equal(body.success, false, 'un échec de build n est plus annoncé comme succès');
    assert.equal(body.buildFailed, true);
    assert.ok(Array.isArray(body.buildErrors) && body.buildErrors.length > 0, 'la cause du build est citée');
    assert.equal(body.restoredFiles, 1, 'les fichiers cibles sont restaurés (état défini, pas corrompu)');

    // Dernier bundle VALIDE préservé (échange atomique) : toujours le contenu conforme.
    const b = await bundle();
    assert.equal(b.status, 200);
    assert.ok(b.text.includes('p2rollback'), 'le bundle publié reste la dernière version valide');
    assert.ok(!b.text.includes('sans fin'), 'le contenu non compilable n est pas publié');
    // FileStore : le contenu restauré est celui de la cible (état cohérent).
    const fc = await fileContent('app/src/App.tsx');
    assert.ok(fc.content.includes('sans fin'), 'FileStore reflète le rollback (fichiers restaurés)');
  });

  it('5. révision undetermined (src={expression}) : la politique du pipeline s applique — non bloquante, jamais déclarée conforme', async () => {
    await makeRevision('v7 undetermined', { 'app/src/App.tsx': UNDETERMINED_TSX });
    assert.equal(await revCount(), 7);
    const list = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions`, { headers: H });
    const revId = (((await list.json()) as { revisions: Array<{ id: string }> }).revisions)[6]!.id;

    const rb = await fetch(`${baseUrl}/api/v1/projects/${projectId}/revisions/${revId}/rollback`, { method: 'POST', headers: H });
    assert.equal(rb.status, 200);
    // POLITIQUE RÉELLE (identique à génération/édition) : seules les VIOLATIONS
    // bloquent ; un contenu src={expression} avait été accepté par le même
    // pipeline (limite documentée) — le rollback le traite pareil.
    const body = (await rb.json()) as { success?: boolean };
    assert.equal(body.success, true);
    const fc = await fileContent('app/src/App.tsx');
    assert.ok(fc.content.includes('heroImage'), 'l état restauré est bien celui de la révision undetermined');
    const b = await bundle();
    assert.equal(b.status, 200);
    assert.ok(!b.text.includes('forbidden.invalid'));
  });
});
