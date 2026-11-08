/**
 * LOT UI-MCP — Test STRUCTUREL du shell Studio (index.html).
 *
 * Vérifie l'intégration des deux nouvelles espaces MCP sans exécuter le shell
 * complet (20k+ lignes) : vues, routage hash, navigation + visibilité rôle,
 * greffons de montage, tags de scripts UNIQUES (aucune duplication de surface),
 * préservation des surfaces existantes (hub MCP, connecteurs, mcp-remote.js).
 *
 * Le comportement réel des modules est couvert par :
 *   - mcp-user-hub-studio.test.ts (sandbox vm, page utilisateur) ;
 *   - mcp-admin-studio.test.ts   (sandbox vm, page administrateur).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

function findRepoRoot(): string {
  let dir = TEST_DIR;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, 'apps', 'studio', 'index.html'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Racine du dépôt introuvable (apps/studio/index.html) depuis ' + TEST_DIR);
}

const REPO_ROOT = findRepoRoot();
const SHELL = readFileSync(join(REPO_ROOT, 'apps', 'studio', 'index.html'), 'utf8');

/** Compte les occurrences d'un littéral exact. */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Compte les tags <script src="..."> exacts (jamais les commentaires). */
function scriptTags(src: string): number {
  const pattern = new RegExp(`<script\\s+src="${src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g');
  return (SHELL.match(pattern) ?? []).length;
}

test('SHELL-01 — les deux vues MCP existent, sont masquées par défaut et bien montées', () => {
  assert.equal(count(SHELL, 'id="view-mcphub"'), 1, 'une seule vue utilisateur');
  assert.equal(count(SHELL, 'id="view-mcpadmin"'), 1, 'une seule vue admin');
  assert.equal(count(SHELL, 'id="mcpUserHubMount"'), 1, 'montage utilisateur unique');
  assert.equal(count(SHELL, 'id="mcpAdminMount"'), 1, 'montage admin unique');

  // Les deux vues sont masquées au chargement (classe hidden sur la div).
  const userView = /<div id="view-mcphub" class="[^"]*\bhidden\b[^"]*"/;
  const adminView = /<div id="view-mcpadmin" class="[^"]*\bhidden\b[^"]*"/;
  assert.match(SHELL, userView, 'vue utilisateur masquée par défaut');
  assert.match(SHELL, adminView, 'vue admin masquée par défaut');

  // Les montages sont VIDES dans le shell (les modules se greffent seuls :
  // aucune structure dupliquée en dur dans le HTML).
  assert.match(SHELL, /<div id="mcpUserHubMount"><\/div>/, 'montage utilisateur vide');
  assert.match(SHELL, /<div id="mcpAdminMount"><\/div>/, 'montage admin vide');
});

test('SHELL-02 — navigation : hash VIEWS + switchSystemView + rendu à l ouverture', () => {
  assert.match(
    SHELL,
    /const HASH_VIEWS = \['mcp', 'connecteurs', 'skills', 'apikeys', 'mcphub', 'mcpadmin'\];/,
    'routage hash couvrant les deux vues (#mcphub, #mcpadmin survivent au F5)'
  );
  // La liste des vues gérées par switchSystemView inclut les deux nouvelles.
  const forEachList = SHELL.match(/\['home', 'dashboard', 'workspace', 'settings'[^\]]*\]\.forEach/);
  assert.ok(forEachList, 'liste des vues de switchSystemView trouvée');
  assert.ok(forEachList![0].includes("'mcphub'"), 'mcphub dans la liste');
  assert.ok(forEachList![0].includes("'mcpadmin'"), 'mcpadmin dans la liste');
  // Chaque ouverture recharge les données réelles via les modules.
  assert.match(SHELL, /window\.__mcpUserHub && typeof window\.__mcpUserHub\.onShow === 'function'/,
    'appel onShow du hub utilisateur');
  assert.match(SHELL, /window\.__mcpAdminUi && typeof window\.__mcpAdminUi\.onShow === 'function'/,
    'appel onShow de la surface admin');
  // La réécriture du className du menu réactive la visibilité par rôle (fail-closed).
  assert.match(SHELL, /typeof window\.syncMcpAdminMenu === 'function'\) window\.syncMcpAdminMenu\(\);/,
    'resynchronisation du menu admin après chaque changement de vue');
});

test('SHELL-03 — menu : entrées présentes, admin fail-closed (hidden par défaut)', () => {
  assert.equal(count(SHELL, 'id="menuNav-mcphub"'), 1, 'entrée menu utilisateur unique');
  assert.equal(count(SHELL, 'id="menuNav-mcpadmin"'), 1, 'entrée menu admin unique');
  // L'entrée admin porte hidden dans son markup de départ (le module la rend
  // visible UNIQUEMENT pour OWNER/ADMIN — cosmétique, serveur = autorité).
  const adminMenu = SHELL.match(/<button[^>]*id="menuNav-mcpadmin"[^>]*>/);
  assert.ok(adminMenu, 'bouton menu admin trouvé');
  assert.ok(adminMenu![0].includes('hidden'), 'menu admin masqué par défaut (fail-closed)');
  // Les deux boutons routent vers leur vue.
  assert.match(SHELL, /switchSystemView\('mcphub'\)/);
  assert.match(SHELL, /switchSystemView\('mcpadmin'\)/);
});

test('SHELL-04 — scripts : tags UNIQUES, aucun doublon de surface MCP', () => {
  assert.equal(scriptTags('mcp-user-hub.js'), 1, 'un seul tag mcp-user-hub.js');
  assert.equal(scriptTags('mcp-admin.js'), 1, 'un seul tag mcp-admin.js');
  // Surfaces existantes intactes et non dupliquées.
  assert.equal(scriptTags('mcp-remote.js'), 1, 'EXACTEMENT UN tag mcp-remote.js (régression historique)');
  assert.equal(scriptTags('mcp-hub.js'), 1, 'un seul tag mcp-hub.js (hub existant préservé)');
  // Les tags différés sont adjacents (même ordre de chargement).
  const block = SHELL.match(/<script src="mcp-hub\.js" defer><\/script>\s*<script src="mcp-user-hub\.js" defer><\/script>\s*<script src="mcp-admin\.js" defer><\/script>/);
  assert.ok(block, 'ordre hub → user-hub → admin avec defer');
});

test('SHELL-05 — surfaces existantes préservées (pas de hub concurrent)', () => {
  // L'ancienne vue MCP (handshake stdio) et sa liste restent intactes.
  assert.equal(count(SHELL, 'id="view-mcp"'), 1, 'vue MCP historique préservée');
  assert.equal(count(SHELL, 'id="mcpServersList"'), 1, 'liste des serveurs MCP historique préservée');
  assert.equal(count(SHELL, 'id="view-connecteurs"'), 1, 'vue Connecteurs préservée');
  assert.equal(count(SHELL, 'id="mcpHubMount"'), 1, 'montage du hub C3.5 préservé (module unique)');
  // Aucun montage parasite des nouveaux modules ailleurs que dans leurs vues.
  assert.equal(count(SHELL, 'mcpUserHubMount'), 1, 'mcpUserHubMount jamais dupliqué');
  assert.equal(count(SHELL, 'mcpAdminMount'), 1, 'mcpAdminMount jamais dupliqué');
  // Le shell n'écrit aucun innerHTML vers les montages (les modules construisent).
  assert.equal(/innerHTML\s*=\s*[^=][^;]*mcp(UserHub|Admin)Mount/.test(SHELL), false,
    'aucun innerHTML vers les montages MCP');
});

test('SHELL-06 — intégration responsive : conteneurs de vues identiques aux vues existantes', () => {
  // Les deux vues reprennent la classe de conteneur des vues système existantes.
  const reference = SHELL.match(/<div id="view-mcp" class="([^"]+)"/);
  assert.ok(reference, 'vue de référence trouvée');
  const referenceClasses = reference![1]!.split(/\s+/);
  for (const id of ['view-mcphub', 'view-mcpadmin']) {
    const view = SHELL.match(new RegExp(`<div id="${id}" class="([^"]+)"`));
    assert.ok(view, `${id} trouvée`);
    for (const cls of referenceClasses) {
      assert.ok(view![1]!.split(/\s+/).includes(cls), `${id} partage la classe « ${cls} » avec view-mcp`);
    }
  }
  // Chaque vue embarque son propre conteneur de défilement pleine largeur.
  assert.match(SHELL, /<div class="px-6 py-5 max-w-6xl mx-auto w-full">\s*<!--[^>]*-->\s*<div id="mcpUserHubMount">/,
    'conteneur utilisateur pleine largeur');
  assert.match(SHELL, /<div class="px-6 py-5 max-w-6xl mx-auto w-full">\s*<!--[^>]*-->\s*<div id="mcpAdminMount">/,
    'conteneur admin pleine largeur');
});
