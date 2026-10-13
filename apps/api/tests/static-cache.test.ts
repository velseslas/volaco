/**
 * n°3 — cache statique : corps identique au disque, ETag/304, gzip.
 * Niveau HTTP (serveur de test isolé), sans toucher aux fichiers du Studio.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createApiServer } from '../src/server.js';

describe('n°3 : cache statique + ETag/304 + gzip', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
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
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('1. GET / : 200 + ETag + corps identique au fichier disque', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    const etag = res.headers.get('etag');
    assert.ok(etag && etag.length > 0, 'un ETag doit être émis');
    const body = Buffer.from(await res.arrayBuffer());
    const disk = readFileSync(join(process.cwd(), 'apps/studio/index.html'));
    assert.ok(body.equals(disk), 'le corps servi doit être byte-identique au disque');
  });

  it('2. revalidation : If-None-Match => 304 corps vide', async () => {
    const first = await fetch(`${baseUrl}/`);
    const etag = first.headers.get('etag')!;
    await first.arrayBuffer();
    const second = await fetch(`${baseUrl}/`, { headers: { 'If-None-Match': etag } });
    assert.equal(second.status, 304);
    assert.equal((await second.arrayBuffer()).byteLength, 0);
  });

  it('3. gzip : Accept-Encoding gzip => précompressé, contenu identique après gunzip', async () => {
    // HTTP brut (pas fetch : undici décompresse tout seul et fausserait la mesure).
    const { get } = await import('node:http');
    const raw: Buffer = await new Promise((resolve, reject) => {
      get(baseUrl + '/', { headers: { 'Accept-Encoding': 'gzip' } }, (res) => {
        assert.equal(res.statusCode, 200);
        assert.equal(res.headers['content-encoding'], 'gzip');
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }).on('error', reject);
    });
    const disk = readFileSync(join(process.cwd(), 'apps/studio/index.html'));
    assert.ok(raw.length < disk.length, `le flux gzip (${raw.length}) doit être plus petit que le fichier (${disk.length})`);
    assert.ok(gunzipSync(raw).equals(disk), 'après gunzip, byte-identique au disque');
  });

  it('4. route preview-builder : ETag + 304 aussi (même helper)', async () => {
    const res = await fetch(`${baseUrl}/preview-builder/engine.js`);
    assert.equal(res.status, 200);
    const etag = res.headers.get('etag');
    assert.ok(etag && etag.length > 0, 'ETag sur le moteur preview');
    await res.arrayBuffer();
    const cached = await fetch(`${baseUrl}/preview-builder/engine.js`, { headers: { 'If-None-Match': etag! } });
    assert.equal(cached.status, 304);
  });
});
