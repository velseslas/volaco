/**
 * LOT B (Phase 2, décision 3) — révocation JWT : tests UNITAIRES du store.
 * Séparés du test HTTP (server) pour rester rapides et sans socket.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SessionRevocationStore } from '../../../packages/core/src/identity/session-store.js';

describe('LOT B — SessionRevocationStore (B3, unitaire)', () => {
  it('un jeton sans `sv` (pré-migration) est refusé', () => {
    const store = new SessionRevocationStore(false);
    assert.equal(store.isTokenStillValid('usr_x', undefined, 'jti'), false);
  });

  it('incrémenter la version invalide tous les jetons antérieurs', () => {
    const store = new SessionRevocationStore(false);
    assert.equal(store.isTokenStillValid('usr_x', 0, 'jti'), true);
    const next = store.revokeUser('usr_x');
    assert.equal(next, 1);
    assert.equal(store.isTokenStillValid('usr_x', 0, 'jti'), false, 'ancien jeton refusé');
    assert.equal(store.isTokenStillValid('usr_x', 1, 'jti2'), true, 'nouveau jeton accepté');
  });

  it('la révocation d’un JTI cible une seule session', () => {
    const store = new SessionRevocationStore(false);
    store.revokeJti('jti-a');
    assert.equal(store.isTokenStillValid('usr_x', 0, 'jti-a'), false, 'JTI révoqué');
    assert.equal(store.isTokenStillValid('usr_x', 0, 'jti-b'), true, 'autre JTI intact');
  });
});
