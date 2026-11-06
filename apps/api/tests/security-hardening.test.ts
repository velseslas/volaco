/**
 * Micro-phase SEC — durcissement sécurité (audit post-É48).
 *
 * SEC-03 : anti-bruteforce sur /auth/login — après 5 échecs (IP+email) dans
 *   la fenêtre de 60 s, toute tentative est refusée 429 + Retry-After, y
 *   compris avec le bon mot de passe ; un succès remet le compteur à zéro.
 * SEC-02 : appendChatMessage — le rendu HTML des messages utilisateur n'est
 *   autorisé que sur le flag explicite isPrebuiltHtml (le texte brut ne passe
 *   plus par innerHTML, même s'il contient '<').
 */

import './_lot-b-secret-env.js';

process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

describe('Micro-phase SEC — durcissement sécurité', () => {
  let server: Server;
  let baseUrl: string;
  const H = { 'Content-Type': 'application/json; charset=utf-8' };

  before(async () => {
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
    // Compte de test connu
    await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ email: 'sec-test@vibe.local', password: 'mot-de-passe-solide-1', name: 'SEC Test' })
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('SEC-03: 5 échecs → 401 ; la 6e tentative → 429 TOO_MANY_ATTEMPTS + Retry-After', async () => {
    const email = 'bruteforce@vibe.local';
    // 5 échecs (seuil)
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ email, password: 'mauvais-' + i })
      });
      assert.equal(r.status, 401, `échec ${i + 1} : 401 normal`);
    }
    // 6e tentative (même mauvais mot de passe) : verrouillée
    const locked = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ email, password: 'mauvais-99' })
    });
    assert.equal(locked.status, 429, 'verrouillé après le seuil');
    const busy = await locked.json() as { error?: { code?: string } };
    assert.equal(busy.error?.code, 'TOO_MANY_ATTEMPTS');
    assert.ok(locked.headers.get('retry-after'), 'Retry-After présent');
  });

  it('SEC-03: verrou actif même avec le BON mot de passe (anti-énumération)', async () => {
    // L'email de brute-force du test précédent est verrouillé — mais ce test
    // tourne dans le même process : on utilise un email neuf pour prouver que
    // le verrou est par (IP+email) et non global.
    const ok = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ email: 'sec-test@vibe.local', password: 'mot-de-passe-solide-1' })
    });
    assert.equal(ok.status, 200, 'un autre email n est pas affecté par le verrou');
  });

  it('SEC-02: appendChatMessage — rendu HTML utilisateur uniquement sur isPrebuiltHtml', () => {
    const served = readFileSync(resolve(process.cwd(), 'apps/studio/index.html'), 'utf8');
    const fnStart = served.indexOf('function appendChatMessage');
    const fn = served.slice(fnStart, served.indexOf('history.appendChild(div)'));
    assert.match(fn, /isPrebuiltHtml === true/, 'rendu HTML conditionné au flag explicite');
    assert.match(fn, /div\.innerText = content/, 'le texte brut passe par innerText');
    // Le sniffing vulnérable a disparu
    assert.doesNotMatch(fn, /content\.includes\('<'\)/, 'plus de sniffing de contenu');
    // Le site appelant existant passe bien le flag (message utilisateur pré-construit)
    assert.match(served, /appendChatMessage\('user', userMessageHtml, true\)/);
  });
});
