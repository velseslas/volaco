/**
 * PATCH L1 — BARRIÈRE TERMINALE D'IMAGES DANS buildApp (tests).
 *
 * Chaque test traverse la VÉRITABLE frontière buildApp (assembleur Vite réel,
 * swap atomique inclus) — aucun test ne valide un helper isolé :
 *  1. sources conformes            → le build continue (ok + dist réel) ;
 *  2. URL interdite                → refus avant assemblage ;
 *  3. violation HORS des fichiers   → refus (le gate scanne TOUT le workspace,
 *     de l'appelant                               pas seulement l'entrée) ;
 *  4. erreur du scanner            → refus fail-closed ;
 *  5. échec de collecte            → refus fail-closed ;
 *  6. refus                        → dernier bundle valide IDENTIQUE octet à octet ;
 *  7. refus puis correction        → build valide à nouveau possible ;
 *  8. contrôle d'appelant préalable → insuffisant (seul le disque compte) ;
 *  9. politique undetermined       → INCHANGÉE (non bloquant) sur ce lot ;
 * 10. refus d'un projet sans effet → sur un autre projet.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildApp,
  ensureWorkspace,
  writeAppFile,
  workspaceDir
} from '../src/app-pipeline.js';
import { inspectAppImageSources } from '../src/image/app-policy.js';

const CLEAN_APP = 'export default function App() { return <div>L1 VERSION A</div>; }';
const CLEAN_APP_V2 = 'export default function App() { return <div>L1 VERSION B</div>; }';
const POISON_APP =
  'export default function App() {\n'
  + '  return (\n'
  + '    <main>\n'
  + '      <img src="https://loremflickr.com/1200/800/food" alt="salle" />\n'
  + '    </main>\n'
  + '  );\n'
  + '}\n';
const POISON_INJECTED =
  'export default function Injected() {\n'
  + '  return <img src="https://forbidden.invalid/poison.jpg" alt="x" />;\n'
  + '}\n';
const DYNAMIC_APP =
  "export default function App() {\n"
  + "  const seeds: string[] = ['https://picsum.photos/seed/a'];\n"
  + "  return <img src={'https://picsum.photos/seed/' + seeds[0]} alt=\"x\" />;\n"
  + "}\n";

/** App.tsx propre (l'appelant ne toucherait QUE ce fichier). */
function freshCleanProject(projectId: string): void {
  const w = writeAppFile(projectId, 'src/App.tsx', CLEAN_APP);
  assert.equal(w.ok, true, 'préparation ' + projectId + ' : ' + (w.reason ?? ''));
}

function wsOf(projectId: string): string {
  return workspaceDir(projectId);
}

