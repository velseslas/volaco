import './_lot-b-secret-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';

interface HealthPayload {
  status: string;
  service: string;
  version: string;
  uptimeSeconds: number;
  requestId: string;
}

interface ErrorPayload {
  error: {
    code: string;
    message: string;
    statusCode: number;
    requestId?: string;
  };
}

describe('FND-002 : API & HTTP Integration Tests', () => {
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
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('doit rÃ©pondre avec succÃ¨s sur GET /health et inclure le X-Request-Id', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.has('x-request-id'));

    const body = (await res.json()) as HealthPayload;
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'VibeCode Studio Core');
    assert.equal(body.version, '0.1.0');
    assert.ok(body.uptimeSeconds >= 0);
    assert.equal(body.requestId, res.headers.get('x-request-id'));
  });

  it('doit propager un X-Request-Id personnalisÃ© fourni par le client', async () => {
    const customId = 'client_trace_987654';
    const res = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { 'X-Request-Id': customId }
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-request-id'), customId);

    const body = (await res.json()) as HealthPayload;
    assert.equal(body.requestId, customId);
  });

  it('doit renvoyer une erreur standardisÃ©e 404 sur route inexistante avec Request ID', async () => {
    const res = await fetch(`${baseUrl}/api/v1/inconnue`);
    assert.equal(res.status, 404);
    assert.ok(res.headers.has('x-request-id'));

    const body = (await res.json()) as ErrorPayload;
    assert.equal(body.error.code, 'NOT_FOUND');
    assert.equal(body.error.statusCode, 404);
    assert.equal(body.error.requestId, res.headers.get('x-request-id'));
  });
});
