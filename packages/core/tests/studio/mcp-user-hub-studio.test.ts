/**
 * LOT UI-MCP — Tests Studio « Connecteurs » (page UTILISATEUR / MCP Hub).
 *
 * Principe (héritage B4) : exécuter le VRAI fichier `apps/studio/mcp-user-hub.js`
 * dans un sandbox `vm` avec un faux DOM minimal dont `innerHTML` est interdit
 * (levée immédiate + trace), le fetch stubbé par routes exactes (contrats
 * HTTP réels du routeur mcp-catalog.ts + mcp-remote.ts), une session JWT
 * fabriquée en mémoire (jamais de secret réel) et des micro-tâches pompées.
 *
 * Couverture (mission §7 « Tests UI » — page utilisateur) :
 *   - montage + rendu du catalogue (chargement, cartes, catégories) ;
 *   - recherche et filtres Tous / Activés / catégorie ;
 *   - activation / désactivation RÉELLES (appels HTTP exacts, réconciliation
 *     avec l'état renvoyé par le serveur, aucun toggle purement local) ;
 *   - erreurs API (401/403/409/réseau) affichées sans fake de succès ;
 *   - états vides et refus réseau ;
 *   - imports personnels : liste, ajout, test, modification, suppression ;
 *     le secret saisi n'apparaît JAMAIS dans le DOM ;
 *   - responsive (grille mobile/desktop), absence de duplication de surface,
 *     aucun bouton sans action réelle (chaque bouton appelle le backend) ;
 *   - aucun appel d'exécution MCP (prepare/call) — le flux gouverné reste
 *     sur le hub existant.
 *
 * AUCUNE modification du dépôt ni du backend : le test ne lit que le source
 * Studio et ne compile rien.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/* ---------------------------------------------------------------------------
 * Localisation du fichier Studio (résolution robuste depuis le compilé ESM)
 * ------------------------------------------------------------------------- */
const TEST_DIR = dirname(fileURLToPath(import.meta.url));

function findRepoRoot(): string {
  let dir = TEST_DIR;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, 'apps', 'studio', 'mcp-user-hub.js'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Racine du dépôt introuvable (apps/studio/mcp-user-hub.js) depuis ' + TEST_DIR);
}

const REPO_ROOT = findRepoRoot();
const SOURCE_PATH = join(REPO_ROOT, 'apps', 'studio', 'mcp-user-hub.js');
const SOURCE = readFileSync(SOURCE_PATH, 'utf8');

/* ---------------------------------------------------------------------------
 * Session JWT fabriquée (payload b64url — aucun secret réel impliqué)
 * ------------------------------------------------------------------------- */
function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}
const JWT_OWNER = makeJwt({ sub: 'usr_ui_test', tenantId: 'studio-local', role: 'OWNER', email: 'ui@test.local' });
const JWT_ENGINEER = makeJwt({ sub: 'usr_ui_eng', tenantId: 'studio-local', role: 'ENGINEER', email: 'eng@test.local' });

/* ---------------------------------------------------------------------------
 * Harnais : faux DOM (innerHTML INTERDIT) + fetch stubbé + localStorage
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
  readonly style: Record<string, string> = {};
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
  /** Déclenche les listeners d'un événement ('click' / 'input'). */
  fire(type: string): void {
    const list = this.listeners.get(type);
    if (!list) return;
    for (const fn of list.slice()) fn();
  }
  click(): void { this.fire('click'); }
  setAttribute(key: string, value: string): void {
    this.attributes.set(key, value);
  }
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
    __mcpUserHubInternals?: Record<string, unknown>;
    __mcpUserHub?: Record<string, unknown>;
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
  lastFetch(pathSuffix: string): FetchLogEntry | undefined;
  dispatchWindow(type: string): void;
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
    if (matched.reject === true) {
      return Promise.reject(new Error('réseau cassé (stub)'));
    }
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
  vm.runInNewContext(SOURCE, sandbox, { filename: 'apps/studio/mcp-user-hub.js' });

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
      const has = node.getAttribute(key) !== null;
      if (!has) return false;
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
  harness.lastFetch = function (pathSuffix: string): FetchLogEntry | undefined {
    for (let i = log.length - 1; i >= 0; i--) {
      if (log[i]!.path.endsWith(pathSuffix)) return log[i];
    }
    return undefined;
  };
  harness.dispatchWindow = function (type: string): void {
    const list = windowListeners.get(type);
    if (!list) return;
    for (const fn of list.slice()) fn();
  };
  return harness;
}

