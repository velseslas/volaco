/**
 * MCP-C3.5 — Tests Studio « Serveurs MCP » (page Paramètres → Serveurs MCP).
 *
 * Principe (hérité du harnais B4) : exécuter le VRAI fichier
 * `apps/studio/mcp-hub.js` dans un sandbox `vm` avec un faux DOM minimal dont
 * `innerHTML` est interdit (levée immédiate + trace), les attributions
 * `src/href` tracées, le fetch stubbé par routes exactes (contrats réels
 * C3.2/C3.4) et l'horloge d'interval contrôlée.
 *
 * Couverture : liste/états de connexion, création guidée (validation URL),
 * modification (avis de révocation + compteurs réels), suppression
 * destructive (confirm ou annulation), découverte SANS auto-approbation NI
 * auto-exécution, autorisation/révocation, schéma refusé, flux complet
 * préparation→confirmation→exécution avec binding strict des arguments,
 * refus distincts (expiration / transport / isError métier), rôles
 * (ADMIN exécute en manuel, ENGINEER lecture seule), journal (refus C3.4),
 * sécurité DOM, absence de toute référence catalogue fictive, helpers purs.
 *
 * AUCUNE modification du dépôt ni du backend : le test ne lit que le fichier
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
  for (var i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'apps', 'studio', 'mcp-hub.js'))) return dir;
    var parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Racine du dépôt introuvable (apps/studio/mcp-hub.js) depuis ' + TEST_DIR);
}

const REPO_ROOT = findRepoRoot();
const HUB_SOURCE_PATH = join(REPO_ROOT, 'apps', 'studio', 'mcp-hub.js');
const HUB_SOURCE = readFileSync(HUB_SOURCE_PATH, 'utf8');

/* ---------------------------------------------------------------------------
 * Types du harnais
 * ------------------------------------------------------------------------- */
interface Route {
  path: string;
  method?: string;
  status: number;
  body?: unknown;
}
interface FetchLogEntry {
  path: string;
  method: string;
  body: unknown;
}

/** Élément DOM minimal — innerHTML INTERDIT, attributions tracées. */
class FakeElement {
  readonly tagName: string;
  id = '';
  className = '';
  textContent = '';
  value = '';
  placeholder = '';
  title = '';
  type = '';
  autocomplete = '';
  spellcheck = false;
  disabled = false;
  readonly style: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  private readonly listeners: Map<string, Array<() => void>> = new Map();
  readonly attributes: Map<string, string> = new Map();

