/**
 * V7-HARDEN — profil Chromium durci du sandbox.
 *
 * Ces tests ne lancent pas de navigateur : ils vérifient les arguments et les
 * bornes qui seront réellement appliqués par ChromiumBrowserSandbox. Le test
 * live du rapport d'isolation reste dans browser-sandbox.test.ts.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSandboxLaunchArgs,
  resolveSandboxJsHeapLimitMb,
  DEFAULT_SANDBOX_JS_HEAP_MB,
  MIN_SANDBOX_JS_HEAP_MB,
  MAX_SANDBOX_JS_HEAP_MB
} from '../../../src/ai-native/validation/browser-sandbox.js';

describe('V7-HARDEN — profil Chromium durci', () => {
  it('1. arguments par défaut : réseau, extensions, GPU et tas bornés', () => {
    const args = buildSandboxLaunchArgs({ jsHeapLimitMb: DEFAULT_SANDBOX_JS_HEAP_MB });

    for (const flag of [
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-plugins',
      '--disable-default-apps',
      '--disable-component-extensions-with-background-pages',
      '--disable-breakpad',
      '--disable-domain-reliability',
      '--disable-client-side-phishing-detection',
      '--disable-crash-reporter',
      '--safebrowsing-disable-auto-update',
      '--renderer-process-limit=1'
    ]) {
      assert.ok(args.includes(flag), `argument absent : ${flag}`);
    }
    assert.ok(args.some((arg) => arg.startsWith('--disable-features=')));
    assert.ok(args.includes(`--js-flags=--max-old-space-size=${DEFAULT_SANDBOX_JS_HEAP_MB}`));
    assert.ok(!args.includes('--no-sandbox'), 'le sandbox Chromium doit rester actif par défaut');
    assert.ok(!args.includes('--disable-setuid-sandbox'));
  });

  it('2. repli no-sandbox uniquement sur demande explicite', () => {
    const args = buildSandboxLaunchArgs({ noSandbox: true, jsHeapLimitMb: 256 });

    assert.ok(args.includes('--no-sandbox'));
    assert.ok(args.includes('--disable-setuid-sandbox'));
  });

  it('3. limite de tas : valeur par défaut, lecture et bornage', () => {
    assert.equal(resolveSandboxJsHeapLimitMb(''), DEFAULT_SANDBOX_JS_HEAP_MB);
    assert.equal(resolveSandboxJsHeapLimitMb('abc'), DEFAULT_SANDBOX_JS_HEAP_MB);
    assert.equal(resolveSandboxJsHeapLimitMb('512'), 512);
    assert.equal(resolveSandboxJsHeapLimitMb(' 384 '), 384);
    assert.equal(resolveSandboxJsHeapLimitMb('64'), MIN_SANDBOX_JS_HEAP_MB);
    assert.equal(resolveSandboxJsHeapLimitMb('4096'), MAX_SANDBOX_JS_HEAP_MB);
  });

  it('4. limite de tas fournie directement : bornée elle aussi', () => {
    const low = buildSandboxLaunchArgs({ jsHeapLimitMb: 1 });
    const high = buildSandboxLaunchArgs({ jsHeapLimitMb: 9999 });

    assert.ok(low.includes(`--js-flags=--max-old-space-size=${MIN_SANDBOX_JS_HEAP_MB}`));
    assert.ok(high.includes(`--js-flags=--max-old-space-size=${MAX_SANDBOX_JS_HEAP_MB}`));
  });

  it('5. aucun doublon dans les arguments', () => {
    const args = buildSandboxLaunchArgs({ jsHeapLimitMb: 256 });

    assert.equal(new Set(args).size, args.length);
    assert.equal(args.filter((arg) => arg.startsWith('--js-flags=')).length, 1);
  });
});
