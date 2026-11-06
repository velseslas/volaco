/**
 * C3.2-B4 — Tests Studio « MCP distant » (interface confirmée).
 *
 * Principe : exécuter le VRAI fichier `apps/studio/mcp-remote.js` dans un
 * sandbox `vm` avec un faux DOM minimal dont `innerHTML` est interdit
 * (levée immédiate + trace), les attributions `src/href` traçées, le fetch
 * stubbé par routes exactes (contrats HTTP réels C3.2 B1/B2/B3) et l'horloge
 * d'interval contrôlée.
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
import { createHash } from 'node:crypto';

/* ---------------------------------------------------------------------------
 * Localisation du fichier Studio (résolution robuste depuis le compilé ESM)
 * ------------------------------------------------------------------------- */
const TEST_DIR = dirname(fileURLToPath(import.meta.url));

function findRepoRoot(): string {
  let dir = TEST_DIR;
  for (var i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'apps', 'studio', 'mcp-remote.js'))) return dir;
    var parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Racine du dépôt introuvable (apps/studio/mcp-remote.js) depuis ' + TEST_DIR);
}

const REPO_ROOT = findRepoRoot();
const STUDIO_SOURCE_PATH = join(REPO_ROOT, 'apps', 'studio', 'mcp-remote.js');
const STUDIO_SOURCE = readFileSync(STUDIO_SOURCE_PATH, 'utf8');

/**
 * Garde-fou anti-corruption : premium-builder inchangé DEPUIS SA DERNIÈRE
 * RÉFÉRENCE. La référence initiale (livraison B4, 3565CA58…) est devenue
 * obsolète car le fichier a volontairement évolué après B4 (unification
 * Builder v2 = preview unique, lot E45) — ses tests de comportement
 * B4-01…B4-10 passent sur la version actuelle. Référence recalée :
 */
const PREVIEW_APP_SHA256_EXPECTED = '3B423F69381339848AF4067A8817D548ACC18ADAC34490AE9EBF6B238B038ABC';

/* ---------------------------------------------------------------------------
 * Types du harnais
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

  constructor(tag: string, private readonly harness: SandboxedStudio) {
    this.tagName = tag.toUpperCase();
    const self = this;
    Object.defineProperty(self, 'innerHTML', {
      configurable: false,
      enumerable: false,
      get: function (): string { return ''; },
      set: function (value: string): void {
        harness.innerHTMLAttempts.push(String(value));
        throw new Error('Faux DOM : innerHTML interdit (contenu distant non fiable, B4-§3)');
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
  insertBefore(newNode: FakeElement, reference: FakeElement | null): FakeElement {
    if (reference === null) {
      return this.appendChild(newNode);
    }
    const index = this.children.indexOf(reference);
    if (index < 0) {
      return this.appendChild(newNode);
    }
    this.children.splice(index, 0, newNode);
    newNode.parentNode = this;
    return newNode;
  }
}

/** Sandbox complet exécutant le vrai module Studio. */
interface SandboxedStudio {
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
  tickIntervals(): void;
  pump(): Promise<void>;
  findText(needle: string): FakeElement | null;
  textOf(node: FakeElement | null): string;
  countFetch(pathSuffix: string, method?: string): number;
  getElementByIdSafe(id: string): FakeElement;
}

function makeSandbox(routes: Route[]): SandboxedStudio {
  const harness: SandboxedStudio = Object.create(null) as SandboxedStudio;
  const log: Array<FetchLogEntry> = [];
  const intervalFns: Array<(() => void) | null> = [];
  const innerHTMLAttempts: string[] = [];
  const resourceAttributes: Array<{ key: string; value: string }> = [];
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
    // Un élément retiré du DOM (modal fermée, résultat « Fermer ») ne doit plus
    // être résolu par getElementById — comme dans un navigateur réel.
    let current: FakeElement | null = node;
    while (current !== null) {
      if (current === documentStub.body) return true;
      current = current.parentNode;
    }
    return false;
  };
  registry.push(documentStub.body);
  const windowStub = {
    confirm: function (): boolean { return true; },
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
    if (matched.reject === true) {
      return Promise.reject(new Error('reseau casse (stub)'));
    }
    const payloadText = matched.raw !== undefined
      ? matched.raw
      : (matched.body === undefined ? '' : JSON.stringify(matched.body));
    return Promise.resolve({ status: matched.status, text: () => Promise.resolve(payloadText) });
  };

  const sandbox: Record<string, unknown> = {
    window: windowStub,
    document: documentStub,
    fetch: fetchStub
  };
  vm.createContext(sandbox);
  vm.runInNewContext(STUDIO_SOURCE, sandbox, { filename: 'apps/studio/mcp-remote.js' });

  harness.document = documentStub;
  harness.window = windowStub;
  harness.log = log;
  harness.routes = routes;
  harness.intervalFns = intervalFns;
  harness.innerHTMLAttempts = innerHTMLAttempts;
  harness.resourceAttributes = resourceAttributes;
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
 * Fixtures (formes exactes des contrats serveur — voir mcp-remote.ts)
 * ------------------------------------------------------------------------- */
const SHA_OK = 'a'.repeat(64);
const SHA_ARGS = 'b'.repeat(64);

function connectorFixture(enabled: boolean): Record<string, unknown> {
  return {
    connectorId: 'c1',
    name: 'Serveur Exemple',
    url: 'https://mcp.exemple.ex/shared/stream',
    transport: 'url',
    enabled,
    secretPresent: true,
    secretKeyId: 'key-1',
    secretEncryptedAt: '2026-10-27T10:00:00.000Z',
    toolPolicies: [],
    createdAt: '2026-10-27T09:00:00.000Z',
    updatedAt: '2026-10-27T09:00:00.000Z'
  };
}

