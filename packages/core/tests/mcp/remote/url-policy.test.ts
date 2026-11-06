/**
 * C3.1 — Tests de la règle SSRF de connecteurs MCP distants.
 * Aucun réseau : fonctions pures (pré-validation locale + classification IP).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertPublicResolvedAddresses,
  classifyRemoteMcpAddress,
  validateRemoteMcpRedirectChain,
  validateRemoteMcpUrl
} from '../../../src/mcp/remote/url-policy.js';

describe('C3.1 : url-policy — validation SSRF pure', () => {
  it('accepte https sur nom DNS public et sur IP littérale publique', () => {
    assert.deepEqual(validateRemoteMcpUrl('https://api.example.com/mcp'), { allowed: true });
    assert.deepEqual(validateRemoteMcpUrl('https://8.8.8.8/grid'), { allowed: true });
    assert.deepEqual(validateRemoteMcpUrl('https://[2001:4860:4860::8888]/v1'), { allowed: true });
  });

  it('refuse tout scheme autre que https (pas de downgrade)', () => {
    assert.deepEqual(validateRemoteMcpUrl('http://api.example.com/mcp'), {
      allowed: false,
      reason: 'NON_HTTPS'
    });
    assert.deepEqual(validateRemoteMcpUrl('ftp://example.com'), {
      allowed: false,
      reason: 'NON_HTTPS'
    });
  });

  it('refuse credentials embarqués dans URL', () => {
    assert.deepEqual(validateRemoteMcpUrl('https://user@8.8.8.8/'), {
      allowed: false,
      reason: 'CREDENTIALS_IN_URL'
    });
    assert.deepEqual(validateRemoteMcpUrl('https://u:p@api.example.com/'), {
      allowed: false,
      reason: 'CREDENTIALS_IN_URL'
    });
  });

  it('refuse URLs invalides ou trop longues', () => {
    assert.deepEqual(validateRemoteMcpUrl(''), { allowed: false, reason: 'INVALID_URL' });
    assert.deepEqual(validateRemoteMcpUrl('pas-une-url'), { allowed: false, reason: 'INVALID_URL' });
    assert.deepEqual(validateRemoteMcpUrl('https://[horreur::ipv6]/'), {
      allowed: false,
      reason: 'INVALID_URL'
    });
    const longHost = `https://${'a'.repeat(2100)}.example.com/`;
    assert.deepEqual(validateRemoteMcpUrl(longHost), { allowed: false, reason: 'INVALID_URL' });
  });

  it('refuse les IPv4 non publiques (SSRF littéral)', () => {
    const privateTargets = [
      'https://127.0.0.1/dotnet',
      'https://10.0.0.9/internal',
      'https://172.16.33.1/x',
      'https://192.168.1.44/previews',
      'https://169.254.169.254/latest/meta-data/',
      'https://100.64.0.9/cgnat',
      'https://0.0.0.0/',
      'https://224.0.0.2/multicast',
      'https://192.0.2.7/test-net'
    ];
    for (const target of privateTargets) {
      assert.deepEqual(validateRemoteMcpUrl(target), {
        allowed: false,
        reason: 'NON_PUBLIC_ADDRESS'
      });
    }
  });

  it('refuse les IPv6 non publiques (loopback, ULA, link-local, NAT64, doc, ::)', () => {
    const targets = [
      'https://[::1]/',
      'https://[::]/',
      'https://[fd00::1]:8443/',
      'https://[fc00::2]/',
      'https://[fe80::1]/',
      'https://[64:ff9b::127.0.0.1]/',
      'https://[2001:db8::7]/'
    ];
    for (const target of targets) {
      assert.deepEqual(validateRemoteMcpUrl(target), {
        allowed: false,
        reason: 'NON_PUBLIC_ADDRESS'
      });
    }
  });

  it('refuse une IPv4-mappée IPv6 même si la cible embarquée est publique', () => {
    assert.deepEqual(validateRemoteMcpUrl('https://[::ffff:127.0.0.1]/'), {
      allowed: false,
      reason: 'IPV4_MAPPED_IPV6'
    });
    assert.deepEqual(validateRemoteMcpUrl('https://[::ffff:8.8.8.8]/'), {
      allowed: false,
      reason: 'IPV4_MAPPED_IPV6'
    });
    assert.equal(classifyRemoteMcpAddress('::ffff:8.8.8.8'), 'IPV4_MAPPED_IPV6');
    assert.equal(classifyRemoteMcpAddress('::FFFF:7f00:1'), 'IPV4_MAPPED_IPV6');
  });

  it('classifie avec précision les adresses littérales', () => {
    assert.equal(classifyRemoteMcpAddress('8.8.8.8'), 'PUBLIC');
    assert.equal(classifyRemoteMcpAddress('208.80.154.224'), 'PUBLIC');
    assert.equal(classifyRemoteMcpAddress('127.0.0.1'), 'LOOPBACK');
    assert.equal(classifyRemoteMcpAddress('10.1.2.3'), 'PRIVATE');
    assert.equal(classifyRemoteMcpAddress('172.16.4.4'), 'PRIVATE');
    assert.equal(classifyRemoteMcpAddress('172.31.9.9'), 'PRIVATE');
    assert.equal(classifyRemoteMcpAddress('172.32.1.1'), 'PUBLIC');
    assert.equal(classifyRemoteMcpAddress('192.168.5.5'), 'PRIVATE');
    assert.equal(classifyRemoteMcpAddress('100.64.0.9'), 'PRIVATE');
    assert.equal(classifyRemoteMcpAddress('169.254.169.254'), 'LINK_LOCAL');
    assert.equal(classifyRemoteMcpAddress('0.0.0.0'), 'UNSPECIFIED');
    assert.equal(classifyRemoteMcpAddress('224.0.0.2'), 'MULTICAST');
    assert.equal(classifyRemoteMcpAddress('240.0.0.1'), 'RESERVED');
    assert.equal(classifyRemoteMcpAddress('2606:4700::6810:84e5'), 'PUBLIC');
    assert.equal(classifyRemoteMcpAddress('64:ff9b::127.0.0.1'), 'NAT64');
    assert.equal(classifyRemoteMcpAddress('2001:db8::7'), 'RESERVED');
    assert.equal(classifyRemoteMcpAddress('::'), 'UNSPECIFIED');
    assert.equal(classifyRemoteMcpAddress('::1'), 'LOOPBACK');
    assert.equal(classifyRemoteMcpAddress('abc'), 'INVALID');
    assert.equal(classifyRemoteMcpAddress('999.999.1.1'), 'INVALID');
  });

  it('DNS mixte public/privé : la moindre adresse non publique est rédhibitoire', () => {
    assert.deepEqual(assertPublicResolvedAddresses(['8.8.8.8']), { allowed: true });
    assert.deepEqual(assertPublicResolvedAddresses(['8.8.8.8', '10.0.0.9']), {
      allowed: false,
      reason: 'NON_PUBLIC_ADDRESS'
    });
    assert.deepEqual(assertPublicResolvedAddresses(['169.254.169.254']), {
      allowed: false,
      reason: 'NON_PUBLIC_ADDRESS'
    });
    assert.deepEqual(assertPublicResolvedAddresses(['2606:4700::6810:84e5', '::1']), {
      allowed: false,
      reason: 'NON_PUBLIC_ADDRESS'
    });
    assert.deepEqual(assertPublicResolvedAddresses(['8.8.8.8', 'garbage-entry']), {
      allowed: false,
      reason: 'NON_PUBLIC_ADDRESS'
    });
  });

  it('résolution vide = refus (fail-closed)', () => {
    assert.deepEqual(assertPublicResolvedAddresses([]), { allowed: false, reason: 'NOT_RESOLVED' });
  });

  it('résolution mappée : refus de la forme ::ffff:', () => {
    assert.deepEqual(assertPublicResolvedAddresses(['::ffff:8.8.8.8']), {
      allowed: false,
      reason: 'IPV4_MAPPED_IPV6'
    });
  });

  it('redirections: 3 sauts https acceptés, 4 sauts refusés', () => {
    const chain = [
      'https://hop1.example.com/first',
      'https://hop2.example.com/second',
      'https://hop3.example.com/third'
    ];
    assert.deepEqual(validateRemoteMcpRedirectChain('https://start.example.com/x', chain), {
      allowed: true
    });
    assert.deepEqual(
      validateRemoteMcpRedirectChain('https://start.example.com/x', [...chain, 'https://hop4.example.com/fourth']),
      { allowed: false, reason: 'REDIRECT_LIMIT' }
    );
  });

  it('redirections: chaque saut est revalidé (pas de downgrade, pas de cible privée)', () => {
    assert.deepEqual(
      validateRemoteMcpRedirectChain('https://start.example.com/x', ['http://hop.example.com/second']),
      { allowed: false, reason: 'NON_HTTPS' }
    );
    assert.deepEqual(
      validateRemoteMcpRedirectChain('https://start.example.com/x', ['https://10.0.0.2/next']),
      { allowed: false, reason: 'NON_PUBLIC_ADDRESS' }
    );
    assert.deepEqual(
      validateRemoteMcpRedirectChain('https://start.example.com/x', ['https://user@hop.example.com/']),
      { allowed: false, reason: 'CREDENTIALS_IN_URL' }
    );
  });
});
