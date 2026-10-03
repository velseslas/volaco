/**
 * P4 — TESTS IMAGE PROVIDERS : génération réelle via fetch injecté
 * (aucun réseau), registry, endpoint generate + service d'assets.
 */

process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PollinationsImageProvider } from '../../../packages/core/src/image/pollinations-provider.js';
import { imageProviderRegistry } from '../../../packages/core/src/image/registry.js';
import { projectStore } from '../../../packages/core/src/identity/project.js';

// PNG minimal valide (signature + IHDR) — le provider ne décode pas, il
// vérifie content-type image/ + taille, donc ce buffer suffit aux tests.
const FAKE_PNG = Buffer.alloc(2048, 7);
FAKE_PNG[0] = 0x89; FAKE_PNG[1] = 0x50; FAKE_PNG[2] = 0x4e; FAKE_PNG[3] = 0x47;

describe('P4 : Pollinations provider (fetch injecté)', () => {
  it('1. construit l URL avec prompt encodé + dimensions + seed, renvoie l image', async () => {
    let capturedUrl = '';
    const provider = new PollinationsImageProvider(5000);
    const image = await provider.generate('une terrasse de café parisienne', {
      width: 800,
      height: 450,
      fetchImpl: (async (url: string | URL | Request) => {
        capturedUrl = String(url);
        return new Response(FAKE_PNG, { status: 200, headers: { 'Content-Type': 'image/png' } });
      }) as typeof fetch
    });

    assert.equal(image.contentType, 'image/png');
    assert.equal(image.data.length, FAKE_PNG.length);
    assert.ok(capturedUrl.startsWith('https://image.pollinations.ai/prompt/'), 'URL pollinations');
    assert.ok(capturedUrl.includes(encodeURIComponent('une terrasse de café parisienne')), 'prompt encodé');
    assert.ok(capturedUrl.includes('width=800'), 'largeur demandée');
    assert.ok(capturedUrl.includes('height=450'), 'hauteur demandée');
    assert.ok(capturedUrl.includes('seed='), 'seed présent (image unique)');
  });

  it('2. réponse non-image → erreur honnête', async () => {
    const provider = new PollinationsImageProvider(5000);
    await assert.rejects(
      () => provider.generate('test', {
        fetchImpl: (async () => new Response('{"error":"boom"}', { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch
      }),
      /non-image/
    );
  });

  it('3. image tronquée (< 1000 octets) → erreur honnête', async () => {
    const provider = new PollinationsImageProvider(5000);
    await assert.rejects(
      () => provider.generate('test', {
        fetchImpl: (async () => new Response(Buffer.alloc(50), { status: 200, headers: { 'Content-Type': 'image/jpeg' } })) as typeof fetch
      }),
      /tronquée/
    );
  });
});

describe('P4 : routes images (generate + service) avec provider factice', () => {
  let server: Server;
  let baseUrl: string;
  let projectId = '';

  const FAKE_JPG = Buffer.alloc(3000, 5);
  FAKE_JPG[0] = 0xff; FAKE_JPG[1] = 0xd8; // signature JPEG

  before(async () => {
    // provider factice enregistré : génération déterministe sans réseau
    imageProviderRegistry.register({
      id: 'fake-p4',
      name: 'Fake P4',
      isAvailable: () => true,
      generate: async (prompt: string) => {
        const marker = Buffer.from('P4:' + prompt.slice(0, 40));
        return { data: Buffer.concat([FAKE_JPG, marker]), contentType: 'image/jpeg' };
      }
    });

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
    const pres = await fetch(`${baseUrl}/api/v1/projects`, { headers: { 'x-tenant-id': 'tenant_p4_01', 'x-user-role': 'ENGINEER' }, body: JSON.stringify({ name: 'P4 Images' }), method: 'POST' });
    const pdata = (await pres.json()) as { project?: { id?: string }; id?: string };
    projectId = (pdata.project || pdata).id as string;
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('1. POST /images/generate : génère, stocke (FileStore base64) et retourne l URL', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/images/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant_p4_01', 'x-user-role': 'ENGINEER' },
      body: JSON.stringify({ prompt: 'un bijou en or massif sur fond sombre', name: 'bague-or' })
    });
    assert.equal(res.status, 201);
    const data = (await res.json()) as { path?: string; url?: string; provider?: string; bytes?: number };
    assert.equal(data.provider, 'fake-p4');
    assert.equal(data.path, 'assets/bague-or.jpg');
    assert.match(String(data.url), /\/images\/bague-or\.jpg$/);
    assert.ok((data.bytes ?? 0) > 0);
  });

  it('2. GET /images/:name : sert l asset décodé (image réelle, pas du base64)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/images/bague-or.jpg`, {
      headers: { 'x-tenant-id': 'tenant_p4_01' }
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /image\/jpeg/);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.length, FAKE_JPG.length + 'P4:un bijou en or massif sur fond sombre'.length, 'décodage base64 exact');
  });

  it('3. GET /images : liste les assets du projet', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/images`, {
      headers: { 'x-tenant-id': 'tenant_p4_01' }
    });
    const data = (await res.json()) as { assets: Array<{ name: string }> };
    assert.ok(data.assets.some((a) => a.name === 'bague-or.jpg'));
  });

  it('4. prompt trop court → 400', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/images/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant_p4_01', 'x-user-role': 'ENGINEER' },
      body: JSON.stringify({ prompt: 'ab' })
    });
    assert.equal(res.status, 400);
  });
});
