/**
 * LOT UI-MCP — Tests Studio « Gestion MCP » (page ADMINISTRATEUR).
 *
 * Principe (héritage B4) : exécuter le VRAI fichier `apps/studio/mcp-admin.js`
 * dans un sandbox `vm` avec un faux DOM minimal dont `innerHTML` est interdit,
 * le fetch stubbé par routes exactes (formes réelles de mcp-catalog.ts) et une
 * session JWT fabriquée en mémoire.
 *
 * Couverture (mission §7 « Tests administrateur » côté UI) :
 *   - tableau de bord : chiffres RÉELS du backend (aucune statistique inventée),
 *     imports personnels en AGRÉGATS uniquement (aucune donnée de ligne) ;
 *   - catalogue : consultation, recherche, filtres statut/catégorie ;
 *   - création (POST avec payload whitelisté, message BROUILLON forcé) ;
 *   - transitions (matrice client miroir + arbitrage serveur 409 affiché) ;
 *   - suppression avec contrôle de dépendance (409 MCP_CATALOG_DEPENDENCY) ;
 *   - test de santé (200 {ok:false} affiché sans fake de succès) ;
 *   - historique administratif (états vide/erreur) ;
 *   - refus 403 → panneau « accès administrateur requis » + menu masqué/fail-closed ;
 *   - responsive, aucune duplication, aucun bouton sans action réelle,
 *     aucun innerHTML, aucune surface d'exécution MCP.
 *
 * AUCUNE modification du dépôt ni du backend.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

function findRepoRoot(): string {
  let dir = TEST_DIR;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, 'apps', 'studio', 'mcp-admin.js'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Racine du dépôt introuvable (apps/studio/mcp-admin.js) depuis ' + TEST_DIR);
}

const REPO_ROOT = findRepoRoot();
const SOURCE_PATH = join(REPO_ROOT, 'apps', 'studio', 'mcp-admin.js');
const SOURCE = readFileSync(SOURCE_PATH, 'utf8');

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}
const JWT_OWNER = makeJwt({ sub: 'adm_test', tenantId: 'studio-local', role: 'OWNER', email: 'adm@test.local' });
const JWT_ENGINEER = makeJwt({ sub: 'eng_test', tenantId: 'studio-local', role: 'ENGINEER', email: 'eng@test.local' });

/* ---------------------------------------------------------------------------
 * Harnais (clone de mcp-user-hub-studio : faux DOM, innerHTML interdit)
 * ------------------------------------------------------------------------- */
interface Route {
  path: string;
  method?: string;
  status: number;
  body?: unknown;
  raw?: string;
  reject?: boolean;
}
interface FetchLogEntry {
  path: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

class FakeElement {
  readonly tagName: string;
  id = '';
  className = '';
  textContent = '';
  value = '';
  disabled = false;
  readonly children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  private readonly listeners: Map<string, Array<() => void>> = new Map();
  readonly attributes: Map<string, string> = new Map();

  constructor(tag: string, private readonly harness: Harness) {
    this.tagName = tag.toUpperCase();
    const self = this;
    Object.defineProperty(self, 'innerHTML', {
      configurable: false,
      enumerable: false,
      get: function (): string { return ''; },
      set: function (value: string): void {
        self.harness.innerHTMLAttempts.push(String(value));
        throw new Error('Faux DOM : innerHTML interdit (LOT UI-MCP)');
      }
    });
  }
  appendChild(child: FakeElement): FakeElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child: FakeElement): void {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentNode = null;
    }
  }
  get firstChild(): FakeElement | null {
    return this.children.length > 0 ? this.children[0]! : null;
  }
  addEventListener(type: string, listener: () => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  fire(type: string): void {
    const list = this.listeners.get(type);
    if (!list) return;
    for (const fn of list.slice()) fn();
  }
  click(): void { this.fire('click'); }
  setAttribute(key: string, value: string): void { this.attributes.set(key, value); }
  getAttribute(key: string): string | null {
    return this.attributes.has(key) ? this.attributes.get(key)! : null;
  }
}

interface Harness {
  document: {
    createElement(tag: string): FakeElement;
    getElementById(id: string): FakeElement | null;
    body: FakeElement;
    addEventListener(type: string, listener: () => void): void;
    readyState: string;
  };
  window: {
    confirm(): boolean;
    addEventListener(type: string, listener: () => void): void;
    syncMcpAdminMenu?: () => void;
    __mcpAdminInternals?: Record<string, unknown>;
    __mcpAdminUi?: Record<string, unknown>;
  };
  log: FetchLogEntry[];
  innerHTMLAttempts: string[];
  storage: Map<string, string>;
  pump(): Promise<void>;
  findText(needle: string): FakeElement | null;
  textOf(node: FakeElement | null): string;
  allText(): string;
  findByAttr(key: string, value: string): FakeElement | null;
  findAllByAttr(key: string, value?: string): FakeElement[];
  findByTextIn(root: FakeElement, needle: string): FakeElement | null;
  countFetch(pathSuffix: string, method?: string): number;
  makeMenu(): FakeElement;
}