  constructor(tag: string, private readonly harness: SandboxedHub) {
    this.tagName = tag.toUpperCase();
    const self = this;
    Object.defineProperty(self, 'innerHTML', {
      configurable: false,
      enumerable: false,
      get: function (): string { return ''; },
      set: function (value: string): void {
        harness.innerHTMLAttempts.push(String(value));
        throw new Error('Faux DOM : innerHTML interdit (contenu distant non fiable, C3.5-§3)');
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
  remove(): void {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
  get firstChild(): FakeElement | null {
    return this.children.length > 0 ? this.children[0]! : null;
  }
  addEventListener(type: string, listener: () => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  click(): void {
    const list = this.listeners.get('click');
    if (!list) return;
    for (const fn of list.slice()) fn();
  }
  setAttribute(key: string, value: string): void {
    this.attributes.set(key, value);
    if (key === 'src' || key === 'href') this.harness.resourceAttributes.push({ key, value });
  }
  focus(): void {
    /* noop */
  }
}

/** Sandbox complet exécutant le vrai module Studio. */
interface SandboxedHub {
  document: {
    createElement(tag: string): FakeElement;
    getElementById(id: string): FakeElement | null;
    body: FakeElement;
    addEventListener(type: string, listener: () => void): void;
    readyState: string;
  };
  window: {
    confirm(): boolean;
    setInterval(fn: () => void, ms: number): number;
    clearInterval(id: number): void;
  };
  log: Array<FetchLogEntry>;
  routes: Route[];
  intervalFns: Array<(() => void) | null>;
  innerHTMLAttempts: string[];
  resourceAttributes: Array<{ key: string; value: string }>;
  confirmCalls: number[];
  tickIntervals(): void;
  pump(): Promise<void>;
  findText(needle: string): FakeElement | null;
  textOf(node: FakeElement | null): string;
  countFetch(pathSuffix: string, method?: string): number;
  getElementByIdSafe(id: string): FakeElement;
}

function makeSandbox(routes: Route[]): SandboxedHub {
  const harness: SandboxedHub = Object.create(null) as SandboxedHub;
  const log: Array<FetchLogEntry> = [];
  const intervalFns: Array<(() => void) | null> = [];
  const innerHTMLAttempts: string[] = [];
  const resourceAttributes: Array<{ key: string; value: string }> = [];
  const confirmCalls: number[] = [];
  const registry: FakeElement[] = [];
  const documentStub = {
    createElement: function (tag: string): FakeElement {
      const element = new FakeElement(tag, harness);
      registry.push(element);
      return element;
    },
    createTextNode: function (text: string): FakeElement {
      const element = new FakeElement('#text', harness);
      element.textContent = String(text);
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
    addEventListener: function () { /* noop */ },
    readyState: 'complete'
  };
  const isAttached = function (node: FakeElement): boolean {
    let current: FakeElement | null = node;
    while (current !== null) {
      if (current === documentStub.body) return true;
      current = current.parentNode;
    }
    return false;
  };
  registry.push(documentStub.body);
  const windowStub = {
    confirm: function (): boolean {
      confirmCalls.push(1);
      return true;
    },
    setInterval: function (fn: () => void, ms: number): number { intervalFns.push(fn); return intervalFns.length; },
    clearInterval: function (id: number): void { intervalFns[Number(id) - 1] = null; }
  };

  const fetchStub = (path: unknown, init: unknown): Promise<{ status: number; text(): Promise<string> }> => {
    const pathText = String(path);
    let method = 'GET';
    let parsedBody: unknown = undefined;
    if (init && typeof init === 'object') {
      const initRecord = init as { method?: unknown; body?: unknown };
      if (typeof initRecord.method === 'string') method = initRecord.method;
      if (typeof initRecord.body === 'string') {
        try { parsedBody = JSON.parse(initRecord.body); } catch { parsedBody = initRecord.body; }
      }
    }
    log.push({ path: pathText, method, body: parsedBody });
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
        text: () => Promise.resolve(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'route stub absente', statusCode: 500 } }))
      });
    }
    const payloadText = matched.body === undefined ? '' : JSON.stringify(matched.body);
    return Promise.resolve({ status: matched.status, text: () => Promise.resolve(payloadText) });
  };

  const sandbox: Record<string, unknown> = {
    window: windowStub,
    document: documentStub,
    fetch: fetchStub,
    atob: function (input: string): string {
      return Buffer.from(String(input), 'base64').toString('binary');
    }
  };
  vm.createContext(sandbox);
  vm.runInNewContext(HUB_SOURCE, sandbox, { filename: 'apps/studio/mcp-hub.js' });

  harness.document = documentStub;
  harness.window = windowStub;
  harness.log = log;
  harness.routes = routes;
  harness.intervalFns = intervalFns;
  harness.innerHTMLAttempts = innerHTMLAttempts;
  harness.resourceAttributes = resourceAttributes;
  harness.confirmCalls = confirmCalls;
  harness.tickIntervals = function (): void {
    for (const fn of intervalFns.slice()) if (fn) fn();
  };
  harness.pump = async function (): Promise<void> {
    for (let i = 0; i < 6; i++) await new Promise(function (resolve) { setImmediate(resolve); });
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
  harness.countFetch = function (pathSuffix: string, method?: string): number {
    let count = 0;
    for (const entry of log) {
      if (!entry.path.endsWith(pathSuffix)) continue;
      if (method !== undefined && entry.method !== method) continue;
      count++;
    }
    return count;
  };
  harness.getElementByIdSafe = function (id: string): FakeElement {
    const node = documentStub.getElementById(id);
    if (node === null) throw new Error('élément attendu absent : #' + id);
    return node;
  };
  return harness;
}

/* ---------------------------------------------------------------------------
 * Fixtures (formes EXACTES des contrats serveur — mcp-remote.ts)
 * ------------------------------------------------------------------------- */
const SERVERS_PATH = '/api/v1/mcp/remote-servers';
const TEST_PATH = '/api/v1/mcp-remote/connectors/c1/test';
const TOOLS_PATH = '/api/v1/mcp-remote/connectors/c1/tools';
const APPROVE_PATH = '/api/v1/mcp-remote/connectors/c1/tools/echo_x/approve';
const REVOKE_PATH = '/api/v1/mcp-remote/connectors/c1/tools/echo_x/revoke';
const PREPARE_PATH = '/api/v1/mcp-remote/connectors/c1/tools/echo_x/prepare';
const CALL_PATH = '/api/v1/mcp-remote/connectors/c1/tools/echo_x/call';
const JOURNAL_PATH = '/api/v1/mcp-remote/journal?limit=50';

const SHA_OK = 'a'.repeat(64);
const SHA_ARGS = 'b'.repeat(64);

type Dict = Record<string, unknown>;

function serverFixture(enabled: boolean, lastTest: Dict | null): Dict {
  return {
    connectorId: 'c1',
    name: 'Serveur Exemple',
    url: 'https://mcp.exemple.ex/shared/stream',
    transport: 'url',
    enabled,
    secretPresent: true,
    lastTest,
    createdAt: '2026-10-27T09:00:00.000Z',
    updatedAt: '2026-10-27T09:00:00.000Z'
  };
}

function toolFixture(approval: Dict | null, schemaStatus: string, name?: string): Dict {
  return {
    toolName: name || 'echo_x',
    title: 'Écho (titre)',
    description: 'renvoie le texte reçu (description)',
    inputSchema: schemaStatus === 'OK' ? { type: 'object', properties: { q: { type: 'string' } } } : null,
    schemaSha256: schemaStatus === 'OK' ? SHA_OK : null,
    schemaStatus,
    approval
  };
}

function toolsPayload(tools: Dict[], enabled: boolean, invalid = 0, truncated = 0): Dict {
  return { connector: { connectorId: 'c1', name: 'Serveur Exemple', enabled }, tools, schemaInvalidCount: invalid, displayTruncatedCount: truncated };
}

function loginPayload(role: string): Dict {
  return { token: 'tok_signed_c35', user: { id: 'usr_c35', email: 'own@exemple.fr', name: 'Owner', tenantId: 'ten-c35', role } };
}

function journalPayload(): Dict {
  return {
    events: [
      { id: 'e1', action: 'MCP_REMOTE_TOOL_PREPARED', resourceType: 'MCP_REMOTE', resourceId: 'c1', status: 'SUCCESS', userId: 'usr_c35', requestId: 'req-1', timestamp: '2026-10-27T09:01:11.000Z', metadata: { toolName: 'echo_x' } },
      { id: 'e2', action: 'MCP_REMOTE_TOOL_CALL_REFUSED', resourceType: 'MCP_REMOTE', resourceId: 'c1', status: 'FAILURE', userId: 'usr_c35', requestId: 'req-2', timestamp: '2026-10-27T09:02:11.000Z', metadata: { reason: 'CONFIRMATION_EXPIRED', toolName: 'echo_x' } },
      { id: 'e3', action: 'MCP_REMOTE_CONNECTION_TESTED', resourceType: 'MCP_REMOTE', resourceId: 'c1', status: 'FAILURE', userId: 'usr_c35', requestId: 'req-3', timestamp: '2026-10-27T09:03:11.000Z', metadata: { ok: false, errorCode: 'TLS_FAILURE' } }
    ],
    total: 3
  };
}

function freshConfirmation(expiresAtMs?: number): Dict {
  return {
    confirmation: {
      confirmationId: 'conf-1',
      toolName: 'echo_x',
      schemaSha256: SHA_OK,
      argsSha256: SHA_ARGS,
      expiresAt: expiresAtMs === undefined ? Date.now() + 15 * 60 * 1000 : expiresAtMs
    }
  };
}

/**
 * Routes standard : session OWNER, 1 serveur actif non testé, outils non
 * autorisés. IMPORTANT : les routes avec `method` explicite viennent AVANT
 * les routes GET sans méthode (le stub accepte toute méthode sur une route
 * sans méthode) pour garantir un appariement déterministe.
 */
function baseRoutes(role?: string, servers?: Dict[], tools?: Dict[]): Route[] {
  return [
    { path: '/api/v1/auth/login', method: 'POST', status: 200, body: loginPayload(role || 'OWNER') },
    { path: SERVERS_PATH, method: 'POST', status: 201, body: { server: serverFixture(true, null) } },
    { path: TEST_PATH, method: 'POST', status: 200, body: { ok: true, protocolVersion: '2025-06-18', serverName: 'ExempleMCP', serverVersion: '1.2.3', sessionCaptured: true } },
    { path: TOOLS_PATH, method: 'GET', status: 200, body: toolsPayload(tools || [toolFixture(null, 'OK')], true) },
    { path: APPROVE_PATH, method: 'POST', status: 200, body: { approval: { toolName: 'echo_x', schemaSha256: SHA_OK, status: 'APPROVED', approvedBy: 'usr_c35', approvedAt: '2026-10-27T09:05:00.000Z', updatedAt: '2026-10-27T09:05:00.000Z', drift: false } } },
    { path: REVOKE_PATH, method: 'POST', status: 200, body: { revocation: { toolName: 'echo_x', status: 'REVOKED' } } },
    { path: PREPARE_PATH, method: 'POST', status: 201, body: freshConfirmation() },
    { path: CALL_PATH, method: 'POST', status: 200, body: { result: { isError: false, content: [{ type: 'text', text: 'echo ok' }] } } },
    { path: JOURNAL_PATH, method: 'GET', status: 200, body: journalPayload() },
    { path: SERVERS_PATH, method: 'GET', status: 200, body: { servers: servers || [serverFixture(true, null)], total: servers ? servers.length : 1 } }
  ];
}

function documentSetInput(h: SandboxedHub, id: string, value: string): void {
  h.getElementByIdSafe(id).value = value;
}

function collectButtonsByText(h: SandboxedHub, needle: string): FakeElement[] {
  const found: FakeElement[] = [];
  const stack: FakeElement[] = [h.document.body];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.textContent === needle && node.tagName === 'BUTTON') found.push(node);
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!);
  }
  return found;
}