/* ---------------------------------------------------------------------------
 * Fixtures backend (formes réelles de mcp-catalog.ts)
 * ------------------------------------------------------------------------- */
function findInputByValue(root: FakeElement, value: string): FakeElement | null {
  const stack: FakeElement[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.tagName === 'INPUT' && node.value === value) return node;
    for (const child of node.children) stack.push(child);
  }
  return null;
}
function entryFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.assign({
    catalogId: 'cat_alpha',
    name: 'Notion MCP',
    description: 'Connexion à votre espace Notes',
    icon: '📚',
    category: 'productivite',
    transport: 'url',
    url: 'https://api-notion.example.org/mcp',
    version: 2,
    updatedAt: '2026-11-01T10:00:00.000Z',
    lastTestStatus: null,
    activated: false,
    instanceConnectorId: null
  }, overrides);
}

const CATALOG_OK: Route = {
  path: '/api/v1/mcp/catalog',
  method: 'GET',
  status: 200,
  body: {
    entries: [
      entryFixture(),
      entryFixture({
        catalogId: 'cat_beta',
        name: 'Slack MCP',
        description: 'Notifications d\'équipe',
        icon: '💬',
        category: 'communication',
        activated: true,
        instanceConnectorId: 'conn_beta',
        lastTestStatus: 'OK'
      }),
      entryFixture({
        catalogId: 'cat_gamma',
        name: 'Drive MCP',
        description: 'Fichiers partagés',
        icon: '🗂️',
        category: 'productivite'
      })
    ],
    categories: [
      { category: 'productivite', count: 2 },
      { category: 'communication', count: 1 }
    ],
    requestId: 'req_ok'
  }
};

const MINE_OK: Route = {
  path: '/api/v1/mcp-remote/connectors?scope=mine',
  method: 'GET',
  status: 200,
  body: {
    connectors: [
      {
        connectorId: 'conn_perso_1',
        name: 'Mon serveur interne',
        url: 'https://perso.example.org/mcp',
        transport: 'url',
        enabled: false,
        scope: 'personal',
        ownerUserId: 'usr_ui_test',
        catalogId: null,
        secretPresent: true,
        createdAt: '2026-11-02T09:00:00.000Z',
        updatedAt: '2026-11-02T09:00:00.000Z'
      }
    ],
    requestId: 'req_mine'
  }
};

/* ---------------------------------------------------------------------------
 * Tests
 * ------------------------------------------------------------------------- */

test('USI-01 — montage, chargement et rendu du catalogue (aucun innerHTML)', async () => {
  const h = makeSandbox([CATALOG_OK, MINE_OK], JWT_OWNER);
  assert.ok(h.window.__mcpUserHub, 'module monté (surface __mcpUserHub)');
  assert.ok(h.window.__mcpUserHubInternals, 'surface d\'introspection pure');

  await h.pump();
  // Trois cartes rendues (data-catalog-id) + catégories avec compteurs.
  assert.equal(h.findAllByAttr('data-catalog-id').length, 3, '3 cartes après chargement');
  assert.ok(h.findText('Tous (3)'), 'compteur du filtre Tous');
  assert.ok(h.findText('Activés (1)'), 'compteur du filtre Activés (état RÉEL du serveur)');
  assert.ok(h.findText('productivite (2)'), 'catégories avec compteurs');
  // Étiquettes obligatoires de la bibliothèque.
  assert.ok(h.allText().includes('Notion MCP'));
  assert.ok(h.allText().includes('Désactivé'));
  assert.ok(h.allText().includes('Activé'));
  // Aucun innerHTML sur tout le parcours de rendu.
  assert.equal(h.innerHTMLAttempts.length, 0, 'AUCUNE attribution innerHTML');
  // Le chargement a bien interrogé les deux surfaces backend.
  assert.equal(h.countFetch('/api/v1/mcp/catalog', 'GET'), 1);
  assert.equal(h.countFetch('/connectors?scope=mine', 'GET'), 1);
});