function makeSandbox(routes: Route[], token: string | null): Harness {
  const harness = Object.create(null) as Harness;
  const log: FetchLogEntry[] = [];
  const innerHTMLAttempts: string[] = [];
  const storage = new Map<string, string>();
  if (token !== null) storage.set('vibecode_auth_token', token);
  const registry: FakeElement[] = [];
  const windowListeners = new Map<string, Array<() => void>>();

  const isAttached = (node: FakeElement): boolean => {
    let current: FakeElement | null = node;
    while (current !== null) {
      if (current === documentStub.body) return true;
      current = current.parentNode;
    }
    return false;
  };
  const documentStub = {
    createElement: function (tag: string): FakeElement {
      const element = new FakeElement(tag, harness);
      registry.push(element);
      return element;
    },
    getElementById: function (id: string): FakeElement | null {
      for (let i = registry.length - 1; i >= 0; i--) {
        const candidate = registry[i]!;
        if (candidate.id === id && isAttached(candidate)) return candidate;
      }
      return null;
    },
    body: new FakeElement('body', harness),
    addEventListener: function (): void { /* noop */ },
    readyState: 'complete'
  };
  registry.push(documentStub.body);

  const windowStub = {
    confirm: function (): boolean { return true; },
    addEventListener: function (type: string, listener: () => void): void {
      const list = windowListeners.get(type) ?? [];
      list.push(listener);
      windowListeners.set(type, list);
    }
  };

  const fetchStub = (path: unknown, init: unknown): Promise<{ status: number; ok: boolean; text(): Promise<string> }> => {
    const pathText = String(path);
    let method = 'GET';
    let parsedBody: unknown = undefined;
    let headers: Record<string, string> = {};
    if (init && typeof init === 'object') {
      const initRecord = init as { method?: unknown; body?: unknown; headers?: unknown };
      if (typeof initRecord.method === 'string') method = initRecord.method;
      if (initRecord.headers && typeof initRecord.headers === 'object') {
        headers = initRecord.headers as Record<string, string>;
      }
      if (typeof initRecord.body === 'string') {
        try { parsedBody = JSON.parse(initRecord.body); } catch { parsedBody = initRecord.body; }
      }
    }
    log.push({ path: pathText, method, body: parsedBody, headers });
    let matched: Route | null = null;
    for (const route of routes) {
      if (route.path !== pathText) continue;
      if (route.method !== undefined && route.method !== method) continue;
      matched = route;
      break;
    }
    if (matched === null) {
      return Promise.resolve({
        status: 500,
        ok: false,
        text: () => Promise.resolve(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'route stub absente : ' + method + ' ' + pathText, statusCode: 500 } }))
      });
    }
    if (matched.reject === true) return Promise.reject(new Error('réseau cassé (stub)'));
    const payloadText = matched.raw !== undefined
      ? matched.raw
      : (matched.body === undefined ? '' : JSON.stringify(matched.body));
    return Promise.resolve({
      status: matched.status,
      ok: matched.status >= 200 && matched.status < 300,
      text: () => Promise.resolve(payloadText)
    });
  };

  const localStorageStub = {
    getItem: function (key: string): string | null { return storage.has(key) ? storage.get(key)! : null; },
    setItem: function (key: string, value: string): void { storage.set(key, String(value)); },
    removeItem: function (key: string): void { storage.delete(key); }
  };

  const sandbox: Record<string, unknown> = {
    window: windowStub,
    document: documentStub,
    fetch: fetchStub,
    localStorage: localStorageStub,
    atob: function (value: string): string { return Buffer.from(value, 'base64').toString('binary'); },
    confirm: function (): boolean { return true; }
  };
  vm.createContext(sandbox);
  vm.runInNewContext(SOURCE, sandbox, { filename: 'apps/studio/mcp-admin.js' });

  harness.document = documentStub;
  harness.window = windowStub;
  harness.log = log;
  harness.innerHTMLAttempts = innerHTMLAttempts;
  harness.storage = storage;
  harness.pump = async function (): Promise<void> {
    for (let i = 0; i < 8; i++) await new Promise(function (resolve) { setImmediate(resolve); });
  };
  harness.findText = function (needle: string): FakeElement | null {
    const stack: FakeElement[] = [documentStub.body];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.textContent === needle) return node;
      for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!);
    }
    return null;
  };
  harness.textOf = function (node: FakeElement | null): string {
    if (node === null) return '';
    let text = node.textContent;
    for (const child of node.children) text += ' ' + harness.textOf(child);
    return text;
  };
  harness.allText = function (): string { return harness.textOf(documentStub.body); };
  const walk = (node: FakeElement): FakeElement[] => {
    const out: FakeElement[] = [node];
    for (const child of node.children) out.push(...walk(child));
    return out;
  };
  harness.findByAttr = function (key: string, value: string): FakeElement | null {
    for (const node of walk(documentStub.body)) {
      if (node.getAttribute(key) === value) return node;
    }
    return null;
  };
  harness.findAllByAttr = function (key: string, value?: string): FakeElement[] {
    return walk(documentStub.body).filter(function (node) {
      if (node.getAttribute(key) === null) return false;
      return value === undefined || node.getAttribute(key) === value;
    });
  };
  harness.findByTextIn = function (root: FakeElement, needle: string): FakeElement | null {
    const stack: FakeElement[] = [root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.textContent === needle) return node;
      for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!);
    }
    return null;
  };
  harness.countFetch = function (pathSuffix: string, method?: string): number {
    let count = 0;
    for (const entry of log) {
      if (!entry.path.endsWith(pathSuffix)) continue;
      if (method !== undefined && entry.method !== method) continue;
      count++;
    }
    return count;
  };
  // Élément de menu « hors module » (créé après le boot, comme dans le shell).
  harness.makeMenu = function (): FakeElement {
    const item = new FakeElement('button', harness);
    item.id = 'menuNav-mcpadmin';
    item.className = 'w-full text-left px-2.5 py-1.5 rounded-xl text-xs text-slate-300 hidden';
    documentStub.body.appendChild(item);
    registry.push(item);
    return item;
  };
  return harness;
}

