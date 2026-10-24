/**
 * P0 V8.1 §13 (audit 2026-10) — la matrice rend les axes POUR DE VRAI.
 *
 * Une page qui déclare un thème sombre et des états interactifs est rendue en
 * Chromium réel : la variante de thème est appliquée (émulation média) et les
 * états hover/focus/disabled sont réellement déclenchés avant capture.
 * Prouve :
 *  - THEME : basis MEASURED, 2 variantes réellement rendues, rendu différent
 *    → MEASURED (jamais une déclaration comptée comme mesure) ;
 *  - STATE : basis MEASURED, 3/8 états réellement rendus → PARTIAL (8/8 n'est
 *    jamais prétendu) ;
 *  - sans Chromium : repli honnête — THEME reste DECLARED, measured 0 ;
 *  - les axes non rendus (LOCALE/DATA) restent des déclarations intactes.
 */

process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const tenant = 'tenant_matrix_axes_v81';
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'x-tenant-id': tenant, 'x-user-role': 'ENGINEER' };

const THEMED_HTML = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Thèmes et états</title><style>
  body { background:#ffffff; color:#111827; font-family: system-ui; padding:24px; }
  @media (prefers-color-scheme: dark) { body { background:#0b1220; color:#e2e8f0; } }
  button { background:#2563eb; color:#ffffff; padding:12px 20px; border:0; border-radius:10px; }
  button:hover { background:#1d4ed8; }
  button:focus-visible { outline: 3px solid #93c5fd; }
  button:disabled { opacity: 0.4; }
  .empty { color:#6b7280; }
</style></head><body>
  <h1>Thèmes et états</h1>
  <p>Page avec thème sombre déclaré et états interactifs réels.</p>
  <button>Action principale</button>
  <button disabled>Aperçu désactivé</button>
  <p class="empty">Aucun élément pour l'instant.</p>
</body></html>`;

describe('P0 V8.1 §13 — matrice multi-axes : thème et états RENDUS pour de vrai', () => {
  let server: Server;
  let baseUrl: string;

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
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('rend le thème sombre et les états, sans jamais compter une déclaration comme mesure', async () => {
    const pres = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST', headers, body: JSON.stringify({ name: 'P0 matrice axes' })
    });
    const pid = ((await pres.json()) as { project?: { id?: string } }).project!.id!;
    await fetch(`${baseUrl}/api/v1/projects/${pid}/files/content`, {
      method: 'PUT', headers, body: JSON.stringify({ path: 'index.html', content: THEMED_HTML })
    });

    const res = await fetch(`${baseUrl}/api/v1/projects/${pid}/design/visual-regression`, {
      method: 'POST', headers, body: JSON.stringify({ viewports: [1440], includeScreenshots: false })
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      stored: boolean;
      report: {
        viewports: Array<{ width: number; status: string }>;
        axes: Array<{
          id: string;
          status: string;
          basis: string;
          measured: number;
          declared: number;
          expected: number;
          reason?: string;
        }>;
      };
    };
    assert.equal(body.stored, true);
    const report = body.report;
    const themeAxis = report.axes.find((axis) => axis.id === 'THEME')!;
    const stateAxis = report.axes.find((axis) => axis.id === 'STATE')!;
    const localeAxis = report.axes.find((axis) => axis.id === 'LOCALE')!;
    assert.ok(themeAxis && stateAxis && localeAxis, 'les cinq axes sont exposés');
    assert.equal(report.axes.length, 5);

    const renderAvailable = report.viewports.some((entry) => entry.status !== 'UNKNOWN');
    if (!renderAvailable) {
      // Chromium indisponible : repli HONNÊTE — aucune mesure prétendue.
      assert.equal(themeAxis.basis, 'DECLARED');
      assert.equal(themeAxis.measured, 0);
      assert.equal(stateAxis.measured, 0);
      return;
    }

    // Thème : 2 variantes réellement rendues (référence + sombre), rendu différent.
    assert.equal(themeAxis.basis, 'MEASURED');
    assert.equal(themeAxis.status, 'MEASURED');
    assert.equal(themeAxis.measured, 2);
    assert.match(themeAxis.reason!, /prefers-color-scheme/);

    // États : hover/focus/disabled réellement déclenchés → 3/8, jamais 8/8 prétendu.
    assert.equal(stateAxis.basis, 'MEASURED');
    assert.equal(stateAxis.status, 'PARTIAL');
    assert.ok(stateAxis.measured >= 1 && stateAxis.measured <= 3, `états rendus : ${stateAxis.measured}`);
    assert.match(stateAxis.reason!, /état\(s\) rendu\(s\) réellement/);

    // Les axes non rendus restent des déclarations honnêtes.
    assert.equal(localeAxis.basis, 'DECLARED');
    assert.equal(localeAxis.measured, 0);
  });
});