test('USI-02 — recherche et filtres (Tous / Activés / catégorie)', async () => {
  const h = makeSandbox([CATALOG_OK, MINE_OK], JWT_OWNER);
  await h.pump();

  // Recherche : seules les cartes correspondantes restent.
  const search = h.findByAttr('data-role', 'search');
  assert.ok(search, 'champ de recherche présent');
  search!.value = 'slack';
  search!.fire('input');
  await h.pump();
  assert.equal(h.findAllByAttr('data-catalog-id').length, 1, 'recherche « slack » → 1 carte');
  assert.ok(h.allText().includes('Slack MCP'));
  assert.equal(h.findAllByAttr('data-catalog-id').some(function (n) { return n.getAttribute('data-catalog-id') === 'cat_alpha'; }), false);

  // Recherche sans résultat → état vide explicite.
  search!.value = 'zzz-inexistant';
  search!.fire('input');
  await h.pump();
  assert.ok(h.findByAttr('data-state', 'no-match'), 'état « aucun résultat » affiché');

  // Réinitialisation puis filtre « Activés ».
  search!.value = '';
  search!.fire('input');
  await h.pump();
  const activesPill = h.findByAttr('data-filter', 'actives');
  assert.ok(activesPill, 'pilule « Activés » présente');
  activesPill!.click();
  await h.pump();
  const visibleIds = h.findAllByAttr('data-catalog-id').map(function (n) { return n.getAttribute('data-catalog-id'); });
  assert.deepEqual(visibleIds, ['cat_beta'], 'seule l\'entrée activée reste visible');

  // Filtre catégorie : « communication » ne garde que Slack.
  h.findByAttr('data-filter', 'tous')!.click();
  await h.pump();
  const catPill = h.findByAttr('data-category', 'communication');
  assert.ok(catPill, 'pilule catégorie présente');
  catPill!.click();
  await h.pump();
  const ids = h.findAllByAttr('data-catalog-id').map(function (n) { return n.getAttribute('data-catalog-id'); });
  assert.deepEqual(ids, ['cat_beta'], 'filtre catégorie appliqué');

  // Retour « toutes ».
  h.findByAttr('data-category', '')!.click();
  await h.pump();
  assert.equal(h.findAllByAttr('data-catalog-id').length, 3);
  assert.equal(h.innerHTMLAttempts.length, 0);
});