/** Connexion via la carte de session (form réelle → POST /auth/login). */
async function driveToServers(h: SandboxedHub): Promise<void> {
  h.log.length = 0;
  documentSetInput(h, 'mcpHubLoginEmail', 'own@exemple.fr');
  documentSetInput(h, 'mcpHubLoginPassword', 'mot-de-passe-owner');
  const connectBtns = collectButtonsByText(h, 'Se connecter');
  assert.ok(connectBtns.length >= 1, 'bouton de connexion présent');
  connectBtns[0]!.click();
  await h.pump();
  assert.equal(h.countFetch('/api/v1/auth/login', 'POST'), 1, 'login émis une seule fois');
  assert.ok(h.textOf(h.getElementByIdSafe('mcpHubIdentity')).includes('own@exemple.fr'), 'email affiché');
}

/** Connexion + ouverture de la zone outils pour un connecteur c1. */
async function driveToTools(h: SandboxedHub): Promise<void> {
  await driveToServers(h);
  h.findText('Voir les outils (découverte)')!.click();
  await h.pump();
  assert.equal(h.countFetch(TOOLS_PATH, 'GET'), 1, 'découverte émise une fois');
  assert.ok(h.getElementByIdSafe('mcpHubToolsZone'), 'zone outils ouverte');
}

/* ---------------------------------------------------------------------------
 * C35-01 — Montage : session requise ; après connexion, liste vide lisible
 * ------------------------------------------------------------------------- */
test('C35-01 · montage : session requise ; après connexion, liste vide lisible', async () => {
  const h = makeSandbox(baseRoutes(undefined, [], [toolFixture(null, 'OK')]));
  // Sans jeton : carte de session visible, contenu masqué (états distincts)
  assert.ok(h.textOf(h.document.body).includes('Connecter une session'), 'carte de session visible');
  assert.ok(h.getElementByIdSafe('mcpHubContent').className.includes('hidden'), 'contenu masqué sans session');
  assert.ok(!h.getElementByIdSafe('mcpHubSession').className.includes('hidden'), 'session visible sans jeton');

  // Liste vide après connexion OWNER
  await driveToServers(h);
  assert.ok(!h.getElementByIdSafe('mcpHubContent').className.includes('hidden'), 'contenu visible avec session');
  assert.ok(h.getElementByIdSafe('mcpHubSession').className.includes('hidden'), 'carte session masquée avec jeton');
  assert.ok(h.textOf(h.getElementByIdSafe('mcpHubServers')).includes('Aucun serveur configuré.'), 'état vide affiché');
  assert.equal(h.countFetch('journal?limit=50', 'GET'), 1, 'journal chargé à la session');
  assert.equal(h.getElementByIdSafe('mcpHubAddBtn').disabled, false, 'ajout disponible pour OWNER');
});

/* ---------------------------------------------------------------------------
 * C35-02 — États de connexion distincts (non testée / connectée / échec / désactivé)
 * ------------------------------------------------------------------------- */
test('C35-02 · états de connexion distincts traduits lisiblement', async () => {
  const servers: Dict[] = [
    Object.assign(serverFixture(true, null), { connectorId: 'c_none', name: 'Sans test' }),
    Object.assign(serverFixture(true, { at: '2026-10-27T10:00:00.000Z', status: 'OK', detail: null }), { connectorId: 'c_ok', name: 'Connecté deux' }),
    Object.assign(serverFixture(true, { at: '2026-10-27T10:00:00.000Z', status: 'FAILED', detail: 'TLS_FAILURE' }), { connectorId: 'c_fail', name: 'Cassé' }),
    Object.assign(serverFixture(false, null), { connectorId: 'c_dis', name: 'Arrêté' })
  ];
  const h = makeSandbox([
    { path: '/api/v1/auth/login', method: 'POST', status: 200, body: loginPayload('OWNER') },
    { path: SERVERS_PATH, method: 'GET', status: 200, body: { servers, total: 4 } },
    { path: JOURNAL_PATH, method: 'GET', status: 200, body: { events: [], total: 0 } }
  ]);
  await driveToServers(h);
  const listText = h.textOf(h.getElementByIdSafe('mcpHubServers'));
  assert.ok(listText.includes('Sans test'), 'premier serveur listé');
  assert.ok(listText.includes('CONNEXION NON TESTÉE'), 'état non testée');
  assert.ok(listText.includes('CONNECTÉ'), 'état connecté');
  assert.ok(listText.includes('ÉCHEC — Échec TLS (certificat)'), 'état échec traduit depuis le code');
  assert.ok(listText.includes('DÉSACTIVÉ'), 'état désactivé');
  assert.ok(listText.includes('ACTIF'), 'état actif');
  assert.equal(h.innerHTMLAttempts.length, 0, 'aucun innerHTML');
});

/* ---------------------------------------------------------------------------
 * C35-03 — Connexion en cours (état instantané) puis réussite réelle
 * ------------------------------------------------------------------------- */
test('C35-03 · test de connexion : en cours immédiat → réussite réelle affichée', async () => {
  const h = makeSandbox(baseRoutes());
  await driveToServers(h);
  h.log.length = 0;
  const testBtn = h.findText('Tester la connexion');
  assert.ok(testBtn, 'bouton test présent');
  testBtn!.click();
  assert.ok(h.textOf(h.getElementByIdSafe('mcpHubServers')).includes('CONNEXION EN COURS'), 'état en cours immédiat');
  assert.equal(h.countFetch(TEST_PATH, 'POST'), 1, 'requête émise une fois');
  await h.pump();
  const after = h.textOf(h.getElementByIdSafe('mcpHubServers'));
  assert.ok(after.includes('CONNECTÉ · ExempleMCP'), 'état connecté avec nom du distant');
  assert.ok(h.textOf(h.document.body).includes('protocole 2025-06-18'), 'détail du handshake affiché');
  assert.equal(h.countFetch(SERVERS_PATH, 'GET'), 1, 'liste resynchronisée (lastTest persistant) une fois');
});

