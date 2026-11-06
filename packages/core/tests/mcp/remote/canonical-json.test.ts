/**
 * C3.2-B1 — Tests de la sérialisation canonique (empreintes d'approbation et
 * de confirmation MCP distants). Fail-closed vérifié sur chaque type hors JSON.
 *
 * Harnais C3.1 : node:test, pas de dépendance, temp directories volontaires.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  REMOTE_MCP_CANONICAL_MAX_DEPTH,
  RemoteMcpCanonicalError,
  remoteMcpCanonicalSha256,
  stableStringifyCanonical
} from '../../../src/mcp/remote/canonical-json.js';
import { sha256Hex } from '../../../src/mcp/remote/crypto.js';

describe('canonical-json : déterminisme', () => {
  it('1. l ordre d insertion des clés est neutralisé (tri code-unit)', () => {
    const a = stableStringifyCanonical({ b: 1, a: 2 });
    const b = stableStringifyCanonical({ a: 2, b: 1 });
    assert.equal(a, '{"a":2,"b":1}');
    assert.equal(a, b);
  });

  it('2. imbrication profonde : ordre des tableaux préservé, clés triées récursivement', () => {
    const value = { z: [{ beta: 1, alpha: { k: [2, 1] } }], a: null };
    assert.equal(
      stableStringifyCanonical(value),
      '{"a":null,"z":[{"alpha":{"k":[2,1]},"beta":1}]}'
    );
  });

  it('3. deux appels successifs produisent exactement la même chaîne', () => {
    const value = { list: [3, 1, { x: ' métier ', y: true }], n: -0, e: '' };
    assert.equal(stableStringifyCanonical(value), stableStringifyCanonical(value));
  });

  it('4. scalaires canoniques : -0 → 0, 1e21, 1.5, chaînes échappées', () => {
    assert.equal(stableStringifyCanonical({ m: -0 }), '{"m":0}');
    assert.equal(stableStringifyCanonical({ big: 1e21 }), '{"big":1e+21}');
    assert.equal(stableStringifyCanonical({ d: 1.5 }), '{"d":1.5}');
    assert.equal(
      stableStringifyCanonical({ s: 'guil"met\u0007»lgn' }),
      '{"s":"guil\\"met\\u0007»lgn"}'
    );
  });

  it('5. conteneurs vides et racines scalaires', () => {
    assert.equal(stableStringifyCanonical({}), '{}');
    assert.equal(stableStringifyCanonical([]), '[]');
    assert.equal(stableStringifyCanonical('texte'), '"texte"');
    assert.equal(stableStringifyCanonical(42), '42');
    assert.equal(stableStringifyCanonical(null), 'null');
    assert.equal(stableStringifyCanonical(false), 'false');
  });

  it('6. clés non-ASCII triées de façon stable (code-unit)', () => {
    const a = stableStringifyCanonical({ 'é': 1, 'e': 2, 'É': 3 });
    assert.equal(a, stableStringifyCanonical({ 'É': 3, 'é': 1, 'e': 2 }));
    assert.equal(a, '{"e":2,"É":3,"é":1}');
  });
});

describe('canonical-json : fail-closed', () => {
  const refuse = (label: string, call: () => unknown): void => {
    assert.throws(call, RemoteMcpCanonicalError, `${label} doit être refusé`);
  };

  it('7. undefined / fonction / symbol / bigint refusés', () => {
    refuse('undefined racine', () => stableStringifyCanonical(undefined));
    refuse('undefined imbriqué', () => stableStringifyCanonical({ a: undefined }));
    refuse('fonction', () => stableStringifyCanonical({ f: () => 1 }));
    refuse('symbol', () => stableStringifyCanonical({ s: Symbol('x') }));
    refuse('bigint', () => stableStringifyCanonical({ b: 1n }));
  });

  it('8. NaN / ±Infinity refusés', () => {
    refuse('NaN', () => stableStringifyCanonical({ n: NaN }));
    refuse('+Infinity', () => stableStringifyCanonical({ n: Infinity }));
    refuse('-Infinity', () => stableStringifyCanonical({ n: -Infinity }));
  });

  it('9. Map, Set, Date, RegExp, instance de classe refusés', () => {
    refuse('Map', () => stableStringifyCanonical({ m: new Map([[1, 2]]) }));
    refuse('Set', () => stableStringifyCanonical(new Set([1])));
    refuse('Date', () => stableStringifyCanonical({ d: new Date(0) }));
    refuse('RegExp', () => stableStringifyCanonical({ r: /x/ }));
    class Cache { constructor(public v: number) {} }
    refuse('classe', () => stableStringifyCanonical(new Cache(1)));
  });

  it('10. cycle détecté partout (objet direct et via tableau)', () => {
    const c: Record<string, unknown> = { name: 'cycle' };
    c.self = c;
    refuse('cycle objet', () => stableStringifyCanonical(c));
    const d = { liste: [] as unknown[] };
    d.liste.push(d);
    refuse('cycle via tableau', () => stableStringifyCanonical(d));
  });

  it('11. profondeur : 64 niveaux acceptés, 65 refusés', () => {
    const build = (levels: number): unknown => {
      let node: unknown = { leaf: true };
      for (let i = 0; i < levels - 1; i++) node = { n: node };
      return node;
    };
    assert.doesNotThrow(() => stableStringifyCanonical(build(REMOTE_MCP_CANONICAL_MAX_DEPTH)));
    refuse('profondeur dépassée', () => stableStringifyCanonical(build(REMOTE_MCP_CANONICAL_MAX_DEPTH + 1)));
  });

  it('12. message d erreur sélectionnable (profondeur vs type) et cas valide non-throw', () => {
    assert.throws(
      () => stableStringifyCanonical({ b: 1n }),
      (err: unknown) => err instanceof RemoteMcpCanonicalError && /bigint/.test(err.message)
    );
    assert.doesNotThrow(() => stableStringifyCanonical({ a: { b: { c: 1 } } }));
  });
});

describe('canonical-json : empreinte SHA-256', () => {
  it('13. remoteMcpCanonicalSha256 = sha256Hex de la sérialisation canonique', () => {
    const value = { tool: 'recherche', limit: 10, q: 'plan' };
    assert.equal(remoteMcpCanonicalSha256(value), sha256Hex('{"limit":10,"q":"plan","tool":"recherche"}'));
    const hex = remoteMcpCanonicalSha256(value);
    assert.match(hex, /^[0-9a-f]{64}$/);
  });

  it('14. charges sémantiquement identiques ⇒ même empreinte', () => {
    const a = { q: 'x', n: 1, i: { a: [] } };
    const b = { i: { a: [] }, n: 1, q: 'x' };
    assert.equal(remoteMcpCanonicalSha256(a), remoteMcpCanonicalSha256(b));
    const c = { q: 'x', n: 1, i: { a: [] }, extra: 0 };
    assert.notEqual(remoteMcpCanonicalSha256(a), remoteMcpCanonicalSha256(c));
  });
});