/* ---------------------------------------------------------------------------
 * Fixtures (formes réelles des réponses backend)
 * ------------------------------------------------------------------------- */
const STATS_OK: Route = {
  path: '/api/v1/mcp/admin/stats',
  method: 'GET',
  status: 200,
  body: {
    catalog: {
      total: 4,
      byStatus: { BROUILLON: 1, VALIDATION: 1, PUBLIE: 1, DESACTIVE: 1 },
      byCategory: [
        { category: 'productivite', count: 2 },
        { category: 'outils', count: 1 }
      ],
      health: { ok: 1, failed: 1, neverTested: 2 }
    },
    connections: {
      byScope: [
        { scope: 'catalog', total: 3, enabled: 2 },
        { scope: 'personal', total: 5, enabled: 2 },
        { scope: 'tenant', total: 1, enabled: 1 }
      ],
      lastTest: { ok: 4, failed: 2, neverTested: 3 }
    },
    personalImports: { total: 5, enabled: 2 },
    recentOperations: [
      { action: 'MCP_CATALOG_TRANSITIONED', resourceId: 'cat_one', status: 'SUCCESS', userId: 'adm_test', timestamp: '2026-11-07T12:00:00.000Z' },
      { action: 'MCP_CATALOG_TESTED', resourceId: 'cat_two', status: 'SUCCESS', userId: 'adm_test', timestamp: '2026-11-07T11:00:00.000Z' }
    ],
    requestId: 'req_stats'
  }
};

function adminEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.assign({
    catalogId: 'cat_one',
    name: 'Notion MCP',
    description: 'Notes partagées',
    icon: '📚',
    category: 'productivite',
    transport: 'url',
    url: 'https://api-notion.example.org/mcp',
    status: 'PUBLIE',
    visibility: 'public',
    version: 3,
    createdBy: 'adm_test',
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-11-05T09:30:00.000Z',
    lastTest: { status: 'OK', detail: null, at: '2026-11-05T09:31:00.000Z' },
    activationCount: 2
  }, overrides);
}

const LIST_OK: Route = {
  path: '/api/v1/mcp/admin/catalog',
  method: 'GET',
  status: 200,
  body: {
    entries: [
      adminEntry(),
      adminEntry({
        catalogId: 'cat_two', name: 'Jira MCP', category: 'outils', status: 'BROUILLON',
        activationCount: 0, lastTest: null, version: 1
      }),
      adminEntry({
        catalogId: 'cat_three', name: 'Drive MCP', category: 'productivite', status: 'VALIDATION',
        activationCount: 0, lastTest: null, version: 2
      }),
      adminEntry({
        catalogId: 'cat_four', name: 'Teams MCP', category: 'communication', status: 'DESACTIVE',
        activationCount: 1, lastTest: { status: 'FAILED', detail: 'CONNECT_ERROR', at: '2026-11-04T10:00:00.000Z' }
      })
    ],
    byStatus: { BROUILLON: 1, VALIDATION: 1, PUBLIE: 1, DESACTIVE: 1 },
    requestId: 'req_list'
  }
};

