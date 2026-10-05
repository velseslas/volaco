/**
 * ÉTAPE 44 Phase 2C — correction du DomNormalizer pour les documents complets.
 *
 * Avant correction, `<!DOCTYPE html>` (ou un commentaire) en tête de document
 * ne matchait pas l'ancre `^<[a-zA-Z0-9-]` de parseTag : tout le document
 * dégénérait en un seul nœud « texte pur » (span/PARAGRAPH). La correction
 * ignore les préfixes non-élément (doctype, commentaires, espaces) avant le
 * premier tag et poursuit le parsing existant.
 *
 * Tests déterministes : aucun serveur, aucun navigateur, aucun réseau.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DomNormalizer,
  VisualIntelligenceService,
  DesignHarmonyService,
  type NormalizedDomNode
} from '../../../src/index.js';

const BODY = '<html lang="fr"><head><meta charset="UTF-8"><title>T</title></head><body><h1>Titre</h1><button style="height:40px">A1</button><button style="height:40px">A2</button><button style="height:40px">A3</button><button style="height:64px">A4</button></body></html>';

/** Compte tous les nœuds de l'arbre normalisé. */
function countNodes(node: NormalizedDomNode): number {
  return 1 + node.children.reduce((acc, c) => acc + countNodes(c), 0);
}

/** Collecte les rôles d'un arbre normalisé. */
function collectRoles(node: NormalizedDomNode, acc: Set<string> = new Set()): Set<string> {
  acc.add(node.role);
  for (const c of node.children) collectRoles(c, acc);
  return acc;
}

describe('ÉTAPE 44 Phase 2C — DomNormalizer et documents HTML complets', () => {
  const normalizer = new DomNormalizer();

  it('A: document complet avec DOCTYPE → racine html/CONTAINER et arbre cohérent (plus de span/PARAGRAPH)', () => {
    const root = normalizer.normalizeFromHtml(`<!DOCTYPE html>\n${BODY}`);
    assert.equal(root.tagName, 'html', 'la racine est le tag html, pas un span dégénéré');
    assert.equal(root.role, 'CONTAINER');
    assert.ok(root.children.length >= 2, 'head et body sont parsés');
    assert.ok(countNodes(root) > 5, 'l\'arbre complet est parsé');
    assert.ok(collectRoles(root).has('BUTTON'), 'les boutons sont visibles pour l\'analyse');
  });

  it('B: document complet SANS DOCTYPE → arbre identique au document avec DOCTYPE', () => {
    const withDoctype = normalizer.normalizeFromHtml(`<!DOCTYPE html>\n${BODY}`);
    const without = normalizer.normalizeFromHtml(BODY);
    assert.deepEqual(withDoctype, without,
      'le préfixe doctype est ignoré : mêmes arbres (ids déterministes)');
  });

  it('C: commentaire avant <html> → structure identique au document sans commentaire', () => {
    const withComment = normalizer.normalizeFromHtml(`<!-- généré par VibeCode -->\n${BODY}`);
    const without = normalizer.normalizeFromHtml(BODY);
    assert.deepEqual(withComment, without, 'le préfixe commentaire est ignoré : mêmes arbres');
    // Séquence combinée doctype + commentaire + espaces
    const combined = normalizer.normalizeFromHtml(`  \n<!DOCTYPE html>\n<!-- autre -->\n${BODY}`);
    assert.deepEqual(combined, without, 'séquence de préfixes multiples ignorée');
  });

  it('D: fragment <div>… → comportement existant strictement conservé', () => {
    const frag = '<div id="app"><h1>Titre</h1><button style="height:40px">A1</button><button style="height:40px">A2</button><button style="height:40px">A3</button><button style="height:64px">A4</button></div>';
    const root = normalizer.normalizeFromHtml(frag);
    assert.equal(root.tagName, 'div');
    assert.equal(root.id, 'app');
    assert.equal(root.children.length, 5, 'h1 + 4 boutons parsés comme enfants directs (comportement existant)');
    assert.equal(countNodes(root), 6, 'tous les éléments du fragment sont parsés');
    // Le corps sans préfixe et le fragment équivalent ne partagent PAS d'arbre
    // (racines différentes) mais le fragment lui-même est inchangé : HTML
    // sans préfixe non-élément = chaîne d'entrée identique au code d'avant.
    assert.equal(normalizer.normalizeFromHtml(frag).selector, 'div#app');
  });

  it('E: cas réel Design Harmony — un document complet produit des findings réels', async () => {
    const visual = new VisualIntelligenceService();
    const harmony = new DesignHarmonyService();
    const html = `<!DOCTYPE html>\n<html lang="fr"><head><meta charset="UTF-8"><style>button{background:#93c5fd;border-radius:4px}</style></head><body><h1>Titre</h1><button style="height:40px">A1</button><button style="height:40px">A2</button><button style="height:40px">A3</button><button style="height:64px">A4</button></body></html>`;

    const analysis = await visual.analyzeVisuals(
      { tenantId: 't_e44p2c', projectId: 'p_e44p2c', htmlContent: html, requestId: 'req_e44p2c' },
      'ENGINEER'
    );
    const snap = analysis.snapshot;
    assert.equal(snap.rootNode.tagName, 'html', 'snapshot non dégénéré');
    assert.ok(snap.interactiveElements.length === 4, 'les 4 boutons interactifs sont comptés');

    const report = await harmony.analyzeDesignHarmony(
      { tenantId: 't_e44p2c', projectId: 'p_e44p2c', snapshots: [snap], requestId: 'req_e44p2c' },
      'ENGINEER'
    );
    assert.ok(report.findings.length >= 1, 'le document complet produit des findings réels');
    assert.ok(
      report.findings.some((f) => f.recommendation.includes('hauteur modale')),
      'le finding COMPONENT avec sa recommandation backend est visible'
    );
  });

  it('Bords: entrée vide, doctype seul, doctype malformé — comportements conservés et honnêtes', () => {
    // Entrée vide → nœud vide (inchangé)
    const empty = normalizer.normalizeFromHtml('');
    assert.equal(empty.id, 'node-empty');
    assert.equal(empty.tagName, 'div');
    // Doctype seul → préfixe retiré, rien d'autre à parser → nœud vide (honnête)
    assert.equal(normalizer.normalizeFromHtml('<!DOCTYPE html>').id, 'node-empty');
    // Doctype malformé (pas de >) → fallback texte pur historique conservé
    const malformed = normalizer.normalizeFromHtml('<!DOCTYPE html <div>Contenu</div>');
    assert.equal(malformed.tagName, 'span', 'fallback historique inchangé pour préfixe malformé');
  });
});
