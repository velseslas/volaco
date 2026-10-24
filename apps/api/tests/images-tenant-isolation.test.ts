/**
 * ISOLATION TENANT — routes images (audit 2026-10).
 *
 * Un tenant B ne doit pouvoir ni générer, ni lister, ni lire les images
 * d'un projet appartenant au tenant A. Avant le correctif, les 3 handlers
 * appelaient le FileStore sans vérifier l'appartenance du projet : la map
 * tenantB:projetA était créée vide (espace « fantôme ») et la génération
 * croisée renvoyait 201. Corrigé : assertProjectOwnership → 404.
 */

process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { imageProviderRegistry } from '../../../packages/core/src/image/registry.js';

describe('ISOLATION — routes images cross-tenant', () => {
  let server: Server;
  let baseUrl: string;
  let projectA = '';
  const HA = { 'Content-Type': 'application/json; charset=utf-8', 'x-tenant-id': 'tenant_iso_A', 'x-user-role': 'ENGINEER' };
  const HB = { 'Content-Type': 'application/json; charset=utf-8', 'x-tenant-id': 'tenant_iso_B', 'x-user-role': 'ENGINEER' };

  before(async () => {
    if (!imageProviderRegistry.get('iso-fake')) {
      imageProviderRegistry.register({
        id: 'iso-fake',
        name: 'Iso Fake',
        isAvailable: () => true,
        generate: async () => ({ data: Buffer.alloc(2000, 1), contentType: 'image/jpeg' })
      });
    }
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
    // Projet appartenant au tenant A, avec une image générée par A
    const pres = await fetch(`${baseUrl}/api/v1/projects`, { method: 'POST', headers: HA, body: JSON.stringify({ name: 'Iso A' }) });
    projectA = ((await pres.json()) as { project?: { id?: string } }).project!.id!;
    const gen = await fetch(`${baseUrl}/api/v1/projects/${projectA}/images/generate`, {
      method: 'POST', headers: HA, body: JSON.stringify({ prompt: 'image privée du tenant A', name: 'privee-a' })
    });
    assert.equal(gen.status, 201, 'A génère dans SON projet');
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('B ne peut pas GÉNÉRER dans le projet de A (404, aucune map fantôme)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectA}/images/generate`, {
      method: 'POST', headers: HB, body: JSON.stringify({ prompt: 'écriture croisée interdite' })
    });
    assert.equal(res.status, 404, 'le projet de A n existe pas pour B');
  });

  it('B ne peut pas LISTER les images du projet de A (404)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectA}/images`, { headers: HB });
    assert.equal(res.status, 404);
  });

  it("B ne peut pas LIRE l'asset image du projet de A (404)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectA}/images/privee-a.jpg`, { headers: HB });
    assert.equal(res.status, 404);
  });

  it('A garde l accès complet à son projet (non-régression)', async () => {
    const list = await fetch(`${baseUrl}/api/v1/projects/${projectA}/images`, { headers: HA });
    assert.equal(list.status, 200);
    const body = await list.json() as { assets: Array<{ name: string }> };
    assert.ok(body.assets.some((a) => a.name === 'privee-a.jpg'), "l'image de A est toujours là");
  });
});