function toolFixture(approval: Record<string, unknown> | null, schemaStatus: string): Record<string, unknown> {
  return {
    toolName: 'echo_x',
    title: '<img src=x onerror=alert(1)> Écho',
    description: '</div><script>alert(2)</script> décrit un outil',
    inputSchema: schemaStatus === 'OK' ? { type: 'object', properties: { q: { type: 'string' } } } : null,
    schemaSha256: schemaStatus === 'OK' ? SHA_OK : null,
    schemaStatus,
    approval
  };
}

function confirmationFixture(expiresAt: number): Record<string, unknown> {
  return {
    confirmationId: 'conf-1',
    toolName: 'echo_x',
    schemaSha256: SHA_OK,
    argsSha256: SHA_ARGS,
    expiresAt
  };
}

function loginPayload(): Record<string, unknown> {
  return { token: 'tok_signed_b4_x', user: { id: 'usr_owner_x', email: 'own@exemple.fr', name: 'Owner', tenantId: 'ten-b4', role: 'OWNER' } };
}

function journalPayload(): Record<string, unknown> {
  return {
    events: [
      { id: 'e1', action: 'MCP_REMOTE_TOOL_PREPARED', resourceType: 'MCP_REMOTE', resourceId: 'c1', status: 'SUCCESS', userId: 'usr_owner_x', requestId: 'req-1', timestamp: '2026-10-27T09:01:11.000Z', metadata: { toolName: 'echo_x', schemaSha256: SHA_OK, argsSha256: SHA_ARGS, confirmationId: 'conf-1' } },
      { id: 'e2', action: 'MCP_REMOTE_TOOL_CALLED', resourceType: 'MCP_REMOTE', resourceId: 'c1', status: 'SUCCESS', userId: 'usr_owner_x', requestId: 'req-2', timestamp: '2026-10-27T09:02:11.000Z', metadata: { toolName: 'echo_x', isError: true } },
      { id: 'e3', action: 'MCP_REMOTE_TOOL_CALL_FAILED', resourceType: 'MCP_REMOTE', resourceId: 'c1', status: 'FAILURE', userId: 'usr_owner_x', requestId: 'req-3', timestamp: '2026-10-27T09:03:11.000Z', metadata: { toolName: 'echo_x', errorCode: 'CONNECT_ERROR' } }
    ],
    total: 3
  };
}

function baseRoutes(overrides?: Array<Route>): Array<Route> {
  const routes: Array<Route> = [
    { path: '/api/v1/auth/login', method: 'POST', status: 200, body: loginPayload() },
    { path: '/api/v1/mcp-remote/journal', status: 200, body: journalPayload() },
    { path: '/api/v1/mcp-remote/connectors', status: 200, body: { connectors: [connectorFixture(true)] } },
    { path: '/api/v1/mcp-remote/connectors/c1', status: 200, body: { connector: connectorFixture(true) } },
    { path: '/api/v1/mcp-remote/connectors/c1/tools', status: 200, body: { connector: { connectorId: 'c1', name: 'Serveur Exemple', enabled: true }, tools: [toolFixture({ status: 'APPROVED', approvedSchemaSha256: SHA_OK, drift: false }, 'OK')], schemaInvalidCount: 0, displayTruncatedCount: 0 } },
    { path: '/api/v1/mcp-remote/connectors/c1/tools/echo_x/approve', method: 'POST', status: 200, body: { approval: { toolName: 'echo_x', schemaSha256: SHA_OK, status: 'APPROVED', approvedBy: 'usr_owner_x', approvedAt: '2026-10-27T09:05:00.000Z', updatedAt: '2026-10-27T09:05:00.000Z' } } },
    { path: '/api/v1/mcp-remote/connectors/c1/tools/echo_x/revoke', method: 'POST', status: 200, body: { revocation: { toolName: 'echo_x', status: 'REVOKED' } } },
    { path: '/api/v1/mcp-remote/connectors/c1/tools/echo_x/prepare', method: 'POST', status: 201, body: { confirmation: confirmationFixture(Date.now() + 15 * 60 * 1000) } },
    { path: '/api/v1/mcp-remote/connectors/c1/tools/echo_x/call', method: 'POST', status: 200, body: { result: { isError: false, content: [{ type: 'text', text: 'echo ok' }] } } }
  ];
  if (overrides) for (const override of overrides) routes.unshift(override);
  return routes;
}

/** Navigation de base : montage, login OWNER, connecteur ouvert (sans découverte). */
async function driveToConnector(h: SandboxedStudio): Promise<void> {
  h.log.length = 0;
  const toggle = h.getElementByIdSafe('mcpRemoteToggleBtn');
  toggle.click();
  await h.pump();
  assert.ok(h.getElementByIdSafe('mcpRemotePanel'), 'panneau monté');

  // Session OWNER (JWT réel via route auth existante)
  h.findText('Session')!.click();
  await h.pump();
  documentSetInput(h, 'mcpRemoteLoginEmail', 'own@exemple.fr');
  documentSetInput(h, 'mcpRemoteLoginPassword', 'mot-de-passe-owner');
  h.findText('Se connecter')!.click();
  await h.pump();
  assert.ok(h.textOf(h.getElementByIdSafe('mcpRemoteIdentityChip')).includes('JWT'), 'session JWT active');
  assert.ok(h.textOf(h.getElementByIdSafe('mcpRemoteIdentityChip')).includes('own@exemple.fr'), 'email affiché');

  // Connecteur
  h.log.length = 0; // isole la requête GET list (le login rafraîchit déjà)
  h.findText('Connecteurs')!.click();
  await h.pump();
  assert.equal(h.countFetch('/api/v1/mcp-remote/connectors', 'GET'), 1, 'liste chargée');
  h.findText('Ouvrir')!.click();
  await h.pump();
  assert.equal(h.countFetch('/api/v1/mcp-remote/connectors/c1', 'GET'), 1, 'détail chargé');
}