/* ---------------------------------------------------------------------------
 * C35-04 — Création guidée : URL privée refusée côté client ; POST réel 201
 * ------------------------------------------------------------------------- */
test('C35-04 · création guidée : URL locale refusée côté client, puis POST réel 201', async () => {
  const h = makeSandbox(baseRoutes());
  await driveToServers(h);
  h.log.length = 0;
  h.getElementByIdSafe('mcpHubAddBtn').click();
  await h.pump();
  documentSetInput(h, 'mcpHubFormName', 'Automatisation marketing');
  documentSetInput(h, 'mcpHubFormUrl', 'http://localhost:9999/mcp');
  documentSetInput(h, 'mcpHubFormSecret', 'CLE-NEUVE-2026');
  h.getElementByIdSafe('mcpHubFormSubmit').click();
  await h.pump();
  assert.equal(h.countFetch(SERVERS_PATH, 'POST'), 0, 'AUCUN POST sur URL locale (validation UX)');
  assert.ok(h.textOf(h.getElementByIdSafe('mcpHubForm')).includes('Cible interdite : hôte local.'), 'message URL privée affiché');

  documentSetInput(h, 'mcpHubFormUrl', 'https://mcp.nouveau.ex/flux');
  h.getElementByIdSafe('mcpHubFormSubmit').click();
  await h.pump();
  const posts = h.log.filter(function (entry) { return entry.method === 'POST' && entry.path === SERVERS_PATH; });
  assert.equal(posts.length, 1, 'un seul POST de création');
  assert.deepEqual((posts[0]!.body as Dict).name, 'Automatisation marketing', 'nom transmis');
  assert.equal((posts[0]!.body as Dict).transport, 'url', 'transport fixé');
  assert.equal((posts[0]!.body as Dict).secret, 'CLE-NEUVE-2026', 'secret transmis uniquement via le POST');
  assert.ok(h.textOf(h.document.body).includes('Testez la connexion.'), 'propose le test après création');
});

/* ---------------------------------------------------------------------------
 * C35-05 — Modification d'URL : confirmation préalable + compteurs réels
 * ------------------------------------------------------------------------- */
test('C35-05 · modification d\'URL : confirmation préalable, compteurs de révocation affichés', async () => {
  const h = makeSandbox(baseRoutes());
  h.routes.unshift({
    path: SERVERS_PATH + '/c1',
    method: 'PATCH',
    status: 200,
    body: { server: serverFixture(true, null), revokedToolNames: ['echo_x'], invalidatedConfirmations: 2 }
  });
  await driveToServers(h);
  h.log.length = 0;
  h.findText('Modifier')!.click();
  await h.pump();
  documentSetInput(h, 'mcpHubFormUrl', 'https://autre.ex/flux');
  h.getElementByIdSafe('mcpHubFormSubmit').click();
  await h.pump();
  assert.equal(h.confirmCalls.length, 1, 'une demande de confirmation pour le changement d\'URL');
  const pacthes = h.log.filter(function (entry) { return entry.method === 'PATCH'; });
  assert.equal(pacthes.length, 1, 'PATCH émis après confirmation');
  assert.deepEqual((pacthes[0]!.body as Dict).url, 'https://autre.ex/flux', 'nouvelle URL transmise');
  assert.ok(h.textOf(h.document.body).includes('Autorisations révoquées par le backend : 1'), 'compteur de révocation réel affiché');
  assert.ok(h.textOf(h.document.body).includes('Confirmations en attente invalidées : 2'), 'compteur d\'invalidation réel affiché');

  // Annulation : confirm() négatif → AUCUN PATCH
  const h2 = makeSandbox(baseRoutes());
  (h2.window as unknown as { confirm(): boolean }).confirm = function () { h2.confirmCalls.push(1); return false; };
  await driveToServers(h2);
  h2.log.length = 0;
  h2.findText('Modifier')!.click();
  await h2.pump();
  documentSetInput(h2, 'mcpHubFormUrl', 'https://autre.ex/flux');
  h2.getElementByIdSafe('mcpHubFormSubmit').click();
  await h2.pump();
  assert.equal(h2.countFetch(SERVERS_PATH + '/c1', 'PATCH'), 0, 'aucun PATCH après refus');
  assert.ok(h2.textOf(h2.document.body).includes('Modification annulée.'), 'annulation visible');
});

/* ---------------------------------------------------------------------------
 * C35-06 — Suppression destructive : confirmée puis annulée (zéro DELETE)
 * ------------------------------------------------------------------------- */
test('C35-06 · suppression : confirm() requis ; flux confirmé PUIS flux annulé', async () => {
  const h1 = makeSandbox(baseRoutes());
  await driveToServers(h1);
  h1.log.length = 0;
  h1.findText('Supprimer')!.click();
  await h1.pump();
  assert.equal(h1.confirmCalls.length, 1, 'dialogue destructif invoqué');
  assert.equal(h1.countFetch(SERVERS_PATH + '/c1', 'DELETE'), 1, 'DELETE émis une fois');

  const h2 = makeSandbox(baseRoutes());
  (h2.window as unknown as { confirm(): boolean }).confirm = function () { h2.confirmCalls.push(1); return false; };
  await driveToServers(h2);
  h2.log.length = 0;
  h2.findText('Supprimer')!.click();
  await h2.pump();
  assert.equal(h2.countFetch(SERVERS_PATH + '/c1', 'DELETE'), 0, 'aucun DELETE après annulation');
  assert.ok(h2.textOf(h2.document.body).includes('Suppression annulée.'), 'état d\'annulation visible');
});

/* ---------------------------------------------------------------------------
 * C35-07 — Découverte : affichage, AUCUNE auto-approbation, AUCUNE auto-exécution
 * ------------------------------------------------------------------------- */
test('C35-07 · découverte affiche les outils et n\'approuve ni n\'exécute RIEN automatiquement', async () => {
  const h = makeSandbox(baseRoutes());
  await driveToTools(h);
  const zoneText = h.textOf(h.getElementByIdSafe('mcpHubToolsZone'));
  assert.ok(zoneText.includes('echo_x'), 'outil affiché');
  assert.ok(zoneText.includes('renvoie le texte reçu (description)'), 'description distante rendue en texte');
  assert.ok(zoneText.includes('NON AUTORISÉ'), 'badge DENY par défaut visible');
  assert.equal(h.countFetch('/approve', 'POST'), 0, 'AUCUNE auto-approbation');
  assert.equal(h.countFetch('/call', 'POST'), 0, 'AUCUNE auto-exécution');
  assert.equal(h.countFetch(PREPARE_PATH, 'POST'), 0, 'aucun prepare');
  assert.ok(h.findText('Utiliser cet outil') === null, 'aucun bouton d\'exécution tant que non autorisé');
});

