/**
 * P0 V8.1 §8 — gouvernance du DQI : le DQI est BLOQUÉ quand une dimension
 * critique est en échec (accessibilité responsive < 50) ou que des findings
 * CRITICAL existent. Cas réel de l'audit : DQI 94 alors que l'accessibilité
 * responsive valait 0 et que 6 findings contraste CRITICAL existaient.
 *
 * Non-régression des cas nominaux : les fixtures sans CRITICAL et avec une
 * accessibilité ≥ 50 gardent la formule exacte — c'est vérifié par la suite
 * design-dqi-colors-e44p3 (cas 1-5) qui reste le juge du terme couleur.
 */

process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { VisualIntelligenceService } from '../../../packages/core/src/ai-native/visual-intelligence/index.js';

const tenant = 'tenant_dqi_v81';
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'x-tenant-id': tenant, 'x-user-role': 'ENGINEER' };

// Texte quasi invisible sur fond blanc : ratios ~1.05:1 < 2.5 → findings
// CRITICAL réels et harmonie responsive effondrée, sur une page par ailleurs
// « harmonieuse » — exactement le profil trompeur dénoncé par l'audit.
const FIXTURE_CONTRASTE_CRITIQUE = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><title>Contraste critique</title>
<style>body{font-family:system-ui}</style></head>
<body style="background:#ffffff;color:#f5f5f5">
<header style="background:#ffffff;padding:16px"><h1 style="font-size:28px;color:#f5f5f5">Tableau de bord</h1></header>
<main>
<section style="background:#ffffff;padding:16px"><h2 style="font-size:20px;color:#f2f2f2">Section 1</h2><p style="color:#f8f8f8">Contenu illisible un.</p>
<button style="height:40px;background:#fafafa;border-radius:4px;color:#fdfdfd">Action 1</button></section>
<section style="background:#ffffff;padding:16px"><h2 style="font-size:20px;color:#f2f2f2">Section 2</h2><p style="color:#f8f8f8">Contenu illisible deux.</p>
<button style="height:40px;background:#fafafa;border-radius:4px;color:#fdfdfd">Valider</button></section>
</main>
<footer style="background:#ffffff;padding:12px"><p style="color:#f4f4f4;font-size:12px">Pied de page</p></footer>
</body></html>`;

describe('P0 V8.1 §8 — blocage du DQI si dimension critique en échec', () => {
  let server: Server;
  let baseUrl: string;
  const visual = new VisualIntelligenceService();

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

  it('DQI bloqué (≤ 49) quand l accessibilité est en échec critique — plafonné par la dimension défaillante', async () => {
    const pres = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST', headers, body: JSON.stringify({ name: 'P0 DQI V8.1 blocage' })
    });
    const pid = ((await pres.json()) as { project?: { id?: string } }).project!.id!;
    await fetch(`${baseUrl}/api/v1/projects/${pid}/files/content`, {
      method: 'PUT', headers, body: JSON.stringify({ path: 'index.html', content: FIXTURE_CONTRASTE_CRITIQUE })
    });

    const res = await fetch(`${baseUrl}/api/v1/projects/${pid}/design`, { headers });
    assert.equal(res.status, 200);
    const body = await res.json() as {
      harmony: {
        overallScore: number;
        subScores: { responsiveA11yHarmony: number };
        topFindings: Array<{ severity: string }>;
      };
      dqi: number;
    };

    // La fixture déclenche bien les signaux critiques (sinon le test ne prouve rien).
    const criticals = body.harmony.topFindings.filter((f) => f.severity === 'CRITICAL');
    assert.ok(criticals.length > 0, 'la fixture produit des findings CRITICAL réels');
    const a11y = body.harmony.subScores.responsiveA11yHarmony;
    assert.ok(a11y < 50, `dimension accessibilité en échec (score réel : ${a11y})`);

    // Formule de base (60 % harmonie + 40 % qualité perçue), mesurée avec le
    // même moteur déterministe que la route — le terme couleur reste intact.
    const analysis = await visual.analyzeVisuals(
      { tenantId: tenant + '_mesure', projectId: 'mesure_blocage', htmlContent: FIXTURE_CONTRASTE_CRITIQUE, requestId: 'req_mesure_blocage' },
      'ENGINEER'
    );
    const realColors = analysis.snapshot.extractedColors.length;
    const realFonts = analysis.snapshot.extractedFonts.length;
    const perceived = Math.max(0, Math.min(100,
      100 - Math.max(0, realColors - 8) * 4 - Math.max(0, realFonts - 3) * 6));
    const base = Math.round(body.harmony.overallScore * 0.6 + perceived * 0.4);
    assert.ok(base > 49, `sans gouvernance le DQI servirait ${base} (cas trompeur réel)`);

    const cap = Math.max(0, Math.min(49, Math.round(a11y)));
    assert.equal(body.dqi, Math.min(base, cap), 'DQI = min(formule de base, plafond dimension critique)');
    assert.ok(body.dqi <= 49, 'DQI bloqué sous le seuil de réussite (jamais 94)');
  });
});