test('USI-03 — activation RÉELLE (POST exact, réconciliation serveur, idempotence UI)', async () => {
  const h = makeSandbox([
    CATALOG_OK,
    MINE_OK,
    {
      path: '/api/v1/mcp/catalog/cat_alpha/activation',
      method: 'POST',
      status: 200,
      body: {
        activated: true,
        connector: { connectorId: 'conn_alpha', enabled: true, scope: 'catalog', catalogId: 'cat_alpha' },
        requestId: 'req_act'
      }
    }
  ], JWT_OWNER);
  await h.pump();

  const alphaCard = h.findAllByAttr('data-catalog-id').find(function (n) { return n.getAttribute('data-catalog-id') === 'cat_alpha'; })!;
  const activateBtn = h.findByTextIn(alphaCard, 'Activer');
  assert.ok(activateBtn, 'bouton « Activer » sur la carte désactivée');
  activateBtn!.click();
  await h.pump();

  // L'appel HTTP réel a été émis (POST + Bearer de la session).
  const calls = h.log.filter(function (e) { return e.path === '/api/v1/mcp/catalog/cat_alpha/activation'; });
  assert.equal(calls.length, 1, 'un seul POST d\'activation');
  assert.equal(calls[0]!.method, 'POST');
  assert.equal(calls[0]!.headers['Authorization'], 'Bearer ' + JWT_OWNER, 'JWT de session porté');

  // État réconcilié avec la REPONSE serveur (pas d'optimisme local).
  const alphaCard2 = h.findAllByAttr('data-catalog-id').find(function (n) { return n.getAttribute('data-catalog-id') === 'cat_alpha'; })!;
  assert.ok(h.findByTextIn(alphaCard2, 'Désactiver'), 'le bouton bascule en « Désactiver »');
  assert.ok(h.allText().includes('« Notion MCP » est activé sur votre compte.'), 'confirmation serveur');
  // Le compteur « Activés » reflète 2 entrées actives.
  assert.ok(h.findText('Activés (2)'));
  assert.equal(h.innerHTMLAttempts.length, 0);
});

test('USI-04 — désactivation RÉELLE (DELETE exact, réconciliation)', async () => {
  const h = makeSandbox([
    CATALOG_OK,
    MINE_OK,
    {
      path: '/api/v1/mcp/catalog/cat_beta/activation',
      method: 'DELETE',
      status: 200,
      body: {
        deactivated: true,
        connector: { connectorId: 'conn_beta', enabled: false, scope: 'catalog', catalogId: 'cat_beta' },
        requestId: 'req_deact'
      }
    }
  ], JWT_OWNER);
  await h.pump();

  const betaCard = h.findAllByAttr('data-catalog-id').find(function (n) { return n.getAttribute('data-catalog-id') === 'cat_beta'; })!;
  const offBtn = h.findByTextIn(betaCard, 'Désactiver');
  assert.ok(offBtn, 'bouton « Désactiver » sur la carte activée');
  offBtn!.click();
  await h.pump();

  const calls = h.log.filter(function (e) { return e.path === '/api/v1/mcp/catalog/cat_beta/activation'; });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, 'DELETE');
  const betaCard2 = h.findAllByAttr('data-catalog-id').find(function (n) { return n.getAttribute('data-catalog-id') === 'cat_beta'; })!;
  assert.ok(h.findByTextIn(betaCard2, 'Activer'), 'retour à « Activer » après réponse serveur');
  assert.ok(h.findText('Activés (0)'), 'compteur réel : plus aucune entrée active');
});

test('USI-05 — refus serveur 403 : message affiché, AUCUN état optimiste', async () => {
  const h = makeSandbox([
    CATALOG_OK,
    MINE_OK,
    {
      path: '/api/v1/mcp/catalog/cat_alpha/activation',
      method: 'POST',
      status: 403,
      body: { error: { code: 'FORBIDDEN', message: 'Permission MCP_REMOTE_INVOKE manquante', statusCode: 403 } }
    }
  ], JWT_ENGINEER);
  await h.pump();

  const alphaCard = h.findAllByAttr('data-catalog-id').find(function (n) { return n.getAttribute('data-catalog-id') === 'cat_alpha'; })!;
  const activateBtn = h.findByTextIn(alphaCard, 'Activer');
  assert.ok(activateBtn, 'bouton affiché (le serveur arbitre, pas l\'interface)');
  activateBtn!.click();
  await h.pump();

  const text = h.allText();
  assert.ok(text.includes('Droits insuffisants'), 'refus 403 explicite');
  assert.ok(text.includes('FORBIDDEN'), 'code serveur affiché');
  const alphaCard2 = h.findAllByAttr('data-catalog-id').find(function (n) { return n.getAttribute('data-catalog-id') === 'cat_alpha'; })!;
  assert.ok(h.findByTextIn(alphaCard2, 'Activer'), 'la carte n\'a PAS basculé en activée');
  assert.ok(h.findText('Activés (1)'), 'compteur inchangé (1 = Slack seul)');
  assert.equal(h.innerHTMLAttempts.length, 0);
});