const BASE_ROUTES: Route[] = [STATS_OK, LIST_OK];

/* ---------------------------------------------------------------------------
 * Tests
 * ------------------------------------------------------------------------- */

test('MSI-01 — tableau de bord : chiffres RÉELS, agrégats personnels, opérations admin', async () => {
  const h = makeSandbox(BASE_ROUTES, JWT_OWNER);
  assert.ok(h.window.__mcpAdminUi, 'surface __mcpAdminUi exposée');
  await h.pump();

  const text = h.allText();
  // Compteurs catalogue (valeurs exactes du stub backend).
  assert.ok(text.includes('Catalogue — total'));
  assert.ok(h.findText('4'), 'total 4 affiché');
  assert.ok(h.findText('1'), 'compteur statut affiché');
  assert.ok(text.includes('Publiés'));
  assert.ok(text.includes('Désactivés'));
  assert.ok(text.includes('En validation'));
  assert.ok(text.includes('Brouillons'));
  assert.ok(text.includes('Santé : OK'));
  assert.ok(text.includes('Santé : échecs'));
  assert.ok(text.includes('Jamais testés'));

  // Imports personnels : AGRÉGATS uniquement (aucune ligne, aucun secret).
  const aggCard = h.findByAttr('data-card', 'personal-aggregates');
  assert.ok(aggCard, 'carte agrégats personnels');
  const aggText = h.textOf(aggCard);
  assert.ok(aggText.includes('5 imports'), 'total agrégé');
  assert.ok(aggText.includes('2 actifs'), 'actifs agrégés');
  assert.ok(aggText.includes('compteurs agrégés'), 'mention agrégats');
  assert.equal(text.includes('conn_perso'), false, 'aucun identifiant de ligne personnelle');
  assert.equal(text.includes('scope=mine'), false, 'aucun appel de détail personnel depuis l\'admin');

  // État global des connexions + dernières opérations admin.
  const connCard = h.findByAttr('data-card', 'connections');
  assert.ok(connCard, 'carte connexions');
  assert.ok(h.textOf(connCard).includes('catalog : 3 total, 2 actives'));
  assert.ok(text.includes('Changement de statut'), 'opération réelle affichée');
  assert.ok(text.includes('Test de santé'), 'opération réelle affichée');

  // Chargement : deux appels réels, aucun innerHTML.
  assert.equal(h.countFetch('/api/v1/mcp/admin/stats', 'GET'), 1);
  assert.equal(h.countFetch('/api/v1/mcp/admin/catalog', 'GET'), 1);
  assert.equal(h.innerHTMLAttempts.length, 0);
});

test('MSI-02 — catalogue : cartes, recherche et filtres statut/catégorie', async () => {
  const h = makeSandbox(BASE_ROUTES, JWT_OWNER);
  await h.pump();

  assert.equal(h.findAllByAttr('data-catalog-id').length, 4, '4 entrées rendues');
  const text = h.allText();
  assert.ok(text.includes('Publié'));
  assert.ok(text.includes('Brouillon'));
  assert.ok(text.includes('En validation'));
  assert.ok(text.includes('Désactivé'));
  assert.ok(text.includes('v3'), 'version affichée');
  assert.ok(text.includes('2 activation(s)'), 'compteur réel d\'activations');

  // Recherche.
  const search = h.findByAttr('data-role', 'admin-search');
  assert.ok(search, 'champ de recherche admin');
  search!.value = 'jira';
  search!.fire('input');
  await h.pump();
  const ids = h.findAllByAttr('data-catalog-id').map(function (n) { return n.getAttribute('data-catalog-id'); });
  assert.deepEqual(ids, ['cat_two'], 'recherche → Jira seul');

  search!.value = '';
  search!.fire('input');
  await h.pump();

  // Filtre statut.
  const draftPill = h.findByAttr('data-status-filter', 'BROUILLON');
  assert.ok(draftPill, 'pilule statut BROUILLON');
  draftPill!.click();
  await h.pump();
  const draftIds = h.findAllByAttr('data-catalog-id').map(function (n) { return n.getAttribute('data-catalog-id'); });
  assert.deepEqual(draftIds, ['cat_two'], 'filtre BROUILLON');

  // Filtre catégorie combiné.
  const catPill = h.findByAttr('data-category-filter', 'outils');
  assert.ok(catPill, 'pilule catégorie présente');
  catPill!.click();
  await h.pump();
  assert.equal(h.findAllByAttr('data-catalog-id').length, 1);

  // Aucun résultat → état explicite.
  h.findByAttr('data-status-filter', 'PUBLIE')!.click();
  await h.pump();
  // PUBLIE + catégorie outils = 0 (Notion est en productivite).
  assert.ok(h.findByAttr('data-state', 'no-match'), 'état « aucun résultat »');

  h.findByAttr('data-status-filter', '')!.click();
  h.findByAttr('data-category-filter', '')!.click();
  await h.pump();
  assert.equal(h.findAllByAttr('data-catalog-id').length, 4, 'filtres réinitialisés');
  assert.equal(h.innerHTMLAttempts.length, 0);
});