/** driveToConnector + découverte des outils avec asserts de réussite. */
async function driveToTools(h: SandboxedStudio): Promise<void> {
  await driveToConnector(h);

  // Découverte
  h.findText('Découvrir')!.click();
  await h.pump();
  assert.equal(h.countFetch('/connectors/c1/tools', 'GET'), 1, 'découverte GET');
  const listText = h.textOf(h.getElementByIdSafe('mcpRemoteToolsList'));
  assert.ok(listText.includes('echo_x'), 'outil affiché');
  // Badge d'état : APPROUVÉ (sous-chaîne de NON APPROUVÉ aussi) ou RÉVOQUÉE.
  assert.ok(listText.includes('APPROUVÉ') || listText.includes('RÉVOQUÉE'), 'approbation visible');
}

function documentSetInput(h: SandboxedStudio, id: string, value: string): void {
  h.getElementByIdSafe(id).value = value;
}

/**
 * Flux complet de préparation : « Préparer l'exécution » (carte) — AUCUN POST
 * à cette étape — puis « Préparer la confirmation » (POST /prepare → 201) et
 * ouverture de la modale. Vérifie explicitement le silence réseau intermédiaire.
 */
async function prepareAndConfirm(h: SandboxedStudio): Promise<void> {
  const before = h.countFetch('/prepare', 'POST');
  h.findText('Préparer l\u2019exécution')!.click();
  await h.pump();
  assert.equal(h.countFetch('/prepare', 'POST'), before, 'ouvrir la carte de préparation n\u2019émet AUCUN POST');
  const prepareConfirm = h.findText('Préparer la confirmation');
  assert.ok(prepareConfirm, 'carte de préparation ouverte');
  prepareConfirm!.click();
  await h.pump();
  assert.ok(h.getElementByIdSafe('mcpRemoteConfirmModal'), 'modale de confirmation ouverte (post-POST /prepare)');
}

/* ---------------------------------------------------------------------------
 * VA-1 — Aucune exécution automatique (découverte/approbation/préparation n'appellent JAMAIS /call)
 * ------------------------------------------------------------------------- */
test('B4-01 · aucune exécution automatique (découverte, approbation, préparation, journal n\u2019émettent aucun /call)', async () => {
  const h = makeSandbox(baseRoutes());
  await driveToTools(h);
  assert.equal(h.countFetch('/call', 'POST'), 0, 'aucun tools/call après découverte');

  // Préparation (aucune exécution, et aucun POST tant que l'utilisateur
  // n'a pas cliqué « Préparer la confirmation »)
  const prepareBtn = h.findText('Préparer l\u2019exécution');
  assert.ok(prepareBtn, 'bouton préparer présent (OWNER + APPROVED sans dérive + actif)');
  prepareBtn!.click();
  await h.pump();
  assert.equal(h.countFetch('/prepare', 'POST'), 0, 'ouvrir la carte de préparation : AUCUN POST');
  assert.equal(h.countFetch('/call', 'POST'), 0, 'aucun tools/call à l\u2019ouverture de la préparation');
  h.findText('Préparer la confirmation')!.click();
  await h.pump();
  assert.equal(h.countFetch('/prepare', 'POST'), 1, 'une préparation (au clic explicite)');
  assert.equal(h.countFetch('/call', 'POST'), 0, 'aucun tools/call après préparation');
  assert.ok(h.getElementByIdSafe('mcpRemoteConfirmModal'), 'modale de confirmation ouverte');

  // Annulation explicite
  h.getElementByIdSafe('mcpRemoteCancelBtn').click();
  await h.pump();
  assert.equal(h.countFetch('/call', 'POST'), 0, 'aucun tools/call après annulation');

  // Approbation (outil non approuvé simulé) — jamais d'exécution
  const approveRoutes = baseRoutes([
    { path: '/api/v1/mcp-remote/connectors/c1/tools/echo_x/approve', method: 'POST', status: 200, body: { approval: { toolName: 'echo_x', schemaSha256: SHA_OK, status: 'APPROVED', approvedBy: 'usr_owner_x', approvedAt: '2026-10-27T09:06:00.000Z', updatedAt: '2026-10-27T09:06:00.000Z' } } },
    { path: '/api/v1/mcp-remote/connectors/c1/tools', status: 200, body: { connector: { connectorId: 'c1', name: 'Serveur Exemple', enabled: true }, tools: [toolFixture(null, 'OK')], schemaInvalidCount: 0, displayTruncatedCount: 0 } }
  ]);
  const h2 = makeSandbox(approveRoutes);
  await driveToTools(h2);
  const approveBtn = h2.findText('Approuver (hash recalculé serveur)');
  assert.ok(approveBtn, 'bouton approbation présent');
  approveBtn!.click();
  await h2.pump();
  assert.equal(h2.countFetch('/approve', 'POST'), 1, 'une approbation');
  assert.equal(h2.countFetch('/call', 'POST'), 0, 'aucun tools/call après approbation');

  // Journal — lecture seule
  h2.findText('Journal')!.click();
  await h2.pump();
  assert.equal(h2.countFetch('/journal', 'GET'), 1, 'journal chargé');
  assert.equal(h2.countFetch('/call', 'POST'), 0, 'aucun tools/call via le journal');
});

/* ---------------------------------------------------------------------------
 * VA-2 + VA-3 — Annulation sans exécution ; confirmation expresse avant appel
 * ------------------------------------------------------------------------- */
