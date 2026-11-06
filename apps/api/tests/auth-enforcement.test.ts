/**
 * Tests de régression sécurité (audit 26/09/2026 — SEC-02, SEC-04)
 *
 * Avant correctif : extractRequestContext était appelé SANS la config, la
 * vérification du Bearer n'était jamais exécutée et toutes les routes API
 * répondaient sans authentification ; le CORS émettait Access-Control-Allow-
 * Origin: * par défaut (drive-by possible depuis n'importe quel site web).
 */

import './_lot-b-secret-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';

const TEST_API_KEY = 'test-key-0123456789-0123456789-0123';

interface ErrorPayload {
  error: {
    code: string;
    message: string;
    statusCode: number;
    requestId?: string;
  };
}

describe('Sécurité : application de l\'authentification', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    const instance = createApiServer({
      env: 'production',
      apiKey: TEST_API_KEY,
      port: 0
    });
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

  it('1. refuse une requête API sans Bearer en production (401 UNAUTHORIZED)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/dashboard/summary`);
    assert.equal(res.status, 401, 'Une requête sans token doit être refusée en production');
    const body = await res.json() as ErrorPayload;
    assert.equal(body.error.code, 'UNAUTHORIZED');
  });

  it('2. refuse une requête API avec un Bearer invalide en production (401)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/dashboard/summary`, {
      headers: { Authorization: 'Bearer mauvais-token-volontairement' }
    });
    assert.equal(res.status, 401, 'Un token invalide doit être refusé en production');
  });

  it('3. accepte une requête API avec le bon Bearer en production (200)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/dashboard/summary`, {
      headers: { Authorization: `Bearer ${TEST_API_KEY}` }
    });
    assert.equal(res.status, 200);
  });

  it('4. laisse /health accessible sans authentification (monitoring)', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200, 'Le healthcheck reste public même en production');
  });

  it('5. laisse le shell du Studio accessible sans authentification (écran de login)', async () => {
    // Poulet-œuf : sans cette surface publique, impossible d'ouvrir la page
    // de connexion pour obtenir un premier jeton en production.
    for (const p of ['/', '/index.html', '/shell']) {
      const res = await fetch(`${baseUrl}${p}`);
      assert.equal(res.status, 200, `le shell ${p} doit être public`);
      const contentType = res.headers.get('content-type') ?? '';
      assert.ok(contentType.includes('text/html'), `${p} sert bien du HTML`);
    }
  });

  it('6. laisse les assets statiques du Studio publics (js/css) mais verrouille les chemins inconnus', async () => {
    const asset = await fetch(`${baseUrl}/html2canvas.min.js`);
    assert.equal(asset.status, 200, 'html2canvas.min.js doit être public');
    assert.ok((asset.headers.get('content-type') ?? '').includes('javascript'));

    const unknown = await fetch(`${baseUrl}/aucun-dossier-sans-extension`);
    assert.equal(unknown.status, 401, 'un chemin non api, sans extension, reste verrouillé');
  });

  it('7. les routes /api/v1/auth/* restent ouvertes (signup/login) en production', async () => {
    // Le garde middleware ne doit PAS bloquer la route (message « fournissez
    // un en-tête ») ; la réponse vient du handler lui-même (identifiants…).
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const body = await res.json().catch(() => ({ error: { message: '' } })) as { error?: { message?: string } };
    const message = body?.error?.message ?? '';
    assert.ok(!message.includes('fournissez un en-tête Authorization'), 'le garde middleware ne doit pas intercepter la route de login');
  });
});

describe('Sécurité : CORS fermé par défaut', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    // Aucun CORS_ALLOWED_ORIGINS : la config doit n'autoriser que le même origin.
    const instance = createApiServer({ corsAllowedOrigins: [], port: 0 });
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

  it('5. n\'émet aucun Access-Control-Allow-Origin quand la liste est vide', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.equal(
      res.headers.get('access-control-allow-origin'),
      null,
      'Sans CORS_ALLOWED_ORIGINS, aucune en-tête ACAO ne doit être émise (avant : *)'
    );
  });

  it('6. echo l\'origine listée explicitement', async () => {
    // Serveur dédié avec une allowlist explicite.
    const instance = createApiServer({
      corsAllowedOrigins: ['https://studio.example.com'],
      port: 0
    });
    const srv = instance.server;
    await new Promise<void>((resolve) => srv.listen(0, resolve));
    try {
      const address = srv.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${address.port}/health`, {
        headers: { Origin: 'https://studio.example.com' }
      });
      assert.equal(res.headers.get('access-control-allow-origin'), 'https://studio.example.com');
    } finally {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
  });
});