test('USI-06 — états vides, erreurs réseau et session absente', async () => {
  // a) Catalogue vide.
  const hEmpty = makeSandbox([
    { path: '/api/v1/mcp/catalog', method: 'GET', status: 200, body: { entries: [], categories: [] } },
    { path: '/api/v1/mcp-remote/connectors?scope=mine', method: 'GET', status: 200, body: { connectors: [] } }
  ], JWT_OWNER);
  await hEmpty.pump();
  assert.ok(hEmpty.findByAttr('data-state', 'empty'), 'état vide du catalogue');
  assert.ok(hEmpty.allText().includes('Aucun connecteur publié'));

  // b) Réseau cassé → bandeau d'erreur + bouton Réessayer (action réelle).
  const hDown = makeSandbox([
    { path: '/api/v1/mcp/catalog', method: 'GET', status: 0, reject: true },
    MINE_OK
  ], JWT_OWNER);
  await hDown.pump();
  assert.ok(hDown.findByAttr('data-state', 'error'), 'bandeau d\'erreur réseau');
  assert.ok(hDown.allText().includes('Serveur injoignable'));
  const retry = hDown.findText('Réessayer');
  assert.ok(retry, 'bouton Réessayer présent');
  const before = hDown.countFetch('/api/v1/mcp/catalog', 'GET');
  retry!.click();
  await hDown.pump();
  assert.equal(hDown.countFetch('/api/v1/mcp/catalog', 'GET'), before + 1, 'Réessayer relance un VRAI appel');

  // c) 401 sur la liste personnelle (pas de session fiable).
  const h401 = makeSandbox([
    CATALOG_OK,
    { path: '/api/v1/mcp-remote/connectors?scope=mine', method: 'GET', status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'JWT requis' } } }
  ], null);
  await h401.pump();
  assert.ok(h401.allText().includes('Connectez-vous pour importer'), 'invocation de connexion (état sans session)');
  // Sans jeton : AUCUN en-tête Authorization n'est émis.
  assert.equal(
    h401.log.some(function (e) { return e.headers['Authorization'] !== undefined; }),
    false,
    'jamais d Authorization sans session'
  );
  assert.equal(h401.innerHTMLAttempts.length, 0);
});