test('B4-02 · annulation sans appel puis confirmation expresse unique', async () => {
  const h = makeSandbox(baseRoutes());
  await driveToTools(h);

  await prepareAndConfirm(h);

  // Annulation : aucun appel
  h.getElementByIdSafe('mcpRemoteCancelBtn').click();
  await h.pump();
  assert.equal(h.countFetch('/call', 'POST'), 0, 'annulation n\u2019exécute rien');
  assert.equal(h.document.getElementById('mcpRemoteConfirmModal'), null, 'modale fermée');

  // Nouvelle préparation puis confirmation expresse
  await prepareAndConfirm(h);
  const confirmBtn = h.getElementByIdSafe('mcpRemoteConfirmBtn');
  assert.equal(confirmBtn.disabled, false, 'confirmation active (args identiques, TTL vivant)');
  confirmBtn.click();
  await h.pump();
  assert.equal(h.countFetch('/call', 'POST'), 1, 'UN SEUL tools/call — post-confirmation');
  assert.equal(h.countFetch('/prepare', 'POST'), 2, 'deux préparations (une par flux)');
  const callEntry = h.log.filter(function (entry) { return entry.path.endsWith('/call'); })[0]!;
  assert.deepEqual(callEntry.body, { confirmationId: 'conf-1', arguments: {} }, 'arguments EXACTS de la préparation');
  assert.equal(h.document.getElementById('mcpRemoteConfirmModal'), null, 'modale fermée après exécution');
});

/* ---------------------------------------------------------------------------
 * VA-4 — Arguments affichés = arguments préparés ; args modifiés ⇒ exécution bloquée
 * ------------------------------------------------------------------------- */
test('B4-03 · arguments affichés identiques à la préparation ; toute modification bloque l\u2019exécution', async () => {
  const h = makeSandbox(baseRoutes());
  await driveToTools(h);

  // Préparation avec des arguments précis
  h.findText('Préparer l\u2019exécution')!.click();
  await h.pump();
  documentSetInput(h, 'mcpRemoteArgsArea', '{ "q": "texte-init", "fen": 2 }');
  h.findText('Préparer la confirmation')!.click();
  await h.pump();
  assert.equal(h.countFetch('/prepare', 'POST'), 1, 'préparation avec ces arguments');
  assert.deepEqual(h.log.filter(function (entry) { return entry.path.endsWith('/prepare'); })[0]!.body, { arguments: { q: 'texte-init', fen: 2 } }, 'payload prepare');

  const modal = h.getElementByIdSafe('mcpRemoteConfirmModal');
  assert.ok(h.textOf(modal).includes('texte-init'), 'les arguments EXACTS sont affichés (valeur)');
  assert.ok(h.textOf(modal).includes('fen'), 'les arguments EXACTS sont affichés (clé)');

  // Modification des arguments => confirmation désactivée + bannière
  documentSetInput(h, 'mcpRemoteArgsArea', '{ "q": "texte-alt", "fen": 2 }');
  h.tickIntervals();
  const confirmBtn = h.getElementByIdSafe('mcpRemoteConfirmBtn');
  assert.equal(confirmBtn.disabled, true, 'exécution bloquée (args modifiés)');
  assert.ok(h.textOf(h.getElementByIdSafe('mcpRemoteArgsMismatch')).includes('Arguments modifiés'), 'bannière args modifiés');
  assert.equal(h.countFetch('/call', 'POST'), 0, 'aucun appel malgré le clic (le bouton est désactivé et le module le garde-fou)');

  // Retour aux arguments EXACTS préparés => exécution déverrouillée, payload identique
  documentSetInput(h, 'mcpRemoteArgsArea', '{ "q": "texte-init", "fen": 2 }');
  h.tickIntervals();
  assert.equal(confirmBtn.disabled, false, 'déblocage une fois les arguments identiques');
  confirmBtn.click();
  await h.pump();
  const callBody = h.log.filter(function (entry) { return entry.path.endsWith('/call'); })[0]!.body as Record<string, unknown>;
  assert.deepEqual(callBody, { confirmationId: 'conf-1', arguments: { q: 'texte-init', fen: 2 } }, 'call transporte EXACTEMENT les arguments préparés');
});

/* ---------------------------------------------------------------------------
 * VA-5 — Sécurité DOM : JAMAIS d'innerHTML, jamais src/href, contenu distant textuel
 * ------------------------------------------------------------------------- */