test('MSI-03 — création : payload whitelisté, message BROUILLON forcé, validation locale', async () => {
  const h = makeSandbox([
    STATS_OK,
    LIST_OK,
    {
      path: '/api/v1/mcp/admin/catalog',
      method: 'POST',
      status: 201,
      body: { entry: adminEntry({ catalogId: 'cat_new', name: 'Nouveau MCP', status: 'BROUILLON', version: 1, activationCount: 0 }), requestId: 'req_create' }
    }
  ], JWT_OWNER);
  await h.pump();

  // Ouverture du formulaire.
  h.findText('＋ Nouvelle entrée')!.click();
  await h.pump();
  const createBtn = h.findText('Créer en brouillon');
  assert.ok(createBtn, 'formulaire de création ouvert');
  assert.ok(h.allText().includes('BROUILLON'), 'mention du statut initial forcé');

  // a) Validation locale : champs requis → AUCUN appel réseau.
  createBtn!.click();
  await h.pump();
  assert.equal(h.countFetch('/api/v1/mcp/admin/catalog', 'POST'), 0, 'pas de POST si nom/url vides');
  assert.ok(h.allText().includes('Nom et URL obligatoires'));

  // b) Remplissage → POST payload strictement whitelisté.
  const mount = h.document.getElementById('mcpAdminMount')!;
  const inputs: FakeElement[] = [];
  const stack: FakeElement[] = [mount];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.tagName === 'INPUT') inputs.push(node);
    for (const child of node.children) stack.push(child);
  }
  const nameInput = inputs.find(function (n) { return n.getAttribute('placeholder') === 'Nom du connecteur'; })!;
  const urlInput = inputs.find(function (n) { return n.getAttribute('placeholder') === 'https://api.exemple.org/mcp'; })!;
  const iconInput = inputs.find(function (n) { return n.getAttribute('placeholder') === 'Icône (emoji, ex. 📚)'; })!;
  assert.ok(nameInput && urlInput && iconInput, 'champs de création présents');
  nameInput.value = 'Nouveau MCP';
  urlInput.value = 'https://api-new.example.org/mcp';
  iconInput.value = '🆕';
  h.findText('Créer en brouillon')!.click();
  await h.pump();

  const post = h.log.find(function (e) { return e.method === 'POST' && e.path === '/api/v1/mcp/admin/catalog'; });
  assert.ok(post, 'POST émis');
  const payload = post!.body as Record<string, unknown>;
  assert.deepEqual(Object.keys(payload).sort(), ['category', 'icon', 'name', 'url', 'visibility'].filter(function (k) { return payload[k] !== undefined; }).sort(),
    'aucun champ hors whitelist (pas de status, pas d\'id)');
  assert.equal(payload.status, undefined, 'le statut n\'est JAMAIS envoyé (BROUILLON imposé par le serveur)');
  assert.equal(payload.name, 'Nouveau MCP');
  assert.equal(payload.visibility, 'public');
  assert.ok(h.allText().includes('BROUILLON (statut initial forcé par le serveur)'), 'confirmation du cycle');
  assert.equal(h.innerHTMLAttempts.length, 0);
});

