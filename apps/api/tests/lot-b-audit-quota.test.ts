/**
 * LOT B (Phase 2, décisions 4 & 5) — audit durable + quotas MCP.
 *
 * B2 : les événements CRITIQUES déclenchent un flush SYNCHRONE (durabilité
 *      immédiate) ; l'indicateur de santé expose l'état réel ; un FAILURE est
 *      traité comme critique.
 * B4 : quotas tenant ET utilisateur par opération, la limite utilisateur étant
 *      plus restrictive ; refus 429 explicite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { AuditStore } from '../../../packages/core/src/observability/audit.js';
import { RemoteMcpRateLimiter } from '../../../packages/core/src/mcp/remote/rate-limit.js';

process.env.VOLACO_JWT_SECRET = randomBytes(32).toString('base64');

describe('LOT B — audit durable (B2)', () => {
  it('un événement CRITIQUE est flushé immédiatement (pending = 0)', () => {
    const store = new AuditStore({ persist: true });
    store.clear();
    store.record({
      tenantId: 'ten', userId: 'usr_1', action: 'TENANT_MANAGE',
      resourceType: 'TENANT', resourceId: 'r', status: 'SUCCESS', requestId: 'req'
    });
    const health = store.health();
    assert.equal(health.pending, 0, 'event critique → écriture immédiate');
    assert.equal(health.lastWriteError, null, 'aucune erreur signalée');
  });

  it('un FAILURE est traité comme critique (flush immédiat)', () => {
    const store = new AuditStore({ persist: true });
    store.clear();
    store.record({
      tenantId: 'ten', userId: 'usr_1', action: 'SOME_ACTION',
      resourceType: 'X', resourceId: 'r', status: 'FAILURE', requestId: 'req'
    });
    assert.equal(store.health().pending, 0, 'FAILURE → flush immédiat');
  });

  it("l'indicateur de santé est persistant et cohérent", () => {
    const store = new AuditStore({ persist: true });
    store.clear();
    const health = store.health();
    assert.equal(health.persistent, true);
    assert.equal(typeof health.lastFlushAt, 'number');
    assert.equal(health.pending, 0);
  });
});

describe('LOT B — quotas MCP par tenant/utilisateur (B4)', () => {
  it('la limite UTILISATEUR est plus restrictive que la limite TENANT', () => {
    const limiter = new RemoteMcpRateLimiter();
    // discovery : 60/tenant, 30/user par minute. On épuise le quota utilisateur.
    let refused = 0;
    for (let i = 0; i < 40; i++) {
      const d = limiter.check('discovery', 'ten_A', 'usr_A');
      if (!d.allowed) { refused += 1; assert.equal(d.scope, 'user', 'le refus vient de la limite utilisateur'); break; }
    }
    assert.equal(refused, 1, 'le quota utilisateur refuse avant le quota tenant');
  });

  it('un autre utilisateur du même tenant n’est pas affecté par le quota du premier', () => {
    const limiter = new RemoteMcpRateLimiter();
    for (let i = 0; i < 31; i++) limiter.check('discovery', 'ten_A', 'usr_A');
    const other = limiter.check('discovery', 'ten_A', 'usr_B');
    assert.equal(other.allowed, true, 'la limite utilisateur est par utilisateur');
  });

  it('le quota tenant finit par refuser même réparti sur des utilisateurs', () => {
    const limiter = new RemoteMcpRateLimiter();
    let scope: string | null = null;
    for (let i = 0; i < 200; i++) {
      const d = limiter.check('connectors', 'ten_heavy', `usr_${i}`);
      if (!d.allowed) { scope = d.scope; break; }
    }
    assert.equal(scope, 'tenant', 'le quota tenant borne le total');
  });
});