describe('PATCH L1 : barrière terminale d images de buildApp', () => {
  it('1. sources conformes : le build continue normalement (dist réel, undeterminedCount=0)', async () => {
    ensureWorkspace('test-l1-01', true);
    freshCleanProject('test-l1-01');
    const build = await buildApp('test-l1-01');
    assert.equal(build.ok, true, 'préparation conforme : ' + build.errors.join(' | '));
    assert.equal(build.refused, undefined, 'aucun refus sur sources conformes');
    assert.ok(existsSync(join(wsOf('test-l1-01'), 'dist', 'index.html')), 'bundle construit');
    assert.equal(build.undeterminedCount, 0, 'diagnostic undetermined sur build conforme');
  });

  it('2. URL interdite dans la source : refus AVANT assemblage (aucun dist créé)', async () => {
    ensureWorkspace('test-l1-02', true);
    const w = writeAppFile('test-l1-02', 'src/App.tsx', POISON_APP);
    assert.equal(w.ok, true, 'l écriture workspace est hors du lot L1 (route non gatée) : ' + (w.reason ?? ''));
    const build = await buildApp('test-l1-02');
    assert.equal(build.ok, false, 'build refusé');
    assert.equal(build.refused, 'images');
    assert.ok(build.errors[0]!.includes('Images interdites'), 'diagnostic principal : ' + build.errors[0]);
    const line = build.errors.find((l) => l.includes('src/App.tsx') && l.includes('loremflickr'));
    assert.ok(line, 'violation localisée fichier/url : ' + build.errors.join(' | '));
    assert.ok(build.errors.some((l) => l.includes('hôte non autorisé')), 'raison du scanner rapportée');
    assert.ok(!existsSync(join(wsOf('test-l1-02'), 'dist')), 'AUCUN dist créé par un build refusé');
  });

  it('3. violation dans un fichier NON touché par l appelant : refus quand même', async () => {
    ensureWorkspace('test-l1-03', true);
    freshCleanProject('test-l1-03'); // l appelant n écrit que App.tsx (propre)
    const w = writeAppFile('test-l1-03', 'src/components/Injected.tsx', POISON_INJECTED);
    assert.equal(w.ok, true);
    const subset = inspectAppImageSources([{ path: 'src/App.tsx', content: CLEAN_APP }]);
    assert.equal(subset.violations.length, 0, 'le contenu écrit par l appelant est conforme');
    const build = await buildApp('test-l1-03');
    assert.equal(build.ok, false, 'le disque réel compte : refus');
    assert.equal(build.refused, 'images');
    assert.ok(build.errors.some((l) => l.includes('Injected.tsx') && l.includes('forbidden.invalid')),
      'violation du fichier non-mentionné rapportée : ' + build.errors.join(' | '));
  });

  it('4. exception du scanner : refus fail-closed (inspection injectée)', async () => {
    ensureWorkspace('test-l1-04', true);
    freshCleanProject('test-l1-04');
    const build = await buildApp('test-l1-04', {
      imageInspector: () => { throw new Error('boom-scan'); }
    });
    assert.equal(build.ok, false);
    assert.equal(build.refused, 'inspection-error');
    assert.ok(build.errors[0]!.includes('Inspection des images impossible'), 'diagnostic fail-closed : ' + build.errors[0]);
    assert.ok(build.errors[0]!.includes('boom-scan'), 'message de l erreur du scanner conservé');
    assert.ok(build.undeterminedCount === undefined, 'undetermined non comptabilisé si l inspection plante');
    assert.ok(!existsSync(join(wsOf('test-l1-04'), 'dist')), 'aucune publication sur erreur scanner');
  });

  it('5. échec de collecte des sources : refus fail-closed', async () => {
    ensureWorkspace('test-l1-05', true);
    freshCleanProject('test-l1-05');
    const build = await buildApp('test-l1-05', {
      buildSourcesCollector: () => { throw new Error('collect-boom'); }
    });
    assert.equal(build.ok, false);
    assert.equal(build.refused, 'inspection-error');
    assert.ok(build.errors[0]!.includes('collect-boom'), 'diagnostic de collecte conservé : ' + build.errors[0]);
    assert.ok(!existsSync(join(wsOf('test-l1-05'), 'dist')));
  });

  it('6. après un refus, le dernier bundle valide reste IDENTIQUE octet à octet', async () => {
    ensureWorkspace('test-l1-06', true);
    freshCleanProject('test-l1-06');
    const good = await buildApp('test-l1-06');
    assert.equal(good.ok, true, 'préparation : ' + good.errors.join(' | '));
    const ws = wsOf('test-l1-06');
    const beforeIndex = readFileSync(join(ws, 'dist', 'index.html'));
    const beforeListing = readdirSync(join(ws, 'dist')).sort();
    assert.ok(beforeIndex.length > 1000, 'bundle de référence substantiel');
    // Poison puis refus :
    const w = writeAppFile('test-l1-06', 'src/App.tsx', POISON_APP);
    assert.equal(w.ok, true);
    const refused = await buildApp('test-l1-06');
    assert.equal(refused.ok, false);
    assert.equal(refused.refused, 'images');
    // Aucune altération du bundle servi :
    const afterIndex = readFileSync(join(ws, 'dist', 'index.html'));
    assert.ok(beforeIndex.equals(afterIndex), 'index.html du bundle servi INCHANGÉ');
    assert.deepEqual(readdirSync(join(ws, 'dist')).sort(), beforeListing, 'contenu dist inchangé');
    const leftovers = readdirSync(ws).filter((n) => n.startsWith('dist-next-') || n === 'dist-prev');
    assert.deepEqual(leftovers, [], 'aucun temporaire résiduel');
  });

  it('7. après un refus, un build VALIDE reste possible (sources corrigées)', async () => {
    ensureWorkspace('test-l1-07', true);
    freshCleanProject('test-l1-07');
    const w1 = writeAppFile('test-l1-07', 'src/App.tsx', POISON_APP);
    assert.equal(w1.ok, true);
    const refused = await buildApp('test-l1-07');
    assert.equal(refused.ok, false);
    // Correction légitime (ce que les rounds IA / rollback appliqueraient) :
    const w2 = writeAppFile('test-l1-07', 'src/App.tsx', CLEAN_APP_V2);
    assert.equal(w2.ok, true);
    const fixed = await buildApp('test-l1-07');
    assert.equal(fixed.ok, true, 'build post-correction : ' + fixed.errors.join(' | '));
    assert.ok(readFileSync(join(wsOf('test-l1-07'), 'dist', 'index.html'), 'utf8').includes('L1 VERSION B'),
      'le NOUVEAU bundle contient bien la correction');
  });

  it('8. la barrière lit le DISQUE : un contrôle préalable de l appelant est insuffisant', async () => {
    ensureWorkspace('test-l1-08', true);
    freshCleanProject('test-l1-08');
    // Situation : l appelant a vérifié "son" fichier — poison apparu via un
    // autre chemin. Aucun contrôle externe ne déverrouille : buildApp refuse
    // sur l'état réel du disque.
    const w = writeAppFile('test-l1-08', 'src/side/Other.tsx', POISON_INJECTED);
    assert.equal(w.ok, true);
    const cleanSubset = inspectAppImageSources([{ path: 'src/App.tsx', content: CLEAN_APP }]);
    assert.equal(cleanSubset.violations.length, 0, 'contrôle "appelant" propre (futile)');
    const build = await buildApp('test-l1-08');
    assert.equal(build.ok, false, 'refus : seul le disque compte');
    assert.equal(build.refused, 'images');
  });

  it('9. politique undetermined INCHANGÉE : expression JSX dynamique NON bloquante', async () => {
    ensureWorkspace('test-l1-09', true);
    const w = writeAppFile('test-l1-09', 'src/App.tsx', DYNAMIC_APP);
    assert.equal(w.ok, true, 'préparation : ' + (w.reason ?? ''));
    // La classification du scanner retient un état dynamique explicite :
    const classification = inspectAppImageSources([{ path: 'src/App.tsx', content: DYNAMIC_APP }]);
    assert.equal(classification.violations.length, 0);
    assert.equal(classification.undetermined.length, 1, 'src={expr} réelle => undetermined');
    const build = await buildApp('test-l1-09');
    assert.equal(build.ok, true, 'undetermined reste NON bloquant : ' + build.errors.join(' | '));
    assert.equal(build.undeterminedCount, 1, 'diagnostic undetermined présent sur ok');
  });

  it('10. aucun effet de bord inter-projets : A refusé, B build conforme sans dérive', async () => {
    ensureWorkspace('test-l1-10a', true);
    const wa = writeAppFile('test-l1-10a', 'src/App.tsx', POISON_APP);
    assert.equal(wa.ok, true);
    const refusedA = await buildApp('test-l1-10a');
    assert.equal(refusedA.ok, false);
    assert.equal(refusedA.refused, 'images');

    ensureWorkspace('test-l1-10b', true);
    freshCleanProject('test-l1-10b');
    const okB = await buildApp('test-l1-10b');
    assert.equal(okB.ok, true, 'B construit indépendamment : ' + okB.errors.join(' | '));
    assert.ok(existsSync(join(wsOf('test-l1-10b'), 'dist', 'index.html')), 'B a son bundle');
    assert.ok(!existsSync(join(wsOf('test-l1-10a'), 'dist')), 'A : aucun dist (refus)');
    const okB2 = await buildApp('test-l1-10b');
    assert.equal(okB2.ok, true, 'rebuild B stable : ' + okB2.errors.join(' | '));
    assert.ok(existsSync(join(wsOf('test-l1-10b'), 'dist', 'index.html')));
  });
});