/* ---------------------------------------------------------------------------
 * C35-08 — Autorisation puis révocation (résultats réels du serveur)
 * ------------------------------------------------------------------------- */
test('C35-08 · autoriser → POST réel ; état APPROVED → bouton révoquer → POST réel ; badge RÉVOQUÉE', async () => {
  // (a) Approbation sur outil non autorisé : UNE approbation, annonce réelle, aucune exécution
  const h1 = makeSandbox(baseRoutes('OWNER', [serverFixture(true, null)], [toolFixture(null, 'OK')]));
  await driveToTools(h1);
  const approveBtn = h1.findText('Autoriser');
  assert.ok(approveBtn, 'bouton autoriser présent');
  approveBtn!.click();
  await h1.pump();
  assert.equal(h1.countFetch(APPROVE_PATH, 'POST'), 1, 'une approbation émise');
  assert.equal(h1.countFetch('/call', 'POST'), 0, 'aucune exécution suite à l\'approbation');
  assert.ok(h1.textOf(h1.document.body).includes('Autorisation enregistrée'), 'annonce du résultat réel du serveur');

  // (b) État APPROVED : badge AUTORISÉ + dernier état connu + bouton Révoquer
  const approved = { status: 'APPROVED', approvedSchemaSha256: SHA_OK, drift: false, approvedAt: '2026-10-27T09:05:00.000Z' } as Dict;
  const h2 = makeSandbox(baseRoutes('OWNER', [serverFixture(true, null)], [toolFixture(approved, 'OK')]));
  await driveToTools(h2);
  const zone2 = h2.textOf(h2.getElementByIdSafe('mcpHubToolsZone'));
  assert.ok(zone2.includes('AUTORISÉ'), 'badge AUTORISÉ');
  assert.ok(zone2.includes('Dernier état connu — autorisé'), 'dernier état connu visible');
  assert.ok(h2.findText('Révoquer l\'autorisation'), 'bouton révocation disponible');
  h2.log.length = 0;
  h2.findText('Révoquer l\'autorisation')!.click();
  await h2.pump();
  assert.equal(h2.countFetch(REVOKE_PATH, 'POST'), 1, 'révocation émise une fois');
  assert.equal(h2.countFetch('/call', 'POST'), 0, 'aucune exécution suite à la révocation');
  assert.ok(h2.textOf(h2.document.body).includes('Autorisation révoquée'), 'annonce de révocation réelle');

  // (c) État REVOKED (renvoyé par le serveur) : badge AUTORISATION RÉVOQUÉE
  const revoked = { status: 'REVOKED', approvedSchemaSha256: SHA_OK, drift: false } as Dict;
  const h3 = makeSandbox(baseRoutes('OWNER', [serverFixture(true, null)], [toolFixture(revoked, 'OK')]));
  await driveToTools(h3);
  assert.ok(h3.textOf(h3.getElementByIdSafe('mcpHubToolsZone')).includes('AUTORISATION RÉVOQUÉE'), 'badge révocation affiché');
});

/* ---------------------------------------------------------------------------
 * C35-09 — Outils au schéma refusé : jamais autorisables (fail-closed visible)
 * ------------------------------------------------------------------------- */
test('C35-09 · schéma refusé/tronqué : badges visibles et AUCUNE porte d\'exécution', async () => {
  const h = makeSandbox(baseRoutes('OWNER', [serverFixture(true, null)], [
    toolFixture(null, 'INVALID'),
    toolFixture(null, 'DISPLAY_TRUNCATED')
  ]));
  const toolsRoute = h.routes.filter(function (r) { return r.path === TOOLS_PATH && r.method === 'GET'; })[0]!;
  toolsRoute.body = toolsPayload([toolFixture(null, 'INVALID'), toolFixture(null, 'DISPLAY_TRUNCATED')], true, 1, 1);
  await driveToTools(h);
  const zoneText = h.textOf(h.getElementByIdSafe('mcpHubToolsZone'));
  assert.ok(zoneText.includes('SCHÉMA REFUSÉ (SÉCURITÉ)'), 'badge schéma refusé');
  assert.ok(zoneText.includes('TROP GRAND POUR L\'AFFICHAGE'), 'badge trop grand');
  assert.ok(zoneText.includes('1 outil(s) au schéma refusé'), 'compteur affiché');
  assert.ok(h.findText('Utiliser cet outil') === null, 'aucun bouton d\'exécution');
  assert.ok(h.findText('Autoriser') === null, 'autorisation masquée sur schéma refusé');
});

/* ---------------------------------------------------------------------------
 * C35-10 — Exécution confirmée complète : préparation explicite, annulation, succès réel
 * ------------------------------------------------------------------------- */
test('C35-10 · flux complet : préparation explicite, annulation sans appel, exécution unique réelle', async () => {
  const approved = { status: 'APPROVED', approvedSchemaSha256: SHA_OK, drift: false, approvedAt: '2026-10-27T09:05:00.000Z' } as Dict;
  const h = makeSandbox(baseRoutes('OWNER', [serverFixture(true, null)], [toolFixture(approved, 'OK')]));
  await driveToTools(h);

  // Ouverture de la modale : AUCUN POST tant que « Préparer » n'est pas cliqué
  h.findText('Utiliser cet outil')!.click();
  await h.pump();
  const modal = h.getElementByIdSafe('mcpHubConfirmModal');
  assert.ok(modal, 'modale ouverte');
  assert.equal(h.countFetch(PREPARE_PATH, 'POST'), 0, 'aucun POST à l\'ouverture');
  assert.equal(h.getElementByIdSafe('mcpHubConfirmBtn').disabled, true, 'confirmation désarmée');

  // Préparation explicite
  h.getElementByIdSafe('mcpHubPrepareBtn').click();
  await h.pump();
  assert.equal(h.countFetch(PREPARE_PATH, 'POST'), 1, 'un POST /prepare au clic explicite');
  assert.equal(h.countFetch(CALL_PATH, 'POST'), 0, 'aucun call après préparation');

  // Fermeture : aucun appel
  h.getElementByIdSafe('mcpHubCancelBtn').click();
  await h.pump();
  assert.equal(h.countFetch(CALL_PATH, 'POST'), 0, 'fermeture sans exécution');

  // Second flux : préparation puis confirmation expresse
  h.findText('Utiliser cet outil')!.click();
  await h.pump();
  h.getElementByIdSafe('mcpHubPrepareBtn').click();
  await h.pump();
  h.tickIntervals(); // premier tick horizon (args identiques -> armement)
  assert.ok(h.textOf(h.getElementByIdSafe('mcpHubExpirySlot')).includes('valable'), 'compteur TTL affiché');
  const confirmBtn = h.getElementByIdSafe('mcpHubConfirmBtn');
  assert.equal(confirmBtn.disabled, false, 'confirmation armée');
  h.log.length = 0;
  confirmBtn.click();
  await h.pump();
  const calls = h.log.filter(function (entry) { return entry.method === 'POST' && entry.path === CALL_PATH; });
  assert.equal(calls.length, 1, 'UN SEUL appel après confirmation');
  assert.deepEqual(calls[0]!.body, { confirmationId: 'conf-1', arguments: {} }, 'call transporte exactement confirmation+arguments');
  const outcomeText = h.textOf(h.getElementByIdSafe('mcpHubCallOutcome'));
  assert.ok(outcomeText.includes('Exécution réussie'), 'succès annoncé UNIQUEMENT après la réponse réelle');
  assert.ok(outcomeText.includes('echo ok'), 'contenu réel affiché');
});