test('USI-07 — imports personnels : ajout, test, modification, suppression (secret jamais affiché)', async () => {
  const SECRET_VALUE = 'valeur-secret-qui-ne-doit-jamais-sortir';
  const h = makeSandbox([
    CATALOG_OK,
    MINE_OK,
    {
      path: '/api/v1/mcp-remote/connectors',
      method: 'POST',
      status: 201,
      body: {
        connector: {
          connectorId: 'conn_perso_2', name: 'Nouveau perso', url: 'https://new.example.org/mcp',
          enabled: false, scope: 'personal', secretPresent: true
        },
        requestId: 'req_create'
      }
    },
    {
      path: '/api/v1/mcp-remote/connectors/conn_perso_1/test',
      method: 'POST',
      status: 200,
      body: { ok: true, serverName: 'perso', serverVersion: '1.2.3', requestId: 'req_test' }
    },
    {
      path: '/api/v1/mcp-remote/connectors/conn_perso_1',
      method: 'PATCH',
      status: 200,
      body: { connector: { connectorId: 'conn_perso_1', name: 'Renommé' }, requestId: 'req_patch' }
    },
    {
      path: '/api/v1/mcp-remote/connectors/conn_perso_1',
      method: 'DELETE',
      status: 200,
      body: { removed: true, requestId: 'req_del' }
    }
  ], JWT_OWNER);
  await h.pump();

  // Import existant affiché (privé).
  assert.ok(h.allText().includes('Mon serveur interne'));
  assert.ok(h.allText().includes('Secret configuré'), 'indicateur secret (jamais la valeur)');

  // a) Ajout : saisie du formulaire + envoi scope=personal.
  const formButtons = h.findText('Importer ce serveur');
  assert.ok(formButtons, 'bouton d\'import présent');
  // On remplit les champs du formulaire (3 champs dans refs.personalForm).
  const mount = h.document.getElementById('mcpUserHubMount')!;
  const inputEls: FakeElement[] = [];
  const stack: FakeElement[] = [mount];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.tagName === 'INPUT') inputEls.push(node);
    for (const child of node.children) stack.push(child);
  }
  assert.equal(inputEls.length, 4, '3 champs formulaire + 1 recherche');
  const nameInput = inputEls.find(function (n) { return n.getAttribute('placeholder') === 'Nom (ex. Mon serveur interne)'; })!;
  const urlInput = inputEls.find(function (n) { return n.getAttribute('placeholder') === 'https://exemple.org/mcp'; })!;
  const secretInput = inputEls.find(function (n) { return n.getAttribute('type') === 'password'; })!;
  assert.ok(nameInput && urlInput && secretInput, 'champs nom/url/secret présents');
  assert.equal(secretInput.getAttribute('type'), 'password', 'secret masqué à la saisie');
  nameInput.value = 'Nouveau perso';
  urlInput.value = 'https://new.example.org/mcp';
  secretInput.value = SECRET_VALUE;
  formButtons!.click();
  await h.pump();

  const createCall = h.log.find(function (e) { return e.path === '/api/v1/mcp-remote/connectors' && e.method === 'POST'; });
  assert.ok(createCall, 'POST /connectors émis');
  assert.equal((createCall!.body as { scope: string }).scope, 'personal', 'portée personnelle forcée');
  assert.equal((createCall!.body as { secret: string }).secret, SECRET_VALUE, 'secret transmis AU SERVEUR uniquement');
  // Le secret n'apparaît JAMAIS dans le DOM.
  assert.equal(h.allText().includes(SECRET_VALUE), false, 'secret jamais rendu dans le DOM');
  assert.equal(h.innerHTMLAttempts.length, 0);

  // b) Test de connexion → toast succès.
  const testBtn = h.findText('Tester');
  assert.ok(testBtn, 'bouton Tester présent');
  testBtn!.click();
  await h.pump();
  assert.equal(h.countFetch('/connectors/conn_perso_1/test', 'POST'), 1);
  assert.ok(h.allText().includes('Connexion réussie (perso 1.2.3)'), 'résultat du test serveur affiché');

  // c) Modification (formulaire inline pré-rempli → on change le nom).
  const editBtn = h.findText('Modifier');
  assert.ok(editBtn, 'bouton Modifier présent');
  editBtn!.click();
  await h.pump();
  const saveBtn = h.findText('Enregistrer');
  assert.ok(saveBtn, 'formulaire d\'édition ouvert');
  const editNameInput = findInputByValue(mount, 'Mon serveur interne');
  assert.ok(editNameInput, 'champ nom pré-rempli depuis l\'entrée');
  editNameInput!.value = 'Renommé';
  saveBtn!.click();
  await h.pump();
  const patchCall = h.log.find(function (e) { return e.path === '/api/v1/mcp-remote/connectors/conn_perso_1' && e.method === 'PATCH'; });
  assert.ok(patchCall, 'PATCH émis');
  assert.equal((patchCall!.body as { name: string }).name, 'Renommé', 'nom pré-rempli depuis l\'entrée');

  // d) Suppression (confirm() → true dans le harnais).
  const delBtn = h.findText('Supprimer');
  assert.ok(delBtn, 'bouton Supprimer présent');
  delBtn!.click();
  await h.pump();
  assert.equal(h.countFetch('/connectors/conn_perso_1', 'DELETE'), 1, 'DELETE émis');
});