test('B4-04 · aucun innerHTML/src/href ; le contenu hostile distant reste du TEXTE', async () => {
  const hostileRoutes: Array<Route> = [
    { path: '/api/v1/mcp-remote/connectors', status: 200, body: { connectors: [Object.assign(connectorFixture(true), { name: '</div><script>alert(9)</script>' })] } },
    { path: '/api/v1/mcp-remote/connectors/c1', status: 200, body: { connector: Object.assign(connectorFixture(true), { url: 'https://hostile.ex/" onerror="x', name: '<svg onload=alert(8)>' }) } },
    { path: '/api/v1/mcp-remote/connectors/c1/tools', status: 200, body: { connector: { connectorId: 'c1', name: '<b>gras</b>', enabled: true }, tools: [toolFixture({ status: 'APPROVED', approvedSchemaSha256: SHA_OK, drift: false }, 'OK')], schemaInvalidCount: 0, displayTruncatedCount: 0 } },
    { path: '/api/v1/auth/login', method: 'POST', status: 200, body: loginPayload() },
    { path: '/api/v1/mcp-remote/journal', status: 200, body: journalPayload() },
    { path: '/api/v1/mcp-remote/connectors/c1/tools/echo_x/prepare', method: 'POST', status: 201, body: { confirmation: confirmationFixture(Date.now() + 15 * 60 * 1000) } },
    { path: '/api/v1/mcp-remote/connectors/c1/tools/echo_x/call', method: 'POST', status: 200, body: { result: { isError: false, content: [{ type: 'text', text: '<img onerror="alert(3)">' }] } } }
  ];
  const h = makeSandbox(hostileRoutes);
  await driveToTools(h);
  await prepareAndConfirm(h);
  h.getElementByIdSafe('mcpRemoteConfirmBtn').click();
  await h.pump();

  assert.equal(h.innerHTMLAttempts.length, 0, 'AUCUNE attribution innerHTML dans tout le parcours');
  assert.equal(h.resourceAttributes.length, 0, 'AUCUN src/href attribué (URL distante jamais chargée comme ressource)');
  const toolsText = h.textOf(h.getElementByIdSafe('mcpRemoteToolsList'));
  assert.ok(toolsText.includes('<img src=x onerror=alert(1)>'), 'titre hostile rendu en TEXTE brut');
  assert.ok(toolsText.includes('</div><script>alert(2)</script>'), 'description hostile rendue en TEXTE brut');
  const outcomeText = h.textOf(h.getElementByIdSafe('mcpRemoteCallOutcome'));
  assert.ok(outcomeText.includes('<img onerror='), 'résultat distant hostile rendu en TEXTE brut');

  // Garde statique : le source du module n'assigne JAMAIS innerHTML et ne crée
  // le mot-clé innerHTML que dans les commentaires documentaires.
  assert.equal(/innerHTML\s*=\s*[^=]/.test(STUDIO_SOURCE), false, 'aucune assignation innerHTML dans le source');
  assert.equal(/onclick\s*=/.test(STUDIO_SOURCE.replace(/\u2019|'/g, '"')), false, 'aucun gestionnaire inline onclick construit');
});

/* ---------------------------------------------------------------------------
 * VA-6 — Données distantes malformées (schéma nul, contenu inattendu)
 * ------------------------------------------------------------------------- */
test('B4-05 · schémas/descriptions/résultats malformés affichés sans crash', async () => {
  const malformedRoutes = baseRoutes([
    { path: '/api/v1/mcp-remote/connectors/c1/tools', status: 200, body: {
      connector: { connectorId: 'c1', name: 'Serveur Exemple', enabled: true },
      tools: [
        toolFixture(null, 'INVALID'),
        toolFixture(null, 'DISPLAY_TRUNCATED')
      ],
      schemaInvalidCount: 1,
      displayTruncatedCount: 1
    } }
  ]);
  const h = makeSandbox(malformedRoutes);
  await driveToTools(h);
  const listText = h.textOf(h.getElementByIdSafe('mcpRemoteToolsList'));
  assert.ok(listText.includes('SCHÉMA INVALIDE'), 'badge schéma invalide');
  assert.ok(listText.includes('SCHÉMA TROP GRAND'), 'badge display tronqué');
  assert.ok(listText.includes('echo_x') || listText.includes('echo_x'), 'noms d\u2019outils affichés');

  // Résultat with content non tableau (objet étrange) → rendu JSON sûr
  const weirdRoutes = baseRoutes([
    { path: '/api/v1/mcp-remote/connectors/c1/tools/echo_x/call', method: 'POST', status: 200, body: { result: { isError: false, content: { bizarre: true } as unknown, structuredContent: null } } }
  ]);
  const h2 = makeSandbox(weirdRoutes);
  await driveToTools(h2);
  await prepareAndConfirm(h2);
  h2.getElementByIdSafe('mcpRemoteConfirmBtn').click();
  await h2.pump();
  assert.equal(h2.innerHTMLAttempts.length, 0, 'aucun innerHTML sur résultat bizarre');
  assert.ok(h2.textOf(h2.getElementByIdSafe('mcpRemoteCallOutcome')).includes('bizarre'), 'contenu inattendu rendu en texte');
});

/* ---------------------------------------------------------------------------
 * VA-7 — isError:true distinct du transport ET de la réussite
 * ------------------------------------------------------------------------- */
test('B4-06 · isError:true = erreur métier distante distincte ; transport = autre état ; succès = son état', async () => {
  // isError:true
  const h1 = makeSandbox(baseRoutes([
    { path: '/api/v1/mcp-remote/connectors/c1/tools/echo_x/call', method: 'POST', status: 200, body: { result: { isError: true, content: [{ type: 'text', text: 'limit simulée par le serveur distant' }] } } }
  ]));
  await driveToTools(h1);
  await prepareAndConfirm(h1);
  h1.getElementByIdSafe('mcpRemoteConfirmBtn').click();
  await h1.pump();
  const isErrorText = h1.textOf(h1.getElementByIdSafe('mcpRemoteCallOutcome'));
  assert.ok(isErrorText.includes('Erreur métier DISTANTE (isError: true)'), 'distinct : erreur métier distante');
  assert.ok(isErrorText.includes('limit simulée'), 'contenu de l\u2019erreur métier affiché');
  assert.ok(!isErrorText.includes('Exécution réussie'), 'NE PAS afficher « réussie »');

  // Transport 502
  const h2 = makeSandbox(baseRoutes([
    { path: '/api/v1/mcp-remote/connectors/c1/tools/echo_x/call', method: 'POST', status: 502, body: { error: { code: 'MCP_REMOTE_UNREACHABLE', message: 'Cible injoignable', statusCode: 502 } } }
  ]));
  await driveToTools(h2);
  await prepareAndConfirm(h2);
  h2.getElementByIdSafe('mcpRemoteConfirmBtn').click();
  await h2.pump();
  const transportText = h2.textOf(h2.getElementByIdSafe('mcpRemoteCallOutcome'));
  assert.ok(transportText.includes('Connecteur inaccessible'), 'étiquette transport');
  assert.ok(transportText.includes('MCP_REMOTE_UNREACHABLE'), 'code transport visible');
  assert.ok(!transportText.includes('Erreur métier'), 'isError bien distinct du transport');

  // Transport 504 (timeout)
  const h3 = makeSandbox(baseRoutes([
    { path: '/api/v1/mcp-remote/connectors/c1/tools/echo_x/call', method: 'POST', status: 504, body: { error: { code: 'MCP_REMOTE_TIMEOUT', message: 'Délai', statusCode: 504 } } }
  ]));
  await driveToTools(h3);
  await prepareAndConfirm(h3);
  h3.getElementByIdSafe('mcpRemoteConfirmBtn').click();
  await h3.pump();
  assert.ok(h3.textOf(h3.getElementByIdSafe('mcpRemoteCallOutcome')).includes('Délai dépassé'), 'étiquette timeout distincte');

  // Réseau mort (fetch reject) : état distant inconnu explicite
  const h4 = makeSandbox(baseRoutes([
    { path: '/api/v1/mcp-remote/connectors/c1/tools/echo_x/call', method: 'POST', status: 200, reject: true }
  ]));
  await driveToTools(h4);
  await prepareAndConfirm(h4);
  h4.getElementByIdSafe('mcpRemoteConfirmBtn').click();
  await h4.pump();
  const netText = h4.textOf(h4.getElementByIdSafe('mcpRemoteCallOutcome'));
  assert.ok(netText.includes('transport impossible'), 'étiquette transport impossible');
});

/* ---------------------------------------------------------------------------
 * VA-8 — Expirations / révocations / dérives / connecteur désactivé / non approuvé
 * ------------------------------------------------------------------------- */
test('B4-07 · expiration, confirmation consumée, binding, désactivé, dérive schéma', async () => {
  // Expire immédiatement
  const h1 = makeSandbox(baseRoutes([
    { path: '/api/v1/mcp-remote/connectors/c1/tools/echo_x/prepare', method: 'POST', status: 201, body: { confirmation: confirmationFixture(Date.now() - 1) } }
  ]));
  await driveToTools(h1);
  await prepareAndConfirm(h1);
  const confirm1 = h1.getElementByIdSafe('mcpRemoteConfirmBtn');
  assert.equal(confirm1.disabled, true, 'exécution refusée : confirmation expirée');
  assert.ok(h1.textOf(h1.getElementByIdSafe('mcpRemoteExpirySlot')).includes('EXPIRÉE'), 'expiration affichée');

  // Refus serveur 409 sous-états
  const driftCases: Array<[string, string, string]> = [
    ['Confirmation expirée : opération refusée, préparez à nouveau', 'Confirmation expirée', 'expirée'],
    ['Confirmation déjà consommée : rejeu refusé', 'Confirmation déjà utilisée', 'consommée'],
    ['Confirmation non liée à cette opération exacte (identité, outil, schéma ou arguments modifiés)', 'Arguments modifiés (liaison refusée)', 'modifi']
  ];
  for (const driftCase of driftCases) {
    const h = makeSandbox(baseRoutes([
      { path: '/api/v1/mcp-remote/connectors/c1/tools/echo_x/call', method: 'POST', status: 409, body: { error: { code: 'MCP_REMOTE_DRIFT', message: driftCase[0], statusCode: 409 } } }
    ]));
    await driveToTools(h);
    await prepareAndConfirm(h);
    h.getElementByIdSafe('mcpRemoteConfirmBtn').click();
    await h.pump();
    const text = h.textOf(h.getElementByIdSafe('mcpRemoteCallOutcome'));
    assert.ok(text.includes(driftCase[1]), 'étiquette pour « ' + driftCase[0] + ' »');
    assert.ok(text.includes('MCP_REMOTE_DRIFT'), 'code drift rappelé');
  }

  // Connecteur désactivé → refus espoir au handleClick (bouton désactivé) + badges
  const hDisabled = makeSandbox(baseRoutes([]).map(function (route): Route {
    if (route.path === '/api/v1/mcp-remote/connectors' && route.status === 200) {
      return { path: route.path, status: 200, body: { connectors: [connectorFixture(false)] } };
    }
    if (route.path === '/api/v1/mcp-remote/connectors/c1') {
      return { path: route.path, status: 200, body: { connector: connectorFixture(false) } };
    }
    if (route.path === '/api/v1/mcp-remote/connectors/c1/tools') {
      return { path: route.path, status: 200, body: { connector: { connectorId: 'c1', name: 'Serveur Exemple', enabled: false }, tools: [toolFixture({ status: 'APPROVED', approvedSchemaSha256: SHA_OK, drift: false }, 'OK')], schemaInvalidCount: 0, displayTruncatedCount: 0 } };
    }
    return route;
  }));
  await driveToTools(hDisabled);
  assert.ok(hDisabled.textOf(hDisabled.getElementByIdSafe('mcpRemoteToolsList')).includes('DÉSACTIVÉ') || hDisabled.textOf(hDisabled.getElementByIdSafe('mcpRemoteConnectorsRight')).includes('DÉSACTIVÉ'), 'état désactivé visible');
  const prepareDisabled = hDisabled.findText('Préparer l\u2019exécution');
  if (prepareDisabled) {
    assert.equal(prepareDisabled.disabled, true, 'préparation implausible sur connecteur désactivé');
    prepareDisabled.click();
    await hDisabled.pump();
    assert.equal(hDisabled.countFetch('/prepare', 'POST'), 0, 'aucun prepare envoyé');
  }

  // Dérive de schéma (APPROVED + drift) et non-approbation : préparations impossibles
  const hDrift = makeSandbox(baseRoutes([
    { path: '/api/v1/mcp-remote/connectors/c1/tools', status: 200, body: { connector: { connectorId: 'c1', name: 'Serveur Exemple', enabled: true }, tools: [toolFixture({ status: 'APPROVED', approvedSchemaSha256: SHA_OK, drift: true }, 'OK')], schemaInvalidCount: 0, displayTruncatedCount: 0 } }
  ]));
  await driveToTools(hDrift);
  const driftBtn = hDrift.findText('Préparer l\u2019exécution');
  assert.ok(driftBtn, 'bouton préparé présent mais désactivé');
  assert.equal(driftBtn!.disabled, true, 'dérive de schéma → exécution refusée côté UI');
  driftBtn!.click();
  await hDrift.pump();
  assert.equal(hDrift.countFetch('/prepare', 'POST'), 0, 'aucun prepare sur dérive');

  const hNone = makeSandbox(baseRoutes([
    { path: '/api/v1/mcp-remote/connectors/c1/tools', status: 200, body: { connector: { connectorId: 'c1', name: 'Serveur Exemple', enabled: true }, tools: [toolFixture(null, 'OK')], schemaInvalidCount: 0, displayTruncatedCount: 0 } }
  ]));
  await driveToTools(hNone);
  assert.ok(hNone.textOf(hNone.getElementByIdSafe('mcpRemoteToolsList')).includes('NON APPROUVÉ'), 'badge non approuvé');
  const nonePrepare = hNone.findText('Préparer l\u2019exécution');
  if (nonePrepare) {
    assert.equal(nonePrepare.disabled, true, 'préparation refusée tant que l\u2019outil n\u2019est pas APPROVED');
  }

  // Révocation visible
  const hRevoked = makeSandbox(baseRoutes([
    { path: '/api/v1/mcp-remote/connectors/c1/tools', status: 200, body: { connector: { connectorId: 'c1', name: 'Serveur Exemple', enabled: true }, tools: [toolFixture({ status: 'REVOKED', approvedSchemaSha256: SHA_OK, drift: false }, 'OK')], schemaInvalidCount: 0, displayTruncatedCount: 0 } }
  ]));
  await driveToTools(hRevoked);
  assert.ok(hRevoked.textOf(hRevoked.getElementByIdSafe('mcpRemoteToolsList')).includes('APPROBATION RÉVOQUÉE'), 'badge révocation');
});

/* ---------------------------------------------------------------------------
 * VA-9 — Erreurs HTTP et réponses inattendues (journal frangible, login ambre)
 * ------------------------------------------------------------------------- */
test('B4-08 · erreurs HTTP 4xx/5xx et corps inattendus gérés sans crash', async () => {
  // Login 429 JSON prévu
  const h1 = makeSandbox([{ path: '/api/v1/auth/login', method: 'POST', status: 429, body: { error: { code: 'TOO_MANY_ATTEMPTS', message: 'Trop de tentatives — réessayez dans 60s.', statusCode: 429 } } }]);
  h1.log.length = 0;
  documentSetInput(h1, 'mcpRemoteLoginEmail', 'a@b.c');
  documentSetInput(h1, 'mcpRemoteLoginPassword', 'x');
  h1.findText('Se connecter')!.click();
  await h1.pump();
  assert.ok(h1.textOf(h1.getElementByIdSafe('mcpRemoteLoginStatus')).includes('Trop de tentatives'), 'message 429 exposé');

  // Login 500 avec corps NON JSON (réponse inattendue)
  const h2 = makeSandbox([{ path: '/api/v1/auth/login', method: 'POST', status: 500, raw: '<html>oops</html>' }]);
  documentSetInput(h2, 'mcpRemoteLoginEmail', 'a@b.c');
  documentSetInput(h2, 'mcpRemoteLoginPassword', 'x');
  h2.findText('Se connecter')!.click();
  await h2.pump();
  assert.ok(h2.textOf(h2.getElementByIdSafe('mcpRemoteLoginStatus')).includes('Erreur HTTP'), 'réponse inattendue => état générique (sans crash)');

  // Journal 403
  const h3 = makeSandbox([{ path: '/api/v1/mcp-remote/journal', status: 403, body: { error: { code: 'FORBIDDEN', message: 'Droits insuffisants', statusCode: 403 } } }]);
  h3.findText('Journal')!.click();
  await h3.pump();
  assert.ok(h3.textOf(h3.getElementByIdSafe('mcpRemoteJournalList')).includes('Journal indisponible'), 'état journal refusé affich');

  // Découverte 502 transport (connecteur inaccessible) — routes complètes
  // (login/liste/détail réels) SAUF la découverte, qui répond 502.
  const h4 = makeSandbox(baseRoutes([
    { path: '/api/v1/mcp-remote/connectors/c1/tools', status: 502, body: { error: { code: 'MCP_REMOTE_UNREACHABLE', message: 'Cible injoignable', statusCode: 502 } } }
  ]));
  await driveToConnector(h4);
  h4.findText('Découvrir')!.click();
  await h4.pump();
  assert.ok(h4.textOf(h4.getElementByIdSafe('mcpRemoteToolsState')).includes('Connecteur inaccessible'), 'état connecteur inaccessible à la découverte');
  assert.equal(h4.countFetch('/call', 'POST'), 0, 'aucun appel suite émergence transport');
});

/* ---------------------------------------------------------------------------
 * VA-10 — Journal affiche les événements (métadonnées sûres, texte)
 * ------------------------------------------------------------------------- */
test('B4-09 · journal affiché textuellement avec hashes/id, sans contenus sensibles', async () => {
  const h = makeSandbox(baseRoutes());
  await driveToTools(h);
  h.findText('Journal')!.click();
  await h.pump();
  const journalText = h.textOf(h.getElementByIdSafe('mcpRemoteJournalList'));
  assert.ok(journalText.includes('MCP_REMOTE_TOOL_PREPARED'), 'action preparée visible');
  assert.ok(journalText.includes(SHA_OK.slice(0, 12)), 'empreinte outil visible (extrait)');
  assert.ok(journalText.includes('CONNECT_ERROR'), 'code transport visible');
  assert.equal(h.innerHTMLAttempts.length, 0, 'aucun innerHTML');
});

/* ---------------------------------------------------------------------------
 * VA-11 — Helpers purs : classification, horloge de confirmation, canonicalisation
 * ------------------------------------------------------------------------- */
test('B4-10 · classifyOutcome / confirmationClock / canonicalForUi (purs)', () => {
  // Sandbox minimal : window seul (sans document) — le module doit publier
  // ses helpers purs SANS monter l'UI (garde document conditionnel).
  const sandbox = { window: {} } as Record<string, unknown>;
  vm.createContext(sandbox);
  vm.runInNewContext(STUDIO_SOURCE, sandbox, { filename: 'apps/studio/mcp-remote.js' });
  const internals = (sandbox.window as { __mcpRemoteInternals?: Record<string, unknown> }).__mcpRemoteInternals;
  assert.ok(internals, 'internals exposés');
  const classify = internals!['classifyOutcome'] as (status: number, payload: unknown) => { kind: string };
  const clock = internals!['confirmationClock'] as (expiresAt: number, nowMs: number) => { state: string };
  const canonical = internals!['canonicalForUi'] as (value: unknown) => string;

  assert.equal(classify(409, { error: { code: 'MCP_REMOTE_DRIFT', message: 'Confirmation expirée : opération refusée' } }).kind, 'confirmation_expired');
  assert.equal(classify(409, { error: { code: 'MCP_REMOTE_DRIFT', message: 'Confirmation déjà consommée : rejeu refusé' } }).kind, 'confirmation_used');
  assert.equal(classify(409, { error: { code: 'MCP_REMOTE_DRIFT', message: 'Confirmation non liée' } }).kind, 'binding_mismatch');
  assert.equal(classify(409, { error: { code: 'MCP_REMOTE_DRIFT', message: 'Connecteur désactivé : exécution refusée' } }).kind, 'connector_disabled');
  assert.equal(classify(409, { error: { code: 'MCP_REMOTE_DRIFT', message: "Schéma de l'outil dérivé" } }).kind, 'schema_drift');
  assert.equal(classify(409, { error: { code: 'MCP_REMOTE_DRIFT', message: 'URL du connecteur modifiée' } }).kind, 'url_changed');
  assert.equal(classify(502, { error: { code: 'MCP_REMOTE_UNREACHABLE', message: 'x' } }).kind, 'transport');
  assert.equal(classify(504, { error: { code: 'MCP_REMOTE_TIMEOUT', message: 'x' } }).kind, 'transport_timeout');
  assert.equal(classify(401, null).kind, 'auth_required');
  assert.equal(classify(403, null).kind, 'forbidden');
  assert.equal(classify(404, null).kind, 'not_found');
  assert.equal(classify(400, null).kind, 'invalid_input');
  assert.equal(classify(413, null).kind, 'args_too_large');
  assert.equal(classify(429, null).kind, 'rate_limited');
  assert.equal(classify(503, null).kind, 'config');

  assert.equal(clock(1500, 1000).state, 'active');
  assert.equal(clock(1000, 1000).state, 'expired');
  assert.equal(clock(999, 1000).state, 'expired');

  assert.equal(canonical({ b: 1, a: 2 }), canonical({ a: 2, b: 1 }), 'ordre des clés sans effet');
  assert.notEqual(canonical({ a: [1, 2] }), canonical({ a: [2, 1] }), 'ordre des éléments distinct');
  assert.equal(canonical({ nest: { deep: {} } }), canonical({ nest: { deep: {} } }), 'stable sur nid profonde');
});

/* ---------------------------------------------------------------------------
 * VA-12 — Non-régression Studio : warning du naming et garde-tampon du fichier existant
 * ------------------------------------------------------------------------- */
test('B4-11 · non-régression Studio : preview-builder-app.js inchangé, index.html greffe minimale', () => {
  const previewAppPath = join(REPO_ROOT, 'apps', 'studio', 'preview-builder-app.js');
  const previewAppSource = readFileSync(previewAppPath, 'utf8');
  const previewSha = createHash('sha256').update(previewAppSource).digest('hex');
  assert.equal(previewSha.toUpperCase(), PREVIEW_APP_SHA256_EXPECTED, 'preview-builder-app.js rigoureusement inchangé (B4 n\u2019y touche PAS)');

  const htmlPath = join(REPO_ROOT, 'apps', 'studio', 'index.html');
  const htmlSource = readFileSync(htmlPath, 'utf8');
  const occurrences = htmlSource.split('mcp-remote.js').length - 1;
  assert.equal(occurrences, 1, 'une seule référence à mcp-remote.js dans index.html (script tag)');
  assert.ok(htmlSource.includes('<script src="mcp-remote.js" defer></script>'), 'greffe : script tag unique');
  // Le module ne remplace aucun markup du Studio : il s'attache en bout de body
  assert.ok(htmlSource.trimEnd().endsWith('</html>'), 'index.html toujours bien formé (fin inchangée)');
});