/* ---------------------------------------------------------------------------
 * C35-11 — Binding strict des arguments : modification => blocage ; identique => déverrouillage
 * ------------------------------------------------------------------------- */
test('C35-11 · args modifiés → blocage ; identiques → déverrouillage + payload exact', async () => {
  const approved = { status: 'APPROVED', approvedSchemaSha256: SHA_OK, drift: false, approvedAt: '2026-10-27T09:05:00.000Z' } as Dict;
  const h = makeSandbox(baseRoutes('OWNER', [serverFixture(true, null)], [toolFixture(approved, 'OK')]));
  await driveToTools(h);
  h.findText('Utiliser cet outil')!.click();
  await h.pump();
  documentSetInput(h, 'mcpHubExecArgs', '{ "q": "texte-init", "fen": 2 }');
  h.getElementByIdSafe('mcpHubPrepareBtn').click();
  await h.pump();
  const prepareCalls = h.log.filter(function (entry) { return entry.path === PREPARE_PATH && entry.method === 'POST'; });
  assert.equal(prepareCalls.length, 1, 'préparation émise');
  assert.deepEqual((prepareCalls[0]!.body as Dict).arguments, { q: 'texte-init', fen: 2 }, 'prepare transporte ces arguments');
  assert.ok(h.textOf(h.getElementByIdSafe('mcpHubArgsEcho')).includes('texte-init'), 'arguments EXACTS affichés');

  // Modification → blocage + bannière
  documentSetInput(h, 'mcpHubExecArgs', '{ "q": "texte-alt", "fen": 2 }');
  h.tickIntervals();
  assert.equal(h.getElementByIdSafe('mcpHubConfirmBtn').disabled, true, 'exécution bloquée');
  assert.ok(h.textOf(h.getElementByIdSafe('mcpHubArgsMismatch')).includes('Paramètres modifiés'), 'bannière args modifiés');

  // Retour identique (ordre des clés inverse = identique canonique) → déverrouillage
  documentSetInput(h, 'mcpHubExecArgs', '{ "fen": 2, "q": "texte-init" }');
  h.tickIntervals();
  assert.equal(h.getElementByIdSafe('mcpHubConfirmBtn').disabled, false, 'déblocage une fois identiques');
  h.getElementByIdSafe('mcpHubConfirmBtn').click();
  await h.pump();
  const calls = h.log.filter(function (entry) { return entry.path === CALL_PATH && entry.method === 'POST'; });
  assert.equal(calls.length, 1, 'un appel uniquement');
  assert.deepEqual(calls[0]!.body, { confirmationId: 'conf-1', arguments: { q: 'texte-init', fen: 2 } }, 'arguments exacts de la préparation');
});

/* ---------------------------------------------------------------------------
 * C35-12 — Refus réels distincts : expiration, délai transport, erreur métier
 * ------------------------------------------------------------------------- */
test('C35-12 · refus distincts : confirmation expirée ; délai métier distant', async () => {
  // (1) Confirmation immédiatement expirée
  const h1 = makeSandbox(baseRoutes('OWNER', [serverFixture(true, null)], [toolFixture({ status: 'APPROVED', approvedSchemaSha256: SHA_OK, drift: false, approvedAt: 'x' }, 'OK')]));
  for (const route of h1.routes) {
    if (route.path === PREPARE_PATH) route.body = freshConfirmation(Date.now() - 1);
  }
  await driveToTools(h1);
  h1.findText('Utiliser cet outil')!.click();
  await h1.pump();
  h1.getElementByIdSafe('mcpHubPrepareBtn').click();
  await h1.pump();
  assert.ok(h1.textOf(h1.getElementByIdSafe('mcpHubExpirySlot')).includes('EXPIRÉE'), 'expiration affichée');
  assert.equal(h1.getElementByIdSafe('mcpHubConfirmBtn').disabled, true, 'exécution refusée pour expiration');
  assert.equal(h1.countFetch('/call', 'POST'), 0, 'aucune exécution sur confirmation expirée');

  // (2) Refus transport 504 (délai)
  const h2 = makeSandbox(baseRoutes('OWNER', [serverFixture(true, null)], [toolFixture({ status: 'APPROVED', approvedSchemaSha256: SHA_OK, drift: false, approvedAt: 'x' }, 'OK')]));
  for (const route of h2.routes) {
    if (route.path === CALL_PATH) { route.status = 504; route.body = { error: { code: 'MCP_REMOTE_TIMEOUT', message: 'Délai', statusCode: 504 } }; }
  }
  await driveToTools(h2);
  h2.findText('Utiliser cet outil')!.click();
  await h2.pump();
  h2.getElementByIdSafe('mcpHubPrepareBtn').click();
  await h2.pump();
  h2.tickIntervals();
  h2.getElementByIdSafe('mcpHubConfirmBtn').click();
  await h2.pump();
  const timeoutText = h2.textOf(h2.getElementByIdSafe('mcpHubCallOutcome'));
  assert.ok(timeoutText.includes('Délai dépassé'), 'étiquette délai distincte');
  assert.ok(!timeoutText.includes('Exécution réussie'), 'aucun faux succès');

  // (3) Erreur métier DISTANT (isError:true) distincte
  const h3 = makeSandbox(baseRoutes('OWNER', [serverFixture(true, null)], [toolFixture({ status: 'APPROVED', approvedSchemaSha256: SHA_OK, drift: false, approvedAt: 'x' }, 'OK')]));
  for (const route of h3.routes) {
    if (route.path === CALL_PATH) { route.body = { result: { isError: true, content: [{ type: 'text', text: 'limite simulée par le distant' }] } }; }
  }
  await driveToTools(h3);
  h3.findText('Utiliser cet outil')!.click();
  await h3.pump();
  h3.getElementByIdSafe('mcpHubPrepareBtn').click();
  await h3.pump();
  h3.tickIntervals();
  h3.getElementByIdSafe('mcpHubConfirmBtn').click();
  await h3.pump();
  const remoteErrText = h3.textOf(h3.getElementByIdSafe('mcpHubCallOutcome'));
  assert.ok(remoteErrText.includes('Erreur métier DISTANTE'), 'sous-état distant distinct');
  assert.ok(remoteErrText.includes('limite simulée'), 'contenu de l\'erreur affiché');
  assert.ok(!remoteErrText.includes('Exécution réussie'), 'aucun faux succès');
  assert.equal(h3.innerHTMLAttempts.length, 0, 'aucun innerHTML sur erreur');
});