test('MSI-04 — transitions : boutons miroir matrice + arbitrage serveur 409 affiché', async () => {
  const h = makeSandbox([
    STATS_OK,
    LIST_OK,
    {
      path: '/api/v1/mcp/admin/catalog/cat_two/status',
      method: 'POST',
      status: 409,
      body: { error: { code: 'MCP_CATALOG_INVALID_TRANSITION', message: 'transition BROUILLON → DESACTIVE interdite', statusCode: 409 } }
    }
  ], JWT_OWNER);
  await h.pump();

  // Les boutons proposés MIRROR la matrice serveur, par statut.
  const published = h.findAllByAttr('data-catalog-id').find(function (n) { return n.getAttribute('data-catalog-id') === 'cat_one'; })!;
  assert.ok(h.findByTextIn(published, 'Désactiver (dépublier)'), 'PUBLIE → désactivation');
  assert.equal(h.findByTextIn(published, 'Publier'), null, 'PUBLIE ne propose PAS « Publier »');
  const draft = h.findAllByAttr('data-catalog-id').find(function (n) { return n.getAttribute('data-catalog-id') === 'cat_two'; })!;
  assert.ok(h.findByTextIn(draft, 'Envoyer en validation'), 'BROUILLON → validation');
  const validation = h.findAllByAttr('data-catalog-id').find(function (n) { return n.getAttribute('data-catalog-id') === 'cat_three'; })!;
  assert.ok(h.findByTextIn(validation, 'Publier'), 'VALIDATION → publication');
  assert.ok(h.findByTextIn(validation, 'Revenir en brouillon'), 'VALIDATION → retour brouillon');
  const disabled = h.findAllByAttr('data-catalog-id').find(function (n) { return n.getAttribute('data-catalog-id') === 'cat_four'; })!;
  assert.ok(h.findByTextIn(disabled, 'Republier'), 'DESACTIVE → republication');

  // Clic « Envoyer en validation » sur BROUILLON → le serveur refuse (409).
  h.findByTextIn(draft, 'Envoyer en validation')!.click();
  await h.pump();
  const call = h.log.find(function (e) { return e.path === '/api/v1/mcp/admin/catalog/cat_two/status' && e.method === 'POST'; });
  assert.ok(call, 'POST /status émis');
  assert.deepEqual(call!.body, { status: 'VALIDATION' }, 'corps = statut cible');
  const text = h.allText();
  assert.ok(text.includes('Transition refusée par le serveur'), '409 traduit en message lisible');
  assert.ok(text.includes('transition BROUILLON → DESACTIVE interdite'), 'message serveur affiché');
  assert.equal(h.innerHTMLAttempts.length, 0);
});

test('MSI-05 — suppression : contrôle de dépendance serveur (409) affiché', async () => {
  const h = makeSandbox([
    STATS_OK,
    LIST_OK,
    {
      path: '/api/v1/mcp/admin/catalog/cat_one',
      method: 'DELETE',
      status: 409,
      body: { error: { code: 'MCP_CATALOG_DEPENDENCY', message: '2 instances d\'activation existent', statusCode: 409 } }
    },
    {
      path: '/api/v1/mcp/admin/catalog/cat_two',
      method: 'DELETE',
      status: 200,
      body: { removed: true, requestId: 'req_del' }
    }
  ], JWT_OWNER);
  await h.pump();

  // a) Dépendance : la suppression est REFUSÉE par le serveur et le message lu.
  const published = h.findAllByAttr('data-catalog-id').find(function (n) { return n.getAttribute('data-catalog-id') === 'cat_one'; })!;
  h.findByTextIn(published, 'Supprimer')!.click();
  await h.pump();
  const del1 = h.log.find(function (e) { return e.path === '/api/v1/mcp/admin/catalog/cat_one' && e.method === 'DELETE'; });
  assert.ok(del1, 'DELETE tenté (le serveur arbitre)');
  const text1 = h.allText();
  assert.ok(text1.includes('Suppression bloquée'), '409 dépendance traduit');
  assert.ok(text1.includes('2 instances d\'activation existent'), 'raison serveur affichée');
  // L'entrée est toujours là (rechargement du catalogue).
  assert.ok(h.findAllByAttr('data-catalog-id').some(function (n) { return n.getAttribute('data-catalog-id') === 'cat_one'; }));

  // b) Sans dépendance → 200 et rechargement.
  const draft = h.findAllByAttr('data-catalog-id').find(function (n) { return n.getAttribute('data-catalog-id') === 'cat_two'; })!;
  h.findByTextIn(draft, 'Supprimer')!.click();
  await h.pump();
  const del2 = h.log.filter(function (e) { return e.path === '/api/v1/mcp/admin/catalog/cat_two' && e.method === 'DELETE'; });
  assert.equal(del2.length, 1, 'DELETE unique');
  assert.ok(h.allText().includes('Entrée supprimée du catalogue'));
  assert.equal(h.innerHTMLAttempts.length, 0);
});