test('USI-08 — aucune exécution MCP directe, aucun innerHTML (garde statique + dynamique)', async () => {
  // Garde statique sur le SOURCE du module, commentaires DOCUMENTAIRES retirés
  // (le header explique justement le flux gouverné sans jamais l'appeler).
  const stripped = SOURCE
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert.equal(/innerHTML\s*=\s*[^=]/.test(stripped), false, 'aucune assignation innerHTML dans le code');
  assert.equal(stripped.includes('insertAdjacentHTML'), false);
  assert.equal(/\beval\s*\(/.test(stripped), false, 'aucun eval');
  // Ne touche JAMAIS aux surfaces d'exécution gouvernées (prepare/call/tools).
  for (const forbidden of ['/prepare', '/call', '/tools/', 'revealConnectorSecret']) {
    assert.equal(stripped.includes(forbidden), false, `le module ne reference pas ${forbidden}`);
  }
  // Dynamique : sur un parcours complet, seules les routes de lecture/gestion
  // sont appelées (jamais une route d'exécution).
  const h = makeSandbox([
    CATALOG_OK,
    MINE_OK,
    {
      path: '/api/v1/mcp/catalog/cat_alpha/activation',
      method: 'POST',
      status: 200,
      body: { activated: true, connector: { connectorId: 'c', enabled: true, scope: 'catalog' } }
    }
  ], JWT_OWNER);
  await h.pump();
  h.findByTextIn(
    h.findAllByAttr('data-catalog-id').find(function (n) { return n.getAttribute('data-catalog-id') === 'cat_alpha'; })!,
    'Activer'
  )!.click();
  await h.pump();
  for (const call of h.log) {
    assert.equal(call.path.includes('/prepare'), false, 'jamais de prepare');
    assert.equal(call.path.includes('/call'), false, 'jamais de call');
    assert.equal(call.path.includes('/tools/'), false, 'jamais d\'outil listé/invoqué');
  }
  assert.equal(h.innerHTMLAttempts.length, 0);
});

test('USI-09 — déconnexion du shell → session mémoire purgée, rechargement sans jeton', async () => {
  const h = makeSandbox([CATALOG_OK, MINE_OK], JWT_OWNER);
  await h.pump();
  assert.ok(h.log.some(function (e) { return e.headers['Authorization'] === 'Bearer ' + JWT_OWNER; }), 'jeton porté avant logout');

  h.dispatchWindow('vibecode:auth-logout');
  await h.pump();

  // Après logout : la bibliothèque reste (publique), mais la session part.
  const lastCatalogCall = h.lastFetch('/api/v1/mcp/catalog');
  assert.ok(lastCatalogCall, 'rechargement après déconnexion');
  assert.equal(lastCatalogCall!.headers['Authorization'], undefined, 'plus de Bearer après logout');
  assert.equal(h.storage.has('vibecode_auth_token'), false, 'jeton purgé du storage');
  assert.ok(h.allText().includes('Connectez-vous pour importer'), 'section imports redevient « session requise »');
  assert.equal(h.innerHTMLAttempts.length, 0);
});

test('USI-10 — responsive : grille mobile puis desktop (classes Tailwind existantes)', async () => {
  const h = makeSandbox([CATALOG_OK, MINE_OK], JWT_OWNER);
  await h.pump();
  const grid = h.findByAttr('data-role', 'catalog-grid');
  assert.ok(grid, 'zone de grille présente');
  // Le conteneur de cartes porte bien la grille responsive 1 / 2 / 3 colonnes.
  const stack: FakeElement[] = [grid!];
  let found = false;
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.className.includes('grid-cols-1') && node.className.includes('sm:grid-cols-2') && node.className.includes('xl:grid-cols-3')) {
      found = true;
      break;
    }
    for (const child of node.children) stack.push(child);
  }
  assert.ok(found, 'grille responsive 1/2/3 colonnes présente');
  // Le module ne crée AUCUN second conteneur de hub (pas de surface parallèle).
  assert.equal(h.document.getElementById('mcpHubMount'), null, 'le hub existant n\'est pas touché');
  assert.equal(h.document.getElementById('mcpRemoteMount'), null);
});