/* ---------------------------------------------------------------------------
 * C35-13 — Journal : refus C3.4 lisibles ; 403 géré sans crash
 * ------------------------------------------------------------------------- */
test('C35-13 · journal : refus affichés avec raisons ; 403 lisible', async () => {
  const h = makeSandbox(baseRoutes());
  await driveToServers(h);
  const journalText = h.textOf(h.getElementByIdSafe('mcpHubJournalList'));
  assert.ok(journalText.includes('REFUS'), 'pill refus visible');
  assert.ok(journalText.includes('Exécution refusée'), 'action de refus nommée');
  assert.ok(journalText.includes('confirmation expirée'), 'raison traduite');
  assert.ok(journalText.includes('Échec TLS (certificat)'), 'cause technique traduite');

  const h2 = makeSandbox([
    { path: '/api/v1/auth/login', method: 'POST', status: 200, body: loginPayload('OWNER') },
    { path: SERVERS_PATH, method: 'GET', status: 200, body: { servers: [serverFixture(true, null)], total: 1 } },
    { path: JOURNAL_PATH, method: 'GET', status: 403, body: { error: { code: 'FORBIDDEN', message: 'Droits insuffisants', statusCode: 403 } } }
  ]);
  await driveToServers(h2);
  assert.ok(h2.textOf(h2.getElementByIdSafe('mcpHubJournalList')).includes('Droits insuffisants'), 'état 403 affiché sans crash');
});

/* ---------------------------------------------------------------------------
 * C35-14 — Rôles : ADMIN exécute en mode manuel ; ENGINEER lecture seule
 * ------------------------------------------------------------------------- */
test('C35-14 · rôles : ADMIN exécute (saisie manuelle) ; ENGINEER en lecture stricte', async () => {
  // ADMIN : gestion désactivée (cosmétique — OWNER seul), exécution manuelle
  const approved = { status: 'APPROVED', approvedSchemaSha256: SHA_OK, drift: false, approvedAt: 'x' } as Dict;
  const hAdmin = makeSandbox(baseRoutes('ADMIN'));
  await driveToServers(hAdmin);
  assert.equal(hAdmin.getElementByIdSafe('mcpHubAddBtn').disabled, true, 'ajout désactivé pour ADMIN');
  const adminText = hAdmin.textOf(hAdmin.document.body);
  assert.ok(adminText.includes('Vous pouvez exécuter des outils autorisés'), 'note de rôle ADMIN visible');
  assert.ok(hAdmin.findText('Tester la connexion') === null, 'test masqué (OWNER seul au backend)');
  assert.ok(hAdmin.findText('Supprimer') === null, 'suppression masquée');
  assert.ok(hAdmin.findText('Voir les outils (découverte)') === null, 'découverte masquée (OWNER seul au backend)');
  assert.ok(hAdmin.findText('Appeler un outil (manuel)'), 'exécution manuelle disponible');

  hAdmin.findText('Appeler un outil (manuel)')!.click();
  await hAdmin.pump();
  documentSetInput(hAdmin, 'mcpHubManualName', 'echo_x');
  documentSetInput(hAdmin, 'mcpHubExecArgs', '{}');
  hAdmin.getElementByIdSafe('mcpHubPrepareBtn').click();
  await hAdmin.pump();
  const prepares = hAdmin.log.filter(function (entry) { return entry.path === PREPARE_PATH && entry.method === 'POST'; });
  assert.equal(prepares.length, 1, 'prepare émis via le mode manuel');
  assert.ok(prepares[0]!.path.includes('/tools/echo_x/prepare'), 'nom d\'outil manuel utilisé');
  hAdmin.tickIntervals();
  assert.equal(hAdmin.getElementByIdSafe('mcpHubConfirmBtn').disabled, false, 'confirmation armée');
  hAdmin.getElementByIdSafe('mcpHubConfirmBtn').click();
  await hAdmin.pump();
  assert.equal(hAdmin.countFetch(CALL_PATH, 'POST'), 1, 'exécution ADMIN confirmée et réelle');

  // ENGINEER : lecture stricte
  const hEng = makeSandbox(baseRoutes('ENGINEER'));
  await driveToServers(hEng);
  assert.equal(hEng.getElementByIdSafe('mcpHubAddBtn').disabled, true, 'ajout désactivé');
  assert.ok(hEng.findText('Tester la connexion') === null, 'test masqué');
  assert.ok(hEng.findText('Appeler un outil (manuel)') === null, 'exécution masquée (INVOKE interdit)');
  assert.ok(hEng.textOf(hEng.getElementByIdSafe('mcpHubServers')).includes('Serveur Exemple'), 'consultation visible');

  // VIEWER : lecture stricte également
  const hView = makeSandbox(baseRoutes('VIEWER'));
  await driveToServers(hView);
  assert.equal(hView.getElementByIdSafe('mcpHubAddBtn').disabled, true, 'ajout désactivé pour VIEWER');
  assert.ok(hView.findText('Supprimer') === null, 'suppression masquée pour VIEWER');
});

/* ---------------------------------------------------------------------------
 * C35-15 — Sécurité DOM ; contenu hostile en TEXTE ; aucune référence catalogue
 * ------------------------------------------------------------------------- */