test('MSI-06 — test de santé : succès et échec 200 {ok:false} affichés sans fake', async () => {
  const h = makeSandbox([
    STATS_OK,
    LIST_OK,
    {
      path: '/api/v1/mcp/admin/catalog/cat_two/test',
      method: 'POST',
      status: 200,
      body: { ok: false, error: { code: 'MCP_REMOTE_UNREACHABLE', message: 'cible injoignable (politique réseau)' }, requestId: 'req_test' }
    },
    {
      path: '/api/v1/mcp/admin/catalog/cat_one/test',
      method: 'POST',
      status: 200,
      body: { ok: true, protocolVersion: '2024-11-05', serverName: 'notion', serverVersion: '2.0.0', requestId: 'req_test2' }
    }
  ], JWT_OWNER);
  await h.pump();

  // a) Échec (200 {ok:false}) → message d'échec, PAS de faux succès.
  const draft = h.findAllByAttr('data-catalog-id').find(function (n) { return n.getAttribute('data-catalog-id') === 'cat_two'; })!;
  h.findByTextIn(draft, 'Tester la connexion')!.click();
  await h.pump();
  assert.equal(h.countFetch('/catalog/cat_two/test', 'POST'), 1);
  const textFail = h.allText();
  assert.ok(textFail.includes('Test en échec'), 'échec affiché');
  assert.ok(textFail.includes('MCP_REMOTE_UNREACHABLE'), 'code API normalisé affiché');
  assert.equal(textFail.includes('Test réussi'), false, 'aucun faux succès');

  // b) Succès → confirmation + serveur nommé.
  const published = h.findAllByAttr('data-catalog-id').find(function (n) { return n.getAttribute('data-catalog-id') === 'cat_one'; })!;
  h.findByTextIn(published, 'Tester la connexion')!.click();
  await h.pump();
  const textOk = h.allText();
  assert.ok(textOk.includes('Test réussi pour cette entrée'));
  assert.ok(textOk.includes('Test récent : succès'));
  assert.ok(textOk.includes('notion 2.0.0'));
  assert.equal(h.innerHTMLAttempts.length, 0);
});

test('MSI-07 — historique administratif : chargement, contenu audit, état vide', async () => {
  const h = makeSandbox([
    STATS_OK,
    LIST_OK,
    {
      path: '/api/v1/mcp/admin/catalog/cat_one/history',
      method: 'GET',
      status: 200,
      body: {
        history: [
          { id: 'a1', action: 'MCP_CATALOG_TRANSITIONED', status: 'SUCCESS', userId: 'adm_test', metadata: { from: 'VALIDATION', to: 'PUBLIE' }, requestId: 'r1', timestamp: '2026-11-05T09:30:00.000Z' },
          { id: 'a2', action: 'MCP_CATALOG_TESTED', status: 'SUCCESS', userId: 'adm_test', metadata: { ok: true }, requestId: 'r2', timestamp: '2026-11-05T09:31:00.000Z' },
          { id: 'a3', action: 'MCP_CATALOG_CREATED', status: 'SUCCESS', userId: 'adm_test', metadata: { status: 'BROUILLON' }, requestId: 'r3', timestamp: '2026-10-01T08:00:00.000Z' }
        ],
        requestId: 'req_hist'
      }
    },
    {
      path: '/api/v1/mcp/admin/catalog/cat_two/history',
      method: 'GET',
      status: 200,
      body: { history: [], requestId: 'req_hist2' }
    }
  ], JWT_OWNER);
  await h.pump();

  const published = h.findAllByAttr('data-catalog-id').find(function (n) { return n.getAttribute('data-catalog-id') === 'cat_one'; })!;
  h.findByTextIn(published, 'Historique')!.click();
  await h.pump();
  const panel = h.findByAttr('data-history-for', 'cat_one');
  assert.ok(panel, 'panneau historique ouvert');
  const panelText = h.textOf(panel);
  assert.ok(panelText.includes('Changement de statut'), `panneau : ${panelText.slice(0, 300)}`);
  assert.ok(panelText.includes('VALIDATION → PUBLIE'), 'transition lue dans les métadonnées audit');
  assert.ok(panelText.includes('Création'));
  assert.ok(panelText.includes('test réussi'));
  // Seules les opérations ADMIN (aucun événement utilisateur) : le back le
  // garantit ; l'UI n'affiche que ce que ce panneau renvoie.
  assert.equal(h.countFetch('/catalog/cat_one/history', 'GET'), 1);

  // État vide.
  const draft = h.findAllByAttr('data-catalog-id').find(function (n) { return n.getAttribute('data-catalog-id') === 'cat_two'; })!;
  h.findByTextIn(draft, 'Historique')!.click();
  await h.pump();
  assert.ok(h.findByAttr('data-state', 'empty-history'), 'état vide d\'historique');
  assert.equal(h.innerHTMLAttempts.length, 0);
});

