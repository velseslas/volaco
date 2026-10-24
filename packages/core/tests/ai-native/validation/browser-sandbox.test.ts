/**
 * V7-LOT7 — tests du sandbox d'exécution navigateur.
 *
 * Ces tests lancent un Chromium réel (playwright-core) quand il est installé.
 * Ils prouvent :
 *  - qu'un document sain s'exécute et produit métriques + capture ;
 *  - qu'une erreur JS non gérée ou une erreur console bloque ;
 *  - qu'une dépendance externe coupée reste un WARN consultatif ;
 *  - qu'une syntaxe invalide reste bloquante même avec un CDN absent ;
 *  - qu'une indisponibilité de Chromium est rapportée honnêtement sans être
 *    présentée comme un échec du document.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ChromiumBrowserSandbox,
  isBrowserSandboxAvailable,
  resolveSandboxJsHeapLimitMb
} from '../../../src/ai-native/validation/browser-sandbox.js';

const VALID_HTML = `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <title>Sandbox V7</title>
    <style>body { font-family: sans-serif; margin: 2rem; }</style>
  </head>
  <body>
    <main>
      <h1>Sandbox d'exécution</h1>
      <p>Document autoporté exécuté dans Chromium headless, sans réseau.</p>
      <button type="button">Action</button>
    </main>
    <script>document.body.dataset.ready = 'true';</script>
  </body>
</html>`;

async function skipWithoutBrowser(t: { skip: (message: string) => void }): Promise<boolean> {
  if (await isBrowserSandboxAvailable()) return false;
  t.skip('Chromium/playwright-core indisponible sur cette machine');
  return true;
}

describe('V7-LOT7 — sandbox d’exécution navigateur', () => {
  it('1. document sain : PASS, métriques DOM et capture réelle', async (t) => {
    if (await skipWithoutBrowser(t)) return;
    const runner = new ChromiumBrowserSandbox();
    const report = await runner.run(VALID_HTML, { path: 'index.html', timeoutMs: 8000 });

    assert.equal(report.blocking, false);
    assert.equal(report.passed, true);
    assert.ok(report.verdict === 'PASS' || report.verdict === 'PASS_WITH_WARNINGS', report.verdict);
    assert.equal(report.title, 'Sandbox V7');
    assert.ok(report.metrics.domNodes > 5, `domNodes=${report.metrics.domNodes}`);
    assert.ok(report.metrics.interactiveElements >= 1);
    assert.ok(report.metrics.visibleTextLength > 20);
    assert.ok(report.metrics.screenshotBytes > 0);
    assert.match(report.metrics.screenshotSha256, /^[a-f0-9]{64}$/);
    assert.match(report.screenshotDataUrl ?? '', /^data:image\/jpeg;base64,/);
    assert.equal(report.contentHash.length, 64);
    assert.ok(report.durationMs >= 0);
    assert.equal(report.isolation?.mode, 'PROCESS');
    assert.equal(report.isolation?.containerized, false);
    assert.equal(report.isolation?.network, 'OFFLINE_AND_ABORT');
    assert.equal(report.isolation?.serviceWorkers, 'BLOCKED');
    assert.equal(report.isolation?.downloads, 'BLOCKED');
    assert.equal(report.isolation?.popups, 'BLOCKED');
    assert.equal(report.isolation?.dialogs, 'DISMISSED');
    assert.equal(report.isolation?.permissions, 'DENIED');
    assert.equal(report.isolation?.websockets, 'BLOCKED');
    assert.equal(report.isolation?.profile, 'PLAYWRIGHT_EPHEMERAL');
    assert.equal(report.isolation?.jsHeapLimitMb, resolveSandboxJsHeapLimitMb());
  });

  it('2. erreur JavaScript non gérée : FAIL dur et bloquant', async (t) => {
    if (await skipWithoutBrowser(t)) return;
    const html = VALID_HTML.replace(
      "document.body.dataset.ready = 'true';",
      "throw new Error('boom-lot7');"
    );
    const report = await new ChromiumBrowserSandbox().run(html, { path: 'boom.html', timeoutMs: 8000 });

    assert.equal(report.verdict, 'FAIL');
    assert.equal(report.blocking, true);
    assert.equal(report.passed, false);
    assert.ok(report.pageErrors.some((entry) => entry.includes('boom-lot7')), report.pageErrors.join(' | '));
    assert.ok(report.blockers.some((entry) => entry.includes('boom-lot7')), report.blockers.join(' | '));
  });

  it('3. console.error : FAIL dur', async (t) => {
    if (await skipWithoutBrowser(t)) return;
    const html = VALID_HTML.replace(
      "document.body.dataset.ready = 'true';",
      "console.error('erreur-console-lot7');"
    );
    const report = await new ChromiumBrowserSandbox().run(html, { path: 'console.html', timeoutMs: 8000 });

    assert.equal(report.verdict, 'FAIL');
    assert.equal(report.blocking, true);
    assert.ok(
      report.blockers.some((entry) => entry.includes('erreur-console-lot7')),
      report.blockers.join(' | ')
    );
  });

  it('4. dépendance externe coupée : WARN consultatif, pas FAIL', async (t) => {
    if (await skipWithoutBrowser(t)) return;
    const html = VALID_HTML.replace(
      '</main>',
      '</main><img src="https://example.com/absent-lot7.png" alt="distante">'
    );
    const report = await new ChromiumBrowserSandbox().run(html, { path: 'external.html', timeoutMs: 8000 });

    assert.equal(report.blocking, false, report.blockers.join(' | '));
    assert.equal(report.passed, true);
    assert.equal(report.verdict, 'PASS_WITH_WARNINGS');
    assert.ok(report.metrics.externalRequestsBlocked >= 1);
    assert.ok(
      report.warnings.some((entry) => /requête\(s\) externe\(s\) bloquée\(s\)/.test(entry)),
      report.warnings.join(' | ')
    );
  });

  it('5. syntaxe invalide avec CDN bloqué : FAIL intrinsèque maintenu', async (t) => {
    if (await skipWithoutBrowser(t)) return;
    const html = VALID_HTML.replace(
      '<script>document.body.dataset.ready = \'true\';</script>',
      '<script src="https://cdn.example.com/lib.js"></script><script>function () {</script>'
    );
    const report = await new ChromiumBrowserSandbox().run(html, { path: 'syntax.html', timeoutMs: 8000 });

    assert.equal(report.blocking, true, report.warnings.join(' | '));
    assert.ok(report.pageErrors.some((entry) => /SyntaxError/i.test(entry)), report.pageErrors.join(' | '));
  });

  it('6. TypeError avec CDN bloqué : FAIL intrinsèque maintenu', async (t) => {
    if (await skipWithoutBrowser(t)) return;
    const html = VALID_HTML.replace(
      '<script>document.body.dataset.ready = \'true\';</script>',
      '<script src="https://cdn.example.com/lib.js"></script><script>const broken = null; broken.value = 1;</script>'
    );
    const report = await new ChromiumBrowserSandbox().run(html, { path: 'type-error.html', timeoutMs: 8000 });

    assert.equal(report.blocking, true, report.warnings.join(' | '));
    assert.ok(report.pageErrors.some((entry) => /TypeError/i.test(entry)), report.pageErrors.join(' | '));
  });

  it('7. ReferenceError avec CDN bloqué : WARN consultatif', async (t) => {
    if (await skipWithoutBrowser(t)) return;
    const html = VALID_HTML.replace(
      '<script>document.body.dataset.ready = \'true\';</script>',
      '<script src="https://cdn.example.com/lib.js"></script><script>missingGlobalFromCdn();</script>'
    );
    const report = await new ChromiumBrowserSandbox().run(html, { path: 'reference-error.html', timeoutMs: 8000 });

    assert.equal(report.blocking, false, report.blockers.join(' | '));
    assert.equal(report.passed, true);
    assert.equal(report.verdict, 'PASS_WITH_WARNINGS');
    assert.ok(report.pageErrors.some((entry) => /ReferenceError/i.test(entry)), report.pageErrors.join(' | '));
    assert.ok(report.warnings.some((entry) => /dépendance externe bloquée/i.test(entry)));
  });

  it("8. réseau réellement coupé : aucune requête n'atteint un serveur local", async (t) => {
    if (await skipWithoutBrowser(t)) return;
    let requests = 0;
    const server = createServer((_req, res) => {
      requests += 1;
      res.statusCode = 200;
      res.end('leak');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    try {
      const html = VALID_HTML.replace(
        "document.body.dataset.ready = 'true';",
        "fetch('http://127.0.0.1:" + port + "/leak?secret=lot7').catch(function () {});"
      ).replace(
        '</main>',
        '</main><img src="http://127.0.0.1:' + port + '/pixel.png" alt="local">'
      );
      const report = await new ChromiumBrowserSandbox().run(html, { path: 'network.html', timeoutMs: 8000 });
      await new Promise((resolve) => setTimeout(resolve, 150));

      assert.equal(requests, 0, 'aucune requête ne doit atteindre le serveur local');
      assert.equal(report.blocking, false, report.blockers.join(' | '));
      assert.equal(report.passed, true);
      assert.ok(report.metrics.externalRequestsBlocked >= 2);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('9. Chromium introuvable : UNAVAILABLE honnête, non bloquant', async (t) => {
    if (await skipWithoutBrowser(t)) return;
    const report = await new ChromiumBrowserSandbox().run(VALID_HTML, {
      path: 'missing.html',
      executablePath: 'Z:\\chemin\\chromium-inexistant\\chrome.exe'
    });

    assert.equal(report.verdict, 'UNAVAILABLE');
    assert.equal(report.passed, false);
    assert.equal(report.blocking, false);
    assert.ok(report.warnings.some((entry) => entry.includes('Chromium introuvable')));
  });

  it('10. tests fonctionnels générés : bouton sain cliqué, PASS', async (t) => {
    if (await skipWithoutBrowser(t)) return;
    const report = await new ChromiumBrowserSandbox().run(VALID_HTML, {
      path: 'functional-pass.html',
      timeoutMs: 8000,
      functionalTests: true
    });

    assert.ok(report.functionalTests, 'rapport fonctionnel attendu');
    assert.equal(report.functionalTests.verdict, 'PASS', report.functionalTests.scenarios
      .map((scenario) => `${scenario.status}:${scenario.name}:${scenario.message ?? ''}`)
      .join(' | '));
    assert.equal(report.functionalTests.blocking, false);
    assert.equal(report.functionalTests.generatedFrom, 'DOM');
    assert.ok(report.functionalTests.total >= 3);
    assert.ok(report.functionalTests.scenarios.some((scenario) =>
      scenario.kind === 'INTERACTION' && scenario.status === 'PASS'
    ));
    assert.equal(report.blocking, false);
  });

  it('11. tests fonctionnels générés : erreur au clic, FAIL bloquant sans casser le runtime', async (t) => {
    if (await skipWithoutBrowser(t)) return;
    const html = VALID_HTML.replace(
      '<button type="button">Action</button>',
      '<button type="button" onclick="throw new Error(\'functional-boom\')">Action</button>'
    );
    const report = await new ChromiumBrowserSandbox().run(html, {
      path: 'functional-fail.html',
      timeoutMs: 8000,
      functionalTests: true
    });

    // Le chargement reste sain : le runtime ne doit pas être déclaré FAIL.
    assert.equal(report.verdict, 'PASS', report.blockers.join(' | '));
    assert.equal(report.blocking, false);
    assert.ok(report.functionalTests, 'rapport fonctionnel attendu');
    assert.equal(report.functionalTests.verdict, 'FAIL');
    assert.equal(report.functionalTests.blocking, true);
    assert.ok(report.functionalTests.scenarios.some((scenario) =>
      scenario.status === 'FAIL' && /functional-boom/.test(scenario.message ?? '')
    ), report.functionalTests.scenarios.map((scenario) => scenario.message ?? scenario.name).join(' | '));
  });

  it('12. tests fonctionnels générés : nom accessible manquant = WARN non bloquant', async (t) => {
    if (await skipWithoutBrowser(t)) return;
    const html = VALID_HTML.replace(
      '<button type="button">Action</button>',
      '<button type="button"><span></span></button>'
    );
    const report = await new ChromiumBrowserSandbox().run(html, {
      path: 'functional-a11y.html',
      timeoutMs: 8000,
      functionalTests: true
    });

    assert.ok(report.functionalTests);
    assert.equal(report.functionalTests.verdict, 'PASS_WITH_WARNINGS');
    assert.equal(report.functionalTests.blocking, false);
    assert.ok(report.functionalTests.scenarios.some((scenario) =>
      scenario.kind === 'A11Y' && scenario.status === 'WARN'
    ));
  });

  it('13. tests fonctionnels générés : formulaire requis validé sans soumission', async (t) => {
    if (await skipWithoutBrowser(t)) return;
    const html = VALID_HTML.replace(
      '<button type="button">Action</button>',
      '<form><label for="email-lot8">Email</label>' +
      '<input id="email-lot8" name="email" type="email" required>' +
      '<button type="submit">Envoyer</button></form>'
    );
    const report = await new ChromiumBrowserSandbox().run(html, {
      path: 'functional-form.html',
      timeoutMs: 8000,
      functionalTests: true
    });

    assert.ok(report.functionalTests);
    assert.equal(report.functionalTests.verdict, 'PASS', report.functionalTests.scenarios
      .map((scenario) => `${scenario.status}:${scenario.name}:${scenario.message ?? ''}`)
      .join(' | '));
    assert.equal(report.functionalTests.blocking, false);
    assert.ok(report.functionalTests.scenarios.some((scenario) =>
      scenario.kind === 'FORM' && scenario.status === 'PASS'
    ));
  });

  it('14. tests fonctionnels générés : navigation externe non suivie, jamais bloquante', async (t) => {
    if (await skipWithoutBrowser(t)) return;
    const html = VALID_HTML.replace(
      '<button type="button">Action</button>',
      '<button type="button" onclick="location.href=\'https://example.com/\'">Aller</button>'
    );
    const report = await new ChromiumBrowserSandbox().run(html, {
      path: 'functional-navigation.html',
      timeoutMs: 8000,
      functionalTests: true
    });

    assert.ok(report.functionalTests);
    assert.equal(report.functionalTests.blocking, false);
    assert.notEqual(report.functionalTests.verdict, 'FAIL');
    const click = report.functionalTests.scenarios.find((scenario) =>
      scenario.kind === 'INTERACTION' && scenario.id.startsWith('click-')
    );
    assert.ok(click, 'le bouton doit être couvert');
    assert.notEqual(click?.status, 'FAIL', click?.message ?? 'navigation non bloquante');
  });

  it('15. dialogue natif : dismiss immédiat, pas de timeout', async (t) => {
    if (await skipWithoutBrowser(t)) return;
    const html = VALID_HTML.replace(
      "document.body.dataset.ready = 'true';",
      "alert('dialogue-hardening'); document.body.dataset.ready = 'true';"
    );
    const report = await new ChromiumBrowserSandbox().run(html, {
      path: 'dialog.html',
      timeoutMs: 8000
    });

    assert.notEqual(report.verdict, 'FAIL', report.blockers.join(' | '));
    assert.equal(report.blocking, false);
    assert.ok(report.durationMs < 8000, `durée=${report.durationMs}ms`);
    assert.equal(report.isolation?.dialogs, 'DISMISSED');
  });
});