test('C35-15 · aucun innerHTML/src/href ; hostile en TEXTE ; aucun endpoint catalogue', async () => {
  const hostileServer = Object.assign(serverFixture(true, { at: '2026-10-27T10:00:00.000Z', status: 'OK', detail: null }), {
    name: '</div><script>alert(9)</script>',
    url: 'https://hostile.ex/" onerror'
  });
  const hostileTool = Object.assign(toolFixture({ status: 'APPROVED', approvedSchemaSha256: SHA_OK, drift: false, approvedAt: 'x' }, 'OK'), {
    description: '</div><script>alert(2)</script>'
  });
  const h = makeSandbox([
    { path: '/api/v1/auth/login', method: 'POST', status: 200, body: { token: 'tok_hostile', user: { id: 'usr_c35', email: 'own@exemple.fr', name: '</img>', tenantId: 'ten-c35', role: 'OWNER' } } },
    { path: SERVERS_PATH, method: 'GET', status: 200, body: { servers: [hostileServer], total: 1 } },
    { path: TEST_PATH, method: 'POST', status: 200, body: { ok: false, error: { code: 'CONNECT_ERROR', message: '</div cible>' } } },
    { path: TOOLS_PATH, method: 'GET', status: 200, body: toolsPayload([hostileTool], true) },
    { path: PREPARE_PATH, method: 'POST', status: 201, body: freshConfirmation() },
    { path: CALL_PATH, method: 'POST', status: 200, body: { result: { isError: false, content: [{ type: 'text', text: '<img onerror="alert(3)">' }] } } },
    { path: JOURNAL_PATH, method: 'GET', status: 200, body: journalPayload() }
  ]);
  await driveToServers(h);
  h.findText('Voir les outils (découverte)')!.click();
  await h.pump();
  h.findText('Utiliser cet outil')!.click();
  await h.pump();
  h.getElementByIdSafe('mcpHubPrepareBtn').click();
  await h.pump();
  h.tickIntervals();
  h.getElementByIdSafe('mcpHubConfirmBtn').click();
  await h.pump();

  assert.equal(h.innerHTMLAttempts.length, 0, 'AUCUNE attribution innerHTML dans tout le parcours');
  assert.equal(h.resourceAttributes.length, 0, 'AUCUN src/href attribué');
  const hubText = h.textOf(h.document.body);
  assert.ok(hubText.includes('</div><script>alert(9)</script>'), 'nom hostile rendu en TEXTE brut');
  assert.ok(hubText.includes('<img onerror="alert(3)">'), 'résultat hostile rendu en TEXTE brut');

  // Garde statique : aucune assignation innerHTML, aucun onclick construit,
  // aucun endpoint catalogue inventé.
  assert.equal(/innerHTML\s*=\s*[^=]/.test(HUB_SOURCE), false, 'aucune assignation innerHTML dans le source');
  assert.equal(/onclick\s*=/.test(HUB_SOURCE), false, 'aucun gestionnaire inline onclick dans le source');
  assert.equal(HUB_SOURCE.indexOf('/api/v1/mcp/catalogue'), -1, 'aucun endpoint catalogue inventé');
  assert.equal(HUB_SOURCE.toLowerCase().indexOf('destructivehint'), -1, 'destructiveHint jamais utilisé comme autorisation');
});

/* ---------------------------------------------------------------------------
 * C35-16 — Helpers purs : refus, canonicalisation, URL, horloge, transport
 * ------------------------------------------------------------------------- */
test('C35-16 · helpers purs : classifyCallFailure, canonical, urlLooksSharable, clock, transport', () => {
  const sandbox = { window: {} } as Record<string, unknown>;
  vm.createContext(sandbox);
  vm.runInNewContext(HUB_SOURCE, sandbox, { filename: 'apps/studio/mcp-hub.js' });
  const internals = (sandbox.window as { __mcpHubInternals?: Record<string, unknown> }).__mcpHubInternals;
  assert.ok(internals, 'internals exposés');
  const classify = internals!['classifyCallFailure'] as (status: number, payload: unknown) => string;
  const canon = internals!['canonical'] as (value: unknown) => string;
  const urlCheck = internals!['urlLooksSharable'] as (value: unknown) => string;
  const clock = internals!['confirmationClock'] as (expiresAt: number, nowMs: number) => { state: string };
  const humanKind = internals!['humanTransportKind'] as (code: unknown) => string;

  assert.equal(classify(409, { error: { code: 'MCP_REMOTE_DRIFT', message: 'Confirmation expirée : opération refusée, préparez à nouveau' } }), 'confirmation_expired');
  assert.equal(classify(409, { error: { code: 'MCP_REMOTE_DRIFT', message: 'Confirmation déjà consommée : rejeu refusé' } }), 'confirmation_used');
  assert.equal(classify(409, { error: { code: 'MCP_REMOTE_DRIFT', message: 'Confirmation non liée à cette opération exacte (identité, outil, schéma ou arguments modifiés)' } }), 'binding_mismatch');
  assert.equal(classify(409, { error: { code: 'MCP_REMOTE_DRIFT', message: 'Connecteur désactivé : exécution refusée' } }), 'connector_disabled');
  assert.equal(classify(409, { error: { code: 'MCP_REMOTE_DRIFT', message: 'Schéma de l\'outil dérivé' } }), 'schema_drift');
  assert.equal(classify(504, { error: { code: 'MCP_REMOTE_TIMEOUT', message: 'x' } }), 'transport_timeout');
  assert.equal(classify(502, { error: { code: 'MCP_REMOTE_UNREACHABLE', message: 'x' } }), 'transport');
  assert.equal(classify(401, null), 'auth_required');
  assert.equal(classify(403, null), 'forbidden');
  assert.equal(classify(200, null), 'server_error');

  assert.equal(canon({ b: 1, a: 2 }), canon({ a: 2, b: 1 }), 'ordre des clés sans effet');
  assert.notEqual(canon({ a: [1, 2] }), canon({ a: [2, 1] }), 'ordre des éléments distinct');
  assert.equal(canon({ nest: { deep: {} } }), canon({ nest: { deep: {} } }), 'stabilité récursive');

  assert.equal(urlCheck('https://mcp.exemple.ex/mcp'), '', 'URL publique acceptée');
  assert.notEqual(urlCheck('http://localhost:9999/x'), '', 'localhost refusé');
  assert.notEqual(urlCheck('https://10.1.2.3/x'), '', 'IPv4 privée 10.x refusée');
  assert.notEqual(urlCheck('https://192.168.0.5/x'), '', '192.168.x refusée');
  assert.notEqual(urlCheck('https://172.20.0.9/x'), '', '172.16-31.x refusée');
  assert.notEqual(urlCheck('https://169.254.169.254/x'), '', 'lien-local refusé');
  assert.notEqual(urlCheck('ftp://mcp.ex/x'), '', 'scheme non http(s) refusé');

  assert.equal(clock(1500, 1000).state, 'active');
  assert.equal(clock(1000, 1000).state, 'expired');
  assert.equal(clock(999, 1000).state, 'expired');

  assert.equal(humanKind('TLS_FAILURE'), 'Échec TLS (certificat)');
  assert.equal(humanKind(''), 'Erreur réseau');
});