test('MSI-08 — refus 403 : panneau d accès requis + menu admin fail-closed par rôle', async () => {
  const FORBIDDEN: Route = {
    path: '/api/v1/mcp/admin/stats',
    method: 'GET',
    status: 403,
    body: { error: { code: 'FORBIDDEN', message: 'MCP_CATALOG_MANAGE requis', statusCode: 403 } }
  };
  const FORBIDDEN_LIST: Route = {
    path: '/api/v1/mcp/admin/catalog',
    method: 'GET',
    status: 403,
    body: { error: { code: 'FORBIDDEN', message: 'MCP_CATALOG_MANAGE requis', statusCode: 403 } }
  };

  // a) ENGINEER : refus serveur + panneau explicite, aucune donnée affichée.
  const hEngineer = makeSandbox([FORBIDDEN, FORBIDDEN_LIST], JWT_ENGINEER);
  await hEngineer.pump();
  const forbidden = hEngineer.findByAttr('data-state', 'forbidden');
  assert.ok(forbidden, 'panneau « accès administrateur requis »');
  assert.ok(hEngineer.allText().includes('MCP_CATALOG_MANAGE'));
  assert.equal(hEngineer.findAllByAttr('data-catalog-id').length, 0, 'aucune entrée affichée');
  const engineerText = hEngineer.allText();
  assert.equal(engineerText.includes('Publiés'), false, 'pas de statistiques sans droits');

  // Menu : absent au boot (aucun élément) → créé après coup → masqué pour ENGINEER.
  const menuEngineer = hEngineer.makeMenu();
  hEngineer.window.syncMcpAdminMenu!();
  assert.ok(/(^|\s)hidden(\s|$)/.test(menuEngineer.className), 'menu masqué pour ENGINEER');

  // b) OWNER : le menu devient visible (cosmétique — le serveur vérifie).
  const hOwner = makeSandbox(BASE_ROUTES, JWT_OWNER);
  await hOwner.pump();
  const menuOwner = hOwner.makeMenu();
  hOwner.window.syncMcpAdminMenu!();
  assert.equal(/(^|\s)hidden(\s|$)/.test(menuOwner.className), false, 'menu visible pour OWNER');
  assert.equal(hOwner.innerHTMLAttempts.length, 0);
});

test('MSI-09 — garde statique : aucun innerHTML, aucun secret, aucune surface d exécution', () => {
  const stripped = SOURCE
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert.equal(/innerHTML\s*=\s*[^=]/.test(stripped), false, 'aucune assignation innerHTML');
  assert.equal(stripped.includes('insertAdjacentHTML'), false);
  assert.equal(/\beval\s*\(/.test(stripped), false);
  for (const forbidden of ['/prepare', '/call', '/tools/', 'revealConnectorSecret', 'secretKeyId']) {
    assert.equal(stripped.includes(forbidden), false, `le module ne reference pas ${forbidden}`);
  }
  // Le module n'écrit JAMAIS un champ secret (lecture impossible → ignorée).
  assert.equal(/secret\s*:/.test(stripped), false, 'aucun envoi de champ secret depuis l admin');
  assert.equal(/scope\s*=\s*'personal'/.test(stripped), false, 'l admin ne crée pas d import personnel');
});

test('MSI-10 — responsive + onShow (navigation) + aucune duplication de surface', async () => {
  const h = makeSandbox(BASE_ROUTES, JWT_OWNER);
  await h.pump();
  const dashboard = h.findByAttr('data-role', 'admin-dashboard');
  assert.ok(dashboard, 'zone tableau de bord');
  // Grille responsive des cartes de stats.
  const stack: FakeElement[] = [dashboard!];
  let found = false;
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.className.includes('grid-cols-2') && node.className.includes('md:grid-cols-4')) { found = true; break; }
    for (const child of node.children) stack.push(child);
  }
  assert.ok(found, 'grille de stats responsive 2/4 colonnes');

  // Navigation : onShow recharge les données à chaque ouverture de la vue.
  const before = h.countFetch('/api/v1/mcp/admin/stats', 'GET');
  (h.window.__mcpAdminUi as { onShow: () => void }).onShow();
  await h.pump();
  assert.equal(h.countFetch('/api/v1/mcp/admin/stats', 'GET'), before + 1, 'onShow → rechargement réel');

  // Aucune surface parallèle : les montages des autres modules ne sont pas créés.
  assert.equal(h.document.getElementById('mcpUserHubMount'), null);
  assert.equal(h.document.getElementById('mcpHubMount'), null);
  assert.equal(h.innerHTMLAttempts.length, 0);
});
