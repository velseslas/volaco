/**
 * MCP-C3.5 — Studio : page « Serveurs MCP » (Paramètres → Serveurs MCP).
 *
 * Mandat : expérience claire et minimaliste de gestion des serveurs MCP
 * distants, construite UNIQUEMENT sur les contrats backend existants :
 *
 *   - CRUD et états         : /api/v1/mcp/remote-servers        (C3.2, stricte,
 *                             vue légère + lastTest = état de connexion) ;
 *   - test de connexion     : POST /api/v1/mcp-remote/connectors/:id/test
 *                             (acte de gestion OWNER, autorisé sur désactivé) ;
 *   - découverte / politique : /api/v1/mcp-remote/connectors/:id/tools
 *                             (+ /approve, /revoke — OWNER, jamais automatique) ;
 *   - exécution confirmée   : /prepare → confirmation humaine → /call
 *                             (OWNER/ADMIN, JWT-only, usage unique, 15 min) ;
 *   - journal               : /api/v1/mcp-remote/journal (tous rôles).
 *
 * Découplage volontaire : ce module n'importe RIEN du module panneau
 * historique (surface protégée B4) ; il redéfinit localement ses petits
 * helpers purs (duplicat justifié, ~60 lignes).
 *
 * Sécurité DOM (héritage B4) :
 *   - Tout contenu distant (noms, descriptions, résultats, erreurs) est rendu
 *     EXCLUSIVEMENT via textContent d'éléments créés explicitement ;
 *     AUCUN innerHTML, AUCUN gestionnaire inline, AUCUNE URL distante chargée
 *     comme ressource (les attributions src/href sont interdites) ;
 *   - AUCUN secret affiché : la présence de clé est signalée
 *     « présente / absente », jamais sa valeur.
 *
 * Le backend reste l'AUTORITÉ : les masquages de boutons par rôle ici sont
 * seulement cosmétiques (UX) ; la mécanique réelle est imposée par le serveur
 * (RBAC, DENY par défaut, confirmations d'usage unique).
 *
 * Le module est autonome et testé par un sandbox vm avec faux DOM
 * (mcp-remote-studio-c35.test) : il ne suppose que window/document/fetch
 * et tolère l'absence de localStorage/atob.
 */
(function () {
  'use strict';

  /* -------------------------------------------------------------------------
   * Contrats (surface réelle du backend — rien d'inventé)
   * ---------------------------------------------------------------------- */
  var SERVERS_BASE = '/api/v1/mcp/remote-servers';
  var CONNECTORS_BASE = '/api/v1/mcp-remote/connectors';
  var JOURNAL_PATH = '/api/v1/mcp-remote/journal';
  var AUTH_LOGIN_PATH = '/api/v1/auth/login';
  var AUTH_SIGNUP_PATH = '/api/v1/auth/signup';
  var TOKEN_KEY = 'vibecode_auth_token'; // clé existante du Studio (session partagée)
  var CONFIRM_TTL_MS_HINT = 15 * 60 * 1000;

  /* -------------------------------------------------------------------------
   * Helpers DOM purs
   * ---------------------------------------------------------------------- */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (typeof className === 'string') node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }
  /** Élément masqué togglé par reassignation complète du className (pas de classList). */
  function setVisible(node, baseClass, visible) {
    node.className = baseClass + (visible ? '' : ' hidden');
  }

  var PILL_OK = 'text-[9px] px-2 py-0.5 rounded-full font-bold bg-emerald-950/60 text-emerald-300 border border-emerald-900/40';
  var PILL_INFO = 'text-[9px] px-2 py-0.5 rounded-full font-bold bg-white/[0.06] text-slate-300 border border-white/10';
  var PILL_WARN = 'text-[9px] px-2 py-0.5 rounded-full font-bold bg-amber-950/60 text-amber-300 border border-amber-900/40';
  var PILL_ERR = 'text-[9px] px-2 py-0.5 rounded-full font-bold bg-rose-950/60 text-rose-300 border border-rose-900/40';
  var PILL_MUTED = 'text-[9px] px-2 py-0.5 rounded-full font-bold bg-slate-800 text-slate-400';

  function statusPill(text, cls) {
    return el('span', cls || PILL_INFO, String(text));
  }
  function infoLine(labelText, valueText) {
    var row = el('div', 'flex items-start gap-2 flex-wrap');
    row.appendChild(el('span', 'text-[10px] text-slate-500 shrink-0', String(labelText) + ' :'));
    row.appendChild(el('span', 'text-[10px] text-slate-200 break-all', valueText === undefined || valueText === null || valueText === '' ? '—' : String(valueText)));
    return row;
  }
  function noteBlock(text, extraClass) {
    return el('p', 'text-[10px] leading-relaxed ' + (extraClass || 'text-slate-500'), String(text));
  }
  function button(labelText, cls, listener, disabled) {
    var b = el('button', cls || BTN_SOFT, String(labelText));
    if (disabled) b.disabled = true;
    if (listener) b.addEventListener('click', listener);
    return b;
  }
  var BTN_SOFT = 'px-3 py-1.5 rounded-lg bg-[#141a24] hover:bg-[#1a2130] border border-[#20273a] text-slate-200 text-[11px] font-semibold transition';
  var BTN_PRIMARY = 'px-3.5 py-1.5 rounded-lg bg-[#1d2433] hover:bg-[#232c40] border border-[#2f3a4e] text-white text-[11px] font-semibold transition';
  var BTN_DANGER = 'px-3 py-1.5 rounded-lg bg-rose-950/50 hover:bg-rose-900/50 border border-rose-900/40 text-rose-200 text-[11px] font-semibold transition';
  var BTN_GHOST = 'px-3 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.07] text-[11px] transition';
  var CARD = 'rounded-xl border border-[#1a2138] bg-[#0b0e1b] p-3 space-y-2';
  var SECTION_TITLE = 'text-xs font-semibold text-white';
  var FORM_WRAP_CLS = 'rounded-xl border border-[#1a2138] bg-[#0b0e1b] p-4 space-y-3';
  var MODAL_CLS = 'fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4';

  /* -------------------------------------------------------------------------
   * Helpers purs (duplicat local, indépendant du module B4)
   * ---------------------------------------------------------------------- */
  /** JSON canonique stable (clés triées) — calcule l'égalité EXACTE des arguments. */
  function canonical(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value === undefined ? null : value);
    if (typeof value === 'number') return JSON.stringify(Number.isFinite(value) ? value : null);
    if (Array.isArray(value)) return '[' + value.map(function (item) { return canonical(item); }).join(',') + ']';
    if (typeof value === 'object') {
      var keys = Object.keys(value).sort();
      return '{' + keys.map(function (k) { return JSON.stringify(k) + ':' + canonical(value[k]); }).join(',') + '}';
    }
    return JSON.stringify(value);
  }

  /** Horloge de confirmation : 'active' tant que expiresAt est strictement futur. */
  function confirmationClock(expiresAt, now) {
    return { state: Number(expiresAt) > now ? 'active' : 'expired' };
  }

  /**
   * Classification d'un refus d'exécution (code HTTP + message serveur réel) :
   * traduit le refus du backend en libellé humain stable. Aucune fabrication.
   */
  function classifyCallFailure(status, payload) {
    var error = payload && typeof payload === 'object' && payload.error && typeof payload.error === 'object'
      ? payload.error : null;
    var message = error && typeof error.message === 'string' ? error.message : '';
    var code = error && typeof error.code === 'string' ? error.code : '';
    if (status === 409 && code === 'MCP_REMOTE_DRIFT') {
      if (message.indexOf('expirée') !== -1) return 'confirmation_expired';
      if (message.indexOf('consommée') !== -1 || message.indexOf('rejeu') !== -1) return 'confirmation_used';
      if (message.indexOf('modifié') !== -1 || message.indexOf('liaison') !== -1) return 'binding_mismatch';
      if (message.indexOf('désactivé') !== -1) return 'connector_disabled';
      if (message.indexOf('chéma') !== -1) return 'schema_drift';
      if (message.indexOf('URL') !== -1) return 'url_changed';
      return 'drift_other';
    }
    if (code === 'MCP_REMOTE_TIMEOUT' || status === 504) return 'transport_timeout';
    if (code === 'MCP_REMOTE_UNREACHABLE' || status === 502) return 'transport';
    if (status === 401) return 'auth_required';
    if (status === 403) return 'forbidden';
    if (status === 404) return 'not_found';
    if (status === 400) return 'invalid_input';
    if (status === 413) return 'args_too_large';
    if (status === 429) return 'rate_limited';
    return 'server_error';
  }

  var CALL_FAILURE_LABELS = {
    confirmation_expired: 'Confirmation expirée',
    confirmation_used: 'Confirmation déjà utilisée',
    binding_mismatch: 'Arguments modifiés (liaison refusée)',
    connector_disabled: 'Connecteur désactivé',
    schema_drift: 'Schéma de l\'outil dérivé',
    url_changed: 'URL du connecteur modifiée',
    drift_other: 'Refus du backend (incohérence)',
    transport: 'Cible injoignable',
    transport_timeout: 'Délai dépassé',
    auth_required: 'Session requise ou expirée',
    forbidden: 'Droits insuffisants',
    not_found: 'Introuvable',
    invalid_input: 'Requête invalide',
    args_too_large: 'Arguments trop volumineux',
    rate_limited: 'Trop de tentatives, réessayez plus tard',
    server_error: 'Erreur du serveur'
  };

  /** Codes transport du backend → libellés humains. */
  var TRANSPORT_LABELS = {
    MCP_REMOTE_TIMEOUT: 'Délai dépassé',
    TIMEOUT: 'Délai dépassé',
    MCP_REMOTE_UNREACHABLE: 'Cible injoignable',
    CONNECT_ERROR: 'Connexion refusée',
    TLS_FAILURE: 'Échec TLS (certificat)',
    DNS_POLICY: 'Cible refusée par la politique réseau',
    DNS_FAILURE: 'Nom de domaine introuvable',
    REDIRECT_POLICY: 'Redirection refusée par la politique',
    PROTOCOL_UNSUPPORTED: 'Protocole non pris en charge',
    JSONRPC_INVALID_RESPONSE: 'Réponse invalide du serveur MCP',
    JSONRPC_PROTOCOL_ERROR: 'Protocole JSON-RPC refusé',
    AUTH_REQUIRED: 'Authentification demandée par le serveur distant',
    AUTHORIZE_FAILED: 'Autorisation refusée par le serveur distant',
    SSRF_POLICY: 'Cible refusée par la politique réseau',
    PAYLOAD_LIMIT: 'Réponse trop volumineuse',
    INVALID_URL: 'URL refusée'
  };
  function humanTransportKind(code) {
    if (typeof code !== 'string' || code === '') return 'Erreur réseau';
    return TRANSPORT_LABELS[code] || 'Erreur réseau';
  }

  /**
   * Validation d'URL côté client (UX) — miroir SIMPLIFIÉ des règles réseau du
   * backend (SSRF C3.3) : scheme http(s), hôte non vide, refus des évidences
   * privées littérales. Le serveur revalide TOUT (DNS, IP réellement connectée,
   * redirections) et reste seul à décider.
   */
  function urlLooksSharable(raw) {
    if (typeof raw !== 'string') return 'URL requise.';
    var trimmed = raw.trim();
    if (trimmed.length === 0) return 'URL requise.';
    if (trimmed.length > 2048) return 'URL trop longue (maximum 2048 caractères).';
    if (!/^https?:\/\//i.test(trimmed)) return 'L\'URL doit commencer par https:// (ou http:// pour un réseau local de test).';
    if (/\s/.test(trimmed) || /"/.test(trimmed) || /'/.test(trimmed)) return 'URL invalide (espaces ou guillemets interdits).';
    var afterScheme = trimmed.replace(/^https?:\/\//i, '');
    var hostPort = afterScheme.split('/')[0].split('?')[0].split('#')[0];
    var host = (hostPort.split('@').pop().split(':')[0] || '').toLowerCase();
    if (host.indexOf('[') === 0) {
      var closing = host.indexOf(']');
      var v6 = closing === -1 ? host.slice(1) : host.slice(1, closing);
      if (v6 === '::1' || /^f[cd]/.test(v6)) return 'Cible interdite : adresse réseau privée.';
    } else if (host === '') {
      return 'URL invalide (hôte manquant).';
    } else if (host === 'localhost' || /\.local$|\.internal$|\.lan$/.test(host)) {
      return 'Cible interdite : hôte local.';
    } else if (/\.\./.test(host) || /^[0-9.]+$/.test(host)) {
      var parts = host.split('.');
      if (parts.length === 4) {
        var a = Number(parts[0]);
        var b = Number(parts[1]);
        if (a === 10 || a === 127 || a === 0 || a >= 224) return 'Cible interdite : adresse réseau privée.';
        if (a === 192 && b === 168) return 'Cible interdite : adresse réseau privée.';
        if (a === 172 && b >= 16 && b <= 31) return 'Cible interdite : adresse réseau privée.';
        if (a === 169 && b === 254) return 'Cible interdite : adresse lien-local.';
      }
    }
    return '';
  }

  /* -------------------------------------------------------------------------
   * État local
   * ---------------------------------------------------------------------- */
  var state = {
    accessToken: '',
    role: 'UNKNOWN', // cosmétique : le vrai rôle vient du JWT signé / réponse de connexion
    email: '', tenantId: '', userId: '',
    servers: [],
    serversLoading: false,
    listingError: '',
    testingId: '',
    testNotes: {},
    selectedId: '',
    tools: [], toolConnector: null, toolState: '',
    toolInvalidCount: 0, toolTruncatedCount: 0,
    prepared: null,     // { connectorId, serverName, toolName, argsText, args, confirmation, manual }
    confirmExpired: false,
    callOutcome: { visible: false, kind: '', title: '', detail: '' },
    journTrail: [], journalTotal: null, journalError: ''
  };

  function canManage() { return state.role === 'OWNER'; }                 // cosmétique ; serveur = autorité
  function canInvoke() { return state.role === 'OWNER' || state.role === 'ADMIN'; }
  function knownRole() { return state.role !== 'UNKNOWN'; }

  /* -------------------------------------------------------------------------
   * Session (JWT réel ; jamais d'en-têtes de repli spoofables)
   * ---------------------------------------------------------------------- */
  function readStoredToken() {
    try {
      if (typeof localStorage === 'undefined') return '';
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch (tokenError) { return ''; }
  }
  function storeToken(token) {
    try {
      if (typeof localStorage === 'undefined') return;
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (writeError) { /* sandbox / lecture seule : sans effet */ }
  }
  /** Décode le payload d'un JWT (lecture pure — aucun eval). */
  function decodeJwtPayload(token) {
    try {
      if (typeof atob !== 'function') return null;
      var parts = String(token).split('.');
      if (parts.length < 2) return null;
      var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4 !== 0) b64 += '=';
      var payload = JSON.parse(atob(b64));
      return payload && typeof payload === 'object' ? payload : null;
    } catch (decodeError) { return null; }
  }
  function applyToken(token, userFromLogin) {
    state.accessToken = token || '';
    state.role = 'UNKNOWN';
    state.email = ''; state.tenantId = ''; state.userId = '';
    var payload = decodeJwtPayload(token);
    if (payload) {
      state.userId = typeof payload.sub === 'string' ? payload.sub : '';
      if (payload.role === 'OWNER' || payload.role === 'ADMIN' || payload.role === 'ENGINEER' || payload.role === 'VIEWER') {
        state.role = payload.role;
      }
      state.tenantId = typeof payload.tenantId === 'string' ? payload.tenantId : '';
      state.email = typeof payload.email === 'string' ? payload.email : '';
    }
    if (userFromLogin && typeof userFromLogin === 'object') {
      if (typeof userFromLogin.email === 'string') state.email = userFromLogin.email;
      if (userFromLogin.role === 'OWNER' || userFromLogin.role === 'ADMIN' || userFromLogin.role === 'ENGINEER' || userFromLogin.role === 'VIEWER') {
        state.role = userFromLogin.role;
      }
      if (typeof userFromLogin.tenantId === 'string') state.tenantId = userFromLogin.tenantId;
    }
  }
  function setSession(token, userFromLogin) {
    storeToken(token);
    applyToken(token, userFromLogin);
    renderAll();
    loadServers();
    loadJournal();
  }
  function clearSession() {
    storeToken('');
    applyToken('', null);
    resetData();
    renderAll();
  }

  /* -------------------------------------------------------------------------
   * Transport HTTP (Bearer de la session du Studio)
   * ---------------------------------------------------------------------- */
  function apiFetch(path, init) {
    var headers = { 'Content-Type': 'application/json' };
    if (state.accessToken) headers['Authorization'] = 'Bearer ' + state.accessToken;
    var merged = { method: 'GET', headers: headers };
    if (init && typeof init === 'object') {
      if (typeof init.method === 'string') merged.method = init.method;
      if (init.body !== undefined) merged.body = JSON.stringify(init.body);
    }
    return fetch(path, merged).then(function (res) {
      return res.text().then(function (payloadText) {
        var parsed = null;
        try { parsed = payloadText ? JSON.parse(payloadText) : null; } catch (parseError) { parsed = null; }
        return { status: res.status, body: parsed };
      });
    });
  }

  /** Libellé humain d'une erreur API (le message réel du serveur reste la source). */
  function describeApiError(status, body) {
    if (status === 401) return 'Session requise ou expirée (connectez-vous).';
    if (status === 403) return 'Droits insuffisants pour cette action.';
    if (status === 404) return 'Introuvable.';
    if (status === 429) return 'Trop de tentatives, réessayez plus tard.';
    if (body && body.error && typeof body.error.message === 'string') return body.error.message;
    if (status >= 500) return 'Erreur du serveur.';
    return 'Requête refusée.';
  }
  function refreshSessionFromCondition(outcome) {
    if (outcome && outcome.status === 401) {
      clearSession();
      flashStatus('Session expirée — reconnectez-vous.');
    }
  }

  /* -------------------------------------------------------------------------
   * Références DOM
   * ---------------------------------------------------------------------- */
  var refs = {
    root: null, sessionCard: null, sessionStatus: null, loginEmail: null, loginPassword: null,
    content: null, identity: null, serversNote: null, serversList: null,
    addBtn: null, formWrap: null, formTitle: null, formStatus: null, formHint: null,
    formName: null, formUrl: null, formSecret: null,
    journalList: null,
    confirmModal: null, confirmPanel: null, confirmServer: null, confirmTool: null,
    confirmDescrip: null, confirmWhy: null, confirmArgsEcho: null, confirmArgsInput: null,
    manualNameWrap: null, manualNameInput: null,
    confirmExpiry: null, confirmBanner: null,
    prepareBtn: null, confirmBtn: null, cancelBtn: null,
    callOutcome: null, statusLine: null
  };
  var formContext = { mode: 'add', targetId: '' };
  var confirmClockInterval = null;

  function ensureRoot() {
    var existing = document.getElementById('mcpHubMount');
    if (existing) return existing;
    var created = el('div', '', '');
    created.id = 'mcpHubMount';
    document.body.appendChild(created);
    return created;
  }

  function mountUi() {
    refs.root = ensureRoot();
    clearNode(refs.root);

    var shell = el('section', 'space-y-5');
    refs.root.appendChild(shell);

    // En-tête de page
    shell.appendChild(el('h3', 'text-lg font-bold text-white', 'Serveurs MCP'));
    shell.appendChild(el('p', 'text-xs text-slate-400 mt-1',
      'Outils distants de votre espace. Chaque exécution demande une confirmation humaine ; le serveur backend applique les règles, indépendamment de cette interface.'));

    // État global annoncé (aria-live)
    refs.statusLine = el('p', 'text-[11px] text-amber-300', '');
    refs.statusLine.setAttribute('role', 'status');
    shell.appendChild(refs.statusLine);

    // Ligne d'identité
    refs.identity = el('div', 'flex items-center gap-2 flex-wrap');
    refs.identity.id = 'mcpHubIdentity';
    shell.appendChild(refs.identity);

    // Carte de session (sans jeton)
    refs.sessionCard = el('div', CARD);
    refs.sessionCard.id = 'mcpHubSession';
    refs.sessionCard.appendChild(el('div', SECTION_TITLE, 'Connecter une session'));
    refs.sessionCard.appendChild(noteBlock(
      'Toute action passe par l\'API du backend avec votre session signée (JWT). Le jeton reste dans le navigateur ; rien n\'est partagé avec cette page au-delà.'));
    var loginFields = el('div', 'space-y-2');
    var emailRow = el('label', 'block space-y-1');
    emailRow.appendChild(el('span', 'text-[10px] text-slate-400', 'Adresse e-mail'));
    refs.loginEmail = el('input', 'w-full bg-[#070912] border border-[#181d30] focus:border-[#2f3a4e] rounded-lg px-3 py-1.5 text-white text-xs');
    refs.loginEmail.id = 'mcpHubLoginEmail';
    refs.loginEmail.setAttribute('type', 'email');
    refs.loginEmail.setAttribute('autocomplete', 'email');
    refs.loginEmail.setAttribute('placeholder', 'vous@exemple.fr');
    emailRow.appendChild(refs.loginEmail);
    loginFields.appendChild(emailRow);
    var passwordRow = el('label', 'block space-y-1');
    passwordRow.appendChild(el('span', 'text-[10px] text-slate-400', 'Mot de passe'));
    refs.loginPassword = el('input', 'w-full bg-[#070912] border border-[#181d30] focus:border-[#2f3a4e] rounded-lg px-3 py-1.5 text-white text-xs');
    refs.loginPassword.id = 'mcpHubLoginPassword';
    refs.loginPassword.setAttribute('type', 'password');
    refs.loginPassword.setAttribute('autocomplete', 'current-password');
    refs.loginPassword.setAttribute('placeholder', '8 caractères minimum');
    passwordRow.appendChild(refs.loginPassword);
    loginFields.appendChild(passwordRow);
    refs.sessionCard.appendChild(loginFields);
    refs.statusSessionActions = el('div', 'flex items-center gap-2 flex-wrap');
    refs.statusSessionActions.appendChild(button('Se connecter', BTN_PRIMARY, function () { submitConnect(AUTH_LOGIN_PATH, 'Connexion'); }));
    refs.statusSessionActions.appendChild(button('Créer un compte', BTN_SOFT, function () { submitConnect(AUTH_SIGNUP_PATH, 'Création'); }));
    refs.sessionCard.appendChild(refs.statusSessionActions);
    refs.sessionStatus = el('p', 'text-[10px] text-rose-300', '');
    refs.sessionStatus.id = 'mcpHubSessionStatus';
    refs.sessionCard.appendChild(refs.sessionStatus);
    refs.sessionCard.appendChild(noteBlock(
      'Mot de passe : 8 caractères minimum. La création de compte ouvre un espace dédié (comportement réel du serveur).'));
    shell.appendChild(refs.sessionCard);

    // Contenu principal (avec jeton)
    refs.content = el('div', 'space-y-4 hidden');
    refs.content.id = 'mcpHubContent';

    // Liste des serveurs ------------------------------------------------
    var serversHead = el('div', 'flex items-center justify-between gap-3 flex-wrap');
    var serversHeadLeft = el('div', 'space-y-0.5');
    serversHeadLeft.appendChild(el('div', SECTION_TITLE, 'Serveurs distants de votre espace'));
    refs.serversNote = el('p', 'text-[10px] text-slate-500', '');
    serversHeadLeft.appendChild(refs.serversNote);
    serversHead.appendChild(serversHeadLeft);
    var serversHeadActions = el('div', 'flex items-center gap-2');
    serversHeadActions.appendChild(button('Rafraîchir', BTN_GHOST, function () { loadServers(); }));
    refs.addBtn = button('Ajouter un serveur', BTN_PRIMARY, function () { openAddForm(); });
    refs.addBtn.id = 'mcpHubAddBtn';
    serversHeadActions.appendChild(refs.addBtn);
    serversHead.appendChild(serversHeadActions);
    refs.content.appendChild(serversHead);

    refs.serversList = el('div', 'space-y-3');
    refs.serversList.id = 'mcpHubServers';
    refs.content.appendChild(refs.serversList);

    // Formulaire d'ajout / modification ----------------------------------
    refs.formWrap = el('div', FORM_WRAP_CLS + ' hidden');
    refs.formWrap.id = 'mcpHubForm';
    refs.formTitle = el('div', SECTION_TITLE, 'Ajouter un serveur MCP distant');
    refs.formWrap.appendChild(refs.formTitle);
    refs.formWrap.appendChild(noteBlock(
      'URL du transport HTTP du serveur MCP. Aucune autre option : le transport est fixé par le backend. Le serveur revalide la cible (politique réseau) et refuse si nécessaire.'));
    var nameRow = el('label', 'block space-y-1');
    nameRow.appendChild(el('span', 'text-[10px] text-slate-400', 'Nom affiché'));
    refs.formName = el('input', 'w-full bg-[#070912] border border-[#181d30] focus:border-[#2f3a4e] rounded-lg px-3 py-1.5 text-white text-xs');
    refs.formName.setAttribute('maxlength', '200');
    refs.formName.setAttribute('placeholder', 'ex. : Automatisation marketing');
    refs.formName.id = 'mcpHubFormName';
    nameRow.appendChild(refs.formName);
    refs.formWrap.appendChild(nameRow);
    var urlRow = el('label', 'block space-y-1');
    urlRow.appendChild(el('span', 'text-[10px] text-slate-400', 'URL du serveur (https recommandé)'));
    refs.formUrl = el('input', 'w-full bg-[#070912] border border-[#181d30] focus:border-[#2f3a4e] rounded-lg px-3 py-1.5 text-white text-xs font-mono');
    refs.formUrl.setAttribute('placeholder', 'https://serveur.exemple.fr/mcp');
    refs.formUrl.setAttribute('spellcheck', 'false');
    refs.formUrl.id = 'mcpHubFormUrl';
    urlRow.appendChild(refs.formUrl);
    refs.formWrap.appendChild(urlRow);
    var secretRow = el('label', 'block space-y-1');
    secretRow.appendChild(el('span', 'text-[10px] text-slate-400', 'Clé d\'accès (optionnel, jamais réaffichée)'));
    refs.formSecret = el('input', 'w-full bg-[#070912] border border-[#181d30] focus:border-[#2f3a4e] rounded-lg px-3 py-1.5 text-white text-xs');
    refs.formSecret.setAttribute('type', 'password');
    refs.formSecret.setAttribute('autocomplete', 'new-password');
    refs.formSecret.setAttribute('placeholder', 'laisser vide pour ne rien changer');
    refs.formSecret.id = 'mcpHubFormSecret';
    secretRow.appendChild(refs.formSecret);
    refs.formWrap.appendChild(secretRow);
    refs.formHint = noteBlock('Nouvelle clé optionnelle.', 'text-slate-400');
    refs.formWrap.appendChild(refs.formHint);
    refs.formStatus = el('p', 'text-[10px] text-rose-300', '');
    refs.formWrap.appendChild(refs.formStatus);
    var formActions = el('div', 'flex items-center gap-2 flex-wrap');
    var formSubmit = button('Enregistrer', BTN_PRIMARY, function () { submitServerForm(); });
    formSubmit.id = 'mcpHubFormSubmit';
    formActions.appendChild(formSubmit);
    formActions.appendChild(button('Annuler', BTN_GHOST, function () { closeServerForm(); }));
    refs.formWrap.appendChild(formActions);
    refs.content.appendChild(refs.formWrap);

    // Journal --------------------------------------------------------------
    var journalHead = el('div', 'flex items-center justify-between gap-3 flex-wrap');
    var journalHeadLeft = el('div', 'space-y-0.5');
    journalHeadLeft.appendChild(el('div', SECTION_TITLE, 'Journal des opérations'));
    journalHeadLeft.appendChild(el('p', 'text-[10px] text-slate-500',
      'Historique de l\'espace : créations, tests, autorisations, exécutions et refus enregistrés par le backend.'));
    journalHead.appendChild(journalHeadLeft);
    var journalRefresh = button('Rafraîchir le journal', BTN_GHOST, function () { loadJournal(); });
    journalRefresh.id = 'mcpHubJournalRefresh';
    journalHead.appendChild(journalRefresh);
    refs.content.appendChild(journalHead);
    refs.journalWrap = el('div', 'rounded-xl border border-[#1a2138] bg-[#0b0e1b] p-3');
    refs.journalList = el('div', 'space-y-2');
    refs.journalList.id = 'mcpHubJournalList';
    refs.journalWrap.appendChild(refs.journalList);
    refs.content.appendChild(refs.journalWrap);

    // Note catalogue (inerte, aucune donnée inventée)
    refs.content.appendChild(catalogueNote());

    shell.appendChild(refs.content);

    // Modale d'exécution confirmée ----------------------------------------
    refs.confirmModal = el('div', MODAL_CLS + ' hidden');
    refs.confirmModal.id = 'mcpHubConfirmModal';
    refs.confirmModal.setAttribute('role', 'dialog');
    refs.confirmModal.setAttribute('aria-modal', 'true');
    refs.confirmPanel = el('div', 'w-full max-w-lg rounded-2xl border border-[#20273a] bg-[#0b0e1b] p-5 space-y-3 shadow-2xl');
    refs.confirmModal.appendChild(refs.confirmPanel);
    refs.confirmPanel.appendChild(el('div', SECTION_TITLE, 'Utiliser un outil distant'));
    refs.confirmServer = el('div', 'text-[11px] text-slate-300', '');
    refs.confirmServer.id = 'mcpHubConfirmServer';
    refs.confirmPanel.appendChild(refs.confirmServer);
    refs.confirmTool = el('div', 'text-[11px] text-slate-300', '');
    refs.confirmTool.id = 'mcpHubConfirmTool';
    refs.confirmPanel.appendChild(refs.confirmTool);
    refs.manualNameWrap = el('div', 'space-y-1 hidden');
    refs.manualNameWrap.appendChild(el('span', 'text-[10px] text-slate-400', 'Nom exact de l\'outil (mode manuel)'));
    refs.manualNameInput = el('input', 'w-full bg-[#070912] border border-[#181d30] focus:border-[#2f3a4e] rounded-lg px-3 py-1.5 text-white text-xs font-mono');
    refs.manualNameInput.setAttribute('spellcheck', 'false');
    refs.manualNameInput.setAttribute('placeholder', 'nom_outil');
    refs.manualNameInput.id = 'mcpHubManualName';
    refs.manualNameWrap.appendChild(refs.manualNameInput);
    refs.manualNameInput.addEventListener('input', function () { onArgsInput(); });
    refs.confirmPanel.appendChild(refs.manualNameWrap);
    refs.confirmDescrip = el('p', 'text-[10px] text-slate-400 break-all', '');
    refs.confirmDescrip.id = 'mcpHubConfirmDescrip';
    refs.confirmPanel.appendChild(refs.confirmDescrip);
    refs.confirmWhy = noteBlock(
      'Demande du backend : confirmation humaine unique, valable 15 minutes, liée EXACTEMENT aux paramètres ci-dessous et au schéma actuel de l\'outil. Toute modification des paramètres invalide la confirmation. Rien ne s\'exécute tant que vous n\'avez pas confirmé.');
    refs.confirmPanel.appendChild(refs.confirmWhy);
    refs.confirmPanel.appendChild(el('span', 'text-[10px] text-slate-400', 'Paramètres exacts de l\'appel'));
    refs.confirmArgsEcho = el('pre', 'text-[10px] font-mono text-slate-200 bg-[#070912] border border-[#181d30] rounded-lg p-2.5 whitespace-pre-wrap break-all', '');
    refs.confirmArgsEcho.id = 'mcpHubArgsEcho';
    refs.confirmPanel.appendChild(refs.confirmArgsEcho);
    refs.confirmPanel.appendChild(el('span', 'text-[10px] text-slate-400', 'Vérification des paramètres (identiques à ceux affichés)'));
    refs.confirmArgsInput = el('textarea', 'w-full h-24 bg-[#070912] border border-[#181d30] focus:border-[#2f3a4e] rounded-lg px-3 py-2 text-[11px] font-mono text-white');
    refs.confirmArgsInput.setAttribute('spellcheck', 'false');
    refs.confirmArgsInput.id = 'mcpHubExecArgs';
    refs.confirmArgsInput.addEventListener('input', function () { onArgsInput(); });
    refs.confirmPanel.appendChild(refs.confirmArgsInput);
    refs.confirmExpiry = el('p', 'text-[10px] text-slate-400', '');
    refs.confirmExpiry.id = 'mcpHubExpirySlot';
    refs.confirmPanel.appendChild(refs.confirmExpiry);
    refs.confirmBanner = el('p', 'text-[10px] text-rose-300', '');
    refs.confirmBanner.id = 'mcpHubArgsMismatch';
    refs.confirmPanel.appendChild(refs.confirmBanner);
    var modalActions = el('div', 'flex items-center gap-2 flex-wrap');
    refs.prepareBtn = button('Préparer la confirmation', BTN_PRIMARY, function () { prepareConfirmation(); });
    refs.prepareBtn.id = 'mcpHubPrepareBtn';
    modalActions.appendChild(refs.prepareBtn);
    refs.confirmBtn = button('Confirmer et exécuter', BTN_PRIMARY, function () { dispatchConfirmedCall(); });
    refs.confirmBtn.id = 'mcpHubConfirmBtn';
    modalActions.appendChild(refs.confirmBtn);
    refs.cancelBtn = button('Fermer', BTN_GHOST, function () { closePreparation(); });
    refs.cancelBtn.id = 'mcpHubCancelBtn';
    modalActions.appendChild(refs.cancelBtn);
    refs.confirmPanel.appendChild(modalActions);
    refs.callOutcome = el('div', 'space-y-2', '');
    refs.callOutcome.id = 'mcpHubCallOutcome';
    refs.confirmPanel.appendChild(refs.callOutcome);
    shell.appendChild(refs.confirmModal);
  }

  /** Note catalogue global : information honnête, AUCUN bouton du côté utilisateur. */
  function catalogueNote() {
    var wrap = el('div', 'rounded-xl border border-[#1a2138] bg-[#0b0e1b] p-4 space-y-1');
    wrap.appendChild(el('div', SECTION_TITLE, 'Catalogue global de la plateforme'));
    wrap.appendChild(noteBlock(
      'Un catalogue de serveurs administré par la plateforme arrivera ultérieurement : vous pourrez y parcourir des serveurs officiels et les activer pour votre compte. Aucun serveur de catalogue n\'est proposé pour l\'instant — rien n\'est simulé ici.'));
    wrap.appendChild(noteBlock(
      'À savoir : les serveurs que vous ajoutez aujourd\'hui sont partagés au sein de votre espace. Des importations strictement personnelles (visibles de vous seul) sont prévues à l\'avenir.'));
    return wrap;
  }

  /* -------------------------------------------------------------------------
   * Session UI
   * ---------------------------------------------------------------------- */
  function submitConnect(path, verbLabel) {
    refs.sessionStatus.textContent = '';
    var email = (refs.loginEmail.value || '').trim();
    var password = refs.loginPassword.value || '';
    if (!email || password.length < 8) {
      refs.sessionStatus.textContent = 'Adresse e-mail et mot de passe (8 caractères minimum) requis.';
      return;
    }
    refs.sessionStatus.textContent = 'Connexion en cours…';
    apiFetch(path, { method: 'POST', body: { email: email, password: password } })
      .then(function (outcome) {
        var body = outcome.body;
        var token = body && typeof body.token === 'string' ? body.token : '';
        var user = body && body.user && typeof body.user === 'object' ? body.user : null;
        if (outcome.status === 200 && token) {
          refs.sessionStatus.textContent = '';
          setSession(token, user);
          flashStatus('Session active.');
          return;
        }
        refs.sessionStatus.textContent = describeApiError(outcome.status, body) || (verbLabel + ' refusé.');
      })
      .catch(function () {
        refs.sessionStatus.textContent = 'Connexion impossible (service indisponible).';
      });
  }

  function flashStatus(text) {
    if (refs.statusLine) refs.statusLine.textContent = String(text);
  }

  function resetData() {
    state.servers = [];
    state.selectedId = '';
    state.tools = []; state.toolConnector = null; state.toolState = '';
    state.prepared = null;
    state.confirmExpired = false;
    state.callOutcome = { visible: false, kind: '', title: '', detail: '' };
    state.journTrail = []; state.journalTotal = null; state.journalError = '';
    state.testingId = ''; state.testNotes = {};
    state.listingError = '';
  }

  function loadServers() {
    if (!state.accessToken) return;
    state.serversLoading = true; state.listingError = '';
    renderServers();
    apiFetch(SERVERS_BASE, {})
      .then(function (outcome) {
        state.serversLoading = false;
        if (outcome.status === 200 && outcome.body && Array.isArray(outcome.body.servers)) {
          state.servers = outcome.body.servers;
          state.listingError = '';
        } else {
          state.listingError = describeApiError(outcome.status, outcome.body);
          if (outcome.status === 401) {
            refreshSessionFromCondition(outcome);
          }
        }
        renderAll();
      })
      .catch(function () {
        state.serversLoading = false;
        state.listingError = 'Service indisponible momentanément.';
        renderAll();
      });
  }

  function loadJournal() {
    if (!state.accessToken) return;
    state.journalError = '';
    renderJournal();
    apiFetch(JOURNAL_PATH + '?limit=50', {})
      .then(function (outcome) {
        if (outcome.status === 200 && outcome.body && Array.isArray(outcome.body.events)) {
          state.journTrail = outcome.body.events;
          state.journalTotal = typeof outcome.body.total === 'number' ? outcome.body.total : outcome.body.events.length;
          state.journalError = '';
        } else {
          state.journTrail = [];
          state.journalError = describeApiError(outcome.status, outcome.body);
          if (outcome.status === 401) refreshSessionFromCondition(outcome);
        }
        renderJournal();
      })
      .catch(function () {
        state.journTrail = [];
        state.journalError = 'Journal indisponible momentanément.';
        renderJournal();
      });
  }

  /* -------------------------------------------------------------------------
   * Rendus
   * ---------------------------------------------------------------------- */
  function renderAll() {
    if (!refs.root || !refs.content) return;
    var hasSession = state.accessToken !== '';
    setVisible(refs.sessionCard, CARD, !hasSession);
    setVisible(refs.content, 'space-y-4', hasSession);
    renderIdentity();
    renderServers();
    renderJournal();
  }

  function renderIdentity() {
    if (!refs.identity) return;
    clearNode(refs.identity);
    refs.identity.appendChild(el('span', 'text-[10px] text-slate-500', 'Session :'));
    if (!state.accessToken) {
      refs.identity.appendChild(statusPill('NON CONNECTÉ', PILL_MUTED));
      return;
    }
    var who = state.email || (state.userId ? state.userId : 'session active');
    refs.identity.appendChild(el('span', 'text-[10px] font-mono text-slate-200', who));
    var roleText = knownRole() ? state.role : 'RÔLE NON LU (le serveur arbitre)';
    refs.identity.appendChild(statusPill(roleText, PILL_INFO));
    if (state.tenantId) refs.identity.appendChild(el('span', 'text-[10px] text-slate-500', 'espace : ' + state.tenantId));
    if (canManage()) refs.identity.appendChild(el('span', 'text-[9px] text-slate-500', '· gestion complète'));
    else if (canInvoke()) refs.identity.appendChild(el('span', 'text-[9px] text-slate-500', '· exécution d\'outils autorisée'));
    else if (knownRole()) refs.identity.appendChild(el('span', 'text-[9px] text-slate-500', '· consultation seule'));
    refs.identity.appendChild(button('Se déconnecter', BTN_GHOST, function () { clearSession(); }));
  }

  function serversRoleNote() {
    if (!knownRole()) return '';
    if (canManage()) return 'Vous gérez les serveurs de l\'espace : ajout, modification, test, autorisations.';
    if (canInvoke()) return 'Vous pouvez exécuter des outils autorisés (saisie manuelle du nom) ; la configuration est réservée au gestionnaire.';
    return 'Consultation seule : le serveur refuse toute modification à votre rôle.';
  }

  function connexionPillFor(server) {
    var id = String(server.connectorId || '');
    if (state.testingId === id) return statusPill('CONNEXION EN COURS', PILL_WARN);
    var note = state.testNotes[id];
    if (note && note.ok === true) return statusPill('CONNECTÉ' + (note.serverName ? ' · ' + note.serverName : ''), PILL_OK);
    if (note && note.ok === false) return statusPill('ÉCHEC — ' + humanTransportKind(note.code), PILL_ERR);
    var last = server.lastTest;
    if (last && last.status === 'OK') return statusPill('CONNECTÉ', PILL_OK);
    if (last && last.status === 'FAILED') return statusPill('ÉCHEC — ' + humanTransportKind(last.detail), PILL_ERR);
    return statusPill('CONNEXION NON TESTÉE', PILL_MUTED);
  }

  function renderServers() {
    if (!refs.serversList) return;
    clearNode(refs.serversList);
    if (refs.addBtn) refs.addBtn.disabled = !canManage() && knownRole();
    if (refs.serversNote) refs.serversNote.textContent = serversRoleNote();
    if (!state.accessToken) return;
    if (state.serversLoading) {
      refs.serversList.appendChild(el('div', 'text-[11px] text-slate-400', 'Chargement des serveurs…'));
      return;
    }
    if (state.listingError) {
      refs.serversList.appendChild(el('div', 'text-[11px] text-rose-300', state.listingError));
      return;
    }
    if (state.servers.length === 0) {
      var emptyBox = el('div', CARD);
      emptyBox.appendChild(el('div', 'text-[11px] font-semibold text-white', 'Aucun serveur configuré.'));
      emptyBox.appendChild(noteBlock(
        canManage()
          ? 'Ajoutez un serveur MCP distant pour connecter des outils à votre espace.'
          : 'Seuls les gestionnaires de l\'espace peuvent ajouter des serveurs.'));
      refs.serversList.appendChild(emptyBox);
      return;
    }
    for (var i = 0; i < state.servers.length; i++) {
      refs.serversList.appendChild(buildServerCard(state.servers[i]));
    }
  }

  function buildServerCard(server) {
    var card = el('div', CARD);
    var id = String(server.connectorId || '');

    var head = el('div', 'flex items-center gap-2 flex-wrap');
    head.appendChild(el('span', 'text-[11px] font-bold text-white', String(server.name || '—')));
    if (server.enabled === false) head.appendChild(statusPill('DÉSACTIVÉ', PILL_MUTED));
    else head.appendChild(statusPill('ACTIF', PILL_INFO));
    head.appendChild(connexionPillFor(server));
    card.appendChild(head);

    card.appendChild(infoLine('URL', String(server.url || '—')));
    card.appendChild(infoLine('Clé d\'accès', server.secretPresent ? 'présente (jamais affichée)' : 'absente'));
    var last = server.lastTest;
    if (last && last.status === 'FAILED' && last.detail) {
      card.appendChild(infoLine('Dernier échec de test', humanTransportKind(last.detail)));
    } else if (last && last.status === 'OK') {
      card.appendChild(infoLine('Dernier test', 'réussi'));
    }

    var actions = el('div', 'flex items-center gap-2 flex-wrap');
    if (canManage()) {
      var testingNow = state.testingId === id;
      actions.appendChild(button(testingNow ? 'Vérification…' : 'Tester la connexion', BTN_SOFT, function () { testConnection(server); }, testingNow));
      actions.appendChild(button('Modifier', BTN_GHOST, function () { openEditForm(server); }));
      actions.appendChild(button(server.enabled === false ? 'Activer' : 'Désactiver', BTN_SOFT, function () { toggleEnabled(server); }));
      actions.appendChild(button('Supprimer', BTN_DANGER, function () { deleteServer(server); }));
      actions.appendChild(button(state.selectedId === id ? 'Fermer les outils' : 'Voir les outils (découverte)', BTN_GHOST, function () { toggleTools(server); }));
    }
    if (canInvoke() && !canManage()) {
      // ADMIN : la découverte est OWNER-only au backend ; exécution manuelle du nom d'outil.
      var manualBtn = button('Appeler un outil (manuel)', BTN_SOFT, function () { openPreparation(server, null); });
      manualBtn.id = 'mcpHubManualBtn';
      actions.appendChild(manualBtn);
    }
    if (knownRole() && !canManage() && !canInvoke()) {
      actions.appendChild(el('span', 'text-[9px] text-slate-500', 'aucune action de modification pour votre rôle'));
    }
    if (!knownRole()) {
      actions.appendChild(el('span', 'text-[9px] text-slate-500', 'rôle non lu : le serveur authentifie chaque action'));
    }
    card.appendChild(actions);

    var note = state.testNotes[id];
    if (note && note.text) {
      card.appendChild(el('p', 'text-[10px] ' + (note.ok ? 'text-emerald-300' : 'text-rose-300'), String(note.text)));
    }

    if (state.selectedId === id) {
      var toolsZone = el('div', 'rounded-lg border border-[#161b28] bg-[#080a14] p-3 space-y-2');
      toolsZone.id = 'mcpHubToolsZone';
      renderToolsZoneInto(toolsZone, server);
      card.appendChild(toolsZone);
    }
    return card;
  }

  /* -------------------------------------------------------------------------
   * Formulaire d'ajout / modification (OWNER — serveur revalide tout)
   * ---------------------------------------------------------------------- */
  function openAddForm() {
    formContext = { mode: 'add', targetId: '' };
    refs.formTitle.textContent = 'Ajouter un serveur MCP distant';
    refs.formName.value = '';
    refs.formUrl.value = '';
    refs.formSecret.value = '';
    refs.formHint.textContent = 'Nouvelle clé optionnelle : saisir une valeur si (et seulement si) le serveur distant en exige une.';
    refs.formStatus.textContent = '';
    setVisible(refs.formWrap, FORM_WRAP_CLS, true);
    if (refs.formName.focus) refs.formName.focus();
  }

  function openEditForm(server) {
    formContext = { mode: 'edit', targetId: String(server.connectorId || '') };
    refs.formTitle.textContent = 'Modifier un serveur';
    refs.formName.value = String(server.name || '');
    refs.formUrl.value = String(server.url || '');
    refs.formSecret.value = '';
    refs.formHint.textContent = String(
      (server.secretPresent
        ? 'Une clé est enregistrée : laissez le champ vide pour la conserver, saisissez une valeur pour la remplacer. La valeur existante n\'est jamais affichée. '
        : 'Aucune clé enregistrée : saisissez une valeur si le serveur distant en exige une. ') +
      'Changer l\'URL révoque, côté backend, les autorisations d\'outils liées à l\'ancienne cible.');
    refs.formStatus.textContent = '';
    setVisible(refs.formWrap, FORM_WRAP_CLS, true);
  }

  function closeServerForm() {
    setVisible(refs.formWrap, FORM_WRAP_CLS, false);
    formContext = { mode: 'add', targetId: '' };
  }

  function findServer(connectorId) {
    for (var i = 0; i < state.servers.length; i++) {
      if (String(state.servers[i].connectorId) === String(connectorId)) return state.servers[i];
    }
    return null;
  }

  function submitServerForm() {
    refs.formStatus.textContent = '';
    var name = (refs.formName.value || '').trim();
    var url = (refs.formUrl.value || '').trim();
    var secretRaw = refs.formSecret.value || '';
    if (!name) { refs.formStatus.textContent = 'Nom requis.'; return; }
    var urlProblem = urlLooksSharable(url);
    if (urlProblem) { refs.formStatus.textContent = urlProblem; return; }

    if (formContext.mode === 'add') {
      var body = { name: name, url: url, transport: 'url' };
      if (secretRaw) body.secret = secretRaw;
      apiFetch(SERVERS_BASE, { method: 'POST', body: body })
        .then(function (outcome) {
          if (outcome.status === 201 || outcome.status === 200) {
            closeServerForm();
            flashStatus('Serveur ajouté. Testez la connexion.');
            loadServers();
          } else {
            refreshSessionFromCondition(outcome);
            refs.formStatus.textContent = describeApiError(outcome.status, outcome.body);
          }
        })
        .catch(function () {
          refs.formStatus.textContent = 'Service indisponible momentanément.';
        });
      return;
    }

    // Modification : PATCH minimal — le secret n'est envoyé QUE si une nouvelle valeur est saisie.
    var target = findServer(formContext.targetId);
    var urlChanged = Boolean(target && String(target.url || '') !== '' && String(target.url || '') !== url);
    var patch = { name: name };
    if (urlChanged) patch.url = url; // implicite côté backend : révocation atomique des politiques
    if (secretRaw) patch.secret = secretRaw;

    var proceed = true;
    if (urlChanged && typeof window.confirm === 'function') {
      proceed = window.confirm(
        'Changer l\'URL invalide les outils autorisés sur l\'ancienne cible (révocation automatique par le backend). Continuer ?');
    }
    if (!proceed) { refs.formStatus.textContent = 'Modification annulée.'; return; }

    apiFetch(SERVERS_BASE + '/' + encodeURIComponent(formContext.targetId), { method: 'PATCH', body: patch })
      .then(function (outcome) {
        if (outcome.status === 200) {
          closeServerForm();
          var note = 'Serveur modifié.';
          if (outcome.body && Array.isArray(outcome.body.revokedToolNames) && outcome.body.revokedToolNames.length > 0) {
            note += ' Autorisations révoquées par le backend : ' + outcome.body.revokedToolNames.length + '.';
          }
          if (outcome.body && typeof outcome.body.invalidatedConfirmations === 'number' && outcome.body.invalidatedConfirmations > 0) {
            note += ' Confirmations en attente invalidées : ' + outcome.body.invalidatedConfirmations + '.';
          }
          flashStatus(note);
          loadServers();
        } else {
          refreshSessionFromCondition(outcome);
          refs.formStatus.textContent = describeApiError(outcome.status, outcome.body);
        }
      })
      .catch(function () {
        refs.formStatus.textContent = 'Service indisponible momentanément.';
      });
  }

  /* -------------------------------------------------------------------------
   * Test de connexion — POST /connectors/:id/test (réel, OWNER)
   * ---------------------------------------------------------------------- */
  function testConnection(server) {
    var id = String(server.connectorId || '');
    if (state.testingId) return; // un test à la fois
    if (!state.accessToken) return;
    state.testingId = id;
    state.testNotes[id] = {};
    flashStatus('');
    refs.formStatus.textContent = '';
    renderServers(); // état « CONNEXION EN COURS » immédiat (avant toute réponse)
    apiFetch(CONNECTORS_BASE + '/' + encodeURIComponent(id) + '/test', { method: 'POST', body: {} })
      .then(function (outcome) {
        state.testingId = '';
        var body = outcome.body;
        if (outcome.status === 200 && body && body.ok === true) {
          state.testNotes[id] = {
            ok: true,
            serverName: body.serverName ? String(body.serverName) : '',
            text: 'Test réussi' +
              (body.serverName ? ' · ' + body.serverName : '') +
              (body.serverVersion ? ' v' + body.serverVersion : '') +
              (body.protocolVersion ? ' · protocole ' + body.protocolVersion : '')
          };
          flashStatus('Connexion réussie.');
        } else if (outcome.status === 200 && body && body.ok === false && body.error) {
          var code = typeof body.error.code === 'string' ? body.error.code : 'CONNECT_ERROR';
          state.testNotes[id] = { ok: false, code: code, text: 'Connexion refusée : ' + humanTransportKind(code) + '.' };
          flashStatus('Connexion échouée — ' + humanTransportKind(code) + '.');
        } else {
          state.testNotes[id] = {};
          refreshSessionFromCondition(outcome);
          flashStatus(describeApiError(outcome.status, body));
        }
        loadServers(); // synchronise le dernier état de test PERSISTANT (source officielle)
        renderServers();
      })
      .catch(function () {
        state.testingId = '';
        state.testNotes[id] = { ok: false, code: 'MCP_REMOTE_UNREACHABLE', text: 'Test impossible (service indisponible).' };
        renderServers();
      });
  }

  /* -------------------------------------------------------------------------
   * Activation / suppression
   * ---------------------------------------------------------------------- */
  function toggleEnabled(server) {
    var id = String(server.connectorId || '');
    var next = server.enabled === false;
    apiFetch(SERVERS_BASE + '/' + encodeURIComponent(id), { method: 'PATCH', body: { enabled: next } })
      .then(function (outcome) {
        if (outcome.status === 200) {
          flashStatus(next ? 'Serveur activé.' : 'Serveur désactivé : aucun outil ne s\'exécutera tant qu\'il est désactivé.');
          loadServers();
        } else {
          refreshSessionFromCondition(outcome);
          flashStatus(describeApiError(outcome.status, outcome.body));
        }
      })
      .catch(function () { flashStatus('Service indisponible momentanément.'); });
  }

  function deleteServer(server) {
    var id = String(server.connectorId || '');
    if (typeof window.confirm === 'function') {
      var go = window.confirm('Supprimer définitivement ce serveur et ses autorisations d\'outils ?');
      if (!go) { flashStatus('Suppression annulée.'); return; }
    }
    apiFetch(SERVERS_BASE + '/' + encodeURIComponent(id), { method: 'DELETE' })
      .then(function (outcome) {
        if (outcome.status === 200) {
          if (state.selectedId === id) state.selectedId = '';
          flashStatus('Serveur supprimé.');
          loadServers();
          loadJournal();
        } else {
          refreshSessionFromCondition(outcome);
          flashStatus(describeApiError(outcome.status, outcome.body));
        }
      })
      .catch(function () { flashStatus('Service indisponible momentanément.'); });
  }

  /* -------------------------------------------------------------------------
   * Découverte des outils (OWNER) — n'approuve RIEN, n'exécute RIEN
   * ---------------------------------------------------------------------- */
  function toggleTools(server) {
    var id = String(server.connectorId || '');
    if (state.selectedId === id) {
      state.selectedId = '';
      state.tools = []; state.toolConnector = null; state.toolState = '';
      renderServers();
      return;
    }
    state.selectedId = id;
    state.tools = [];
    state.toolConnector = null;
    state.toolInvalidCount = 0; state.toolTruncatedCount = 0;
    state.toolState = 'Chargement des outils…';
    renderServers();
    apiFetch(CONNECTORS_BASE + '/' + encodeURIComponent(id) + '/tools', {})
      .then(function (outcome) {
        if (outcome.status === 200 && outcome.body && Array.isArray(outcome.body.tools)) {
          state.tools = outcome.body.tools;
          state.toolConnector = outcome.body.connector && typeof outcome.body.connector === 'object' ? outcome.body.connector : null;
          state.toolInvalidCount = Number(outcome.body.schemaInvalidCount) || 0;
          state.toolTruncatedCount = Number(outcome.body.displayTruncatedCount) || 0;
          state.toolState = state.tools.length === 0 ? 'Aucun outil proposé par ce serveur.' : '';
        } else {
          state.tools = [];
          state.toolConnector = null;
          if (outcome.status === 401) refreshSessionFromCondition(outcome);
          state.toolState = describeApiError(outcome.status, outcome.body);
        }
        renderServers();
      })
      .catch(function () {
        state.toolState = 'Service indisponible momentanément.';
        renderServers();
      });
  }

  function renderToolsZoneInto(zone, server) {
    clearNode(zone);
    var suffix = state.toolConnector && state.toolConnector.enabled === false ? ' — serveur désactivé' : '';
    zone.appendChild(el('div', 'text-[10px] font-semibold text-slate-300', 'Outils proposés' + suffix));
    if (state.toolState) zone.appendChild(el('p', 'text-[10px] text-slate-400', state.toolState));
    if (state.toolInvalidCount > 0) {
      zone.appendChild(el('p', 'text-[10px] text-amber-300',
        String(state.toolInvalidCount) + ' outil(s) au schéma refusé par sécurité (non autorisables).'));
    }
    if (state.toolTruncatedCount > 0) {
      zone.appendChild(el('p', 'text-[10px] text-amber-300',
        String(state.toolTruncatedCount) + ' outil(s) trop volumineux pour l\'affichage (non affichés).'));
    }
    for (var i = 0; i < state.tools.length; i++) {
      zone.appendChild(buildToolCard(state.tools[i], server));
    }
  }

  /** Reflète EXACTEMENT le champ approval renvoyé par le serveur (aucune invention). */
  function approvalPillFor(approval, schemaStatus) {
    if (schemaStatus === 'INVALID') return statusPill('SCHÉMA REFUSÉ (SÉCURITÉ)', PILL_ERR);
    if (schemaStatus === 'DISPLAY_TRUNCATED') return statusPill('TROP GRAND POUR L\'AFFICHAGE', PILL_WARN);
    var approvalStatus = approval && typeof approval === 'object' ? approval.status : null;
    if (!approvalStatus) return statusPill('NON AUTORISÉ', PILL_MUTED);
    if (approvalStatus === 'REVOKED') return statusPill('AUTORISATION RÉVOQUÉE', PILL_ERR);
    if (approval.status === 'APPROVED' && approval.drift === true) return statusPill('SCHÉMA DÉRIVÉ — À RÉAUTORISER', PILL_WARN);
    return statusPill('AUTORISÉ', PILL_OK);
  }

  function toolIsUsable(entry, server) {
    var approval = entry.approval && typeof entry.approval === 'object' ? entry.approval : null;
    return Boolean(
      server && server.enabled !== false &&
      entry.schemaStatus === 'OK' &&
      approval && approval.status === 'APPROVED' && approval.drift !== true
    );
  }

  function buildToolCard(entry, server) {
    var card = el('div', CARD);
    var approval = entry.approval && typeof entry.approval === 'object' ? entry.approval : null;

    var head = el('div', 'flex items-center gap-2 flex-wrap');
    head.appendChild(el('span', 'text-[11px] font-bold text-white font-mono', String(entry.toolName || '—')));
    head.appendChild(approvalPillFor(entry.approval, entry.schemaStatus));
    card.appendChild(head);

    var description = typeof entry.description === 'string' && entry.description !== ''
      ? entry.description
      : (typeof entry.title === 'string' ? entry.title : '');
    card.appendChild(el('p', 'text-[10px] text-slate-300 break-words', description || 'Pas de description fournie.'));
    if (approval && typeof approval.approvedAt === 'string') {
      card.appendChild(infoLine('Dernier état connu — autorisé le', approval.approvedAt));
    }
    card.appendChild(el('p', 'text-[9px] text-slate-500', 'Exécution : toujours précédée d\'une confirmation humaine unique (imposée par le backend).'));

    var actions = el('div', 'flex items-center gap-2 flex-wrap');
    if (canManage()) {
      var approvalStatus = approval ? approval.status : null;
      if (entry.schemaStatus === 'INVALID') {
        card.appendChild(el('p', 'text-[10px] text-rose-300',
          'Autorisation impossible : le schéma de cet outil est refusé par le backend (sécurité).'));
      } else if (entry.schemaStatus === 'DISPLAY_TRUNCATED') {
        card.appendChild(el('p', 'text-[10px] text-rose-300',
          'Autorisation impossible : le schéma dépasse la limite d\'écriture sécurisée (refusé par le backend).'));
      } else if (approvalStatus === 'APPROVED' && approval && approval.drift !== true) {
        actions.appendChild(button('Révoquer l\'autorisation', BTN_DANGER, function () { revokeTool(server, String(entry.toolName)); }));
      } else {
        actions.appendChild(button(
          (approvalStatus === 'APPROVED' && approval && approval.drift === true) ? 'Réautoriser' : 'Autoriser',
          BTN_SOFT, function () { approveTool(server, String(entry.toolName)); }));
      }
    }
    if (canInvoke() && toolIsUsable(entry, server)) {
      var useBtn = button('Utiliser cet outil', BTN_PRIMARY, function () { openPreparation(server, entry); });
      useBtn.id = 'mcpHubUseToolBtn';
      actions.appendChild(useBtn);
    }
    if (actions.firstChild) card.appendChild(actions);
    return card;
  }

  function approveTool(server, toolName) {
    var id = String(server.connectorId || '');
    flashStatus('Autorisation en cours…');
    apiFetch(CONNECTORS_BASE + '/' + encodeURIComponent(id) + '/tools/' + encodeURIComponent(toolName) + '/approve', { method: 'POST', body: {} })
      .then(function (outcome) {
        if (outcome.status === 200) flashStatus('Autorisation enregistrée (empreinte recalculée par le serveur).');
        else {
          refreshSessionFromCondition(outcome);
          flashStatus(describeApiError(outcome.status, outcome.body));
        }
        state.toolState = '';
        reDiscoverQuietly(id);
      })
      .catch(function () { flashStatus('Service indisponible momentanément.'); state.toolState = ''; renderServers(); });
  }

  function revokeTool(server, toolName) {
    var id = String(server.connectorId || '');
    flashStatus('Révocation en cours…');
    apiFetch(CONNECTORS_BASE + '/' + encodeURIComponent(id) + '/tools/' + encodeURIComponent(toolName) + '/revoke', { method: 'POST' })
      .then(function (outcome) {
        if (outcome.status === 200) flashStatus('Autorisation révoquée : l\'outil ne s\'exécutera plus.');
        else {
          refreshSessionFromCondition(outcome);
          flashStatus(describeApiError(outcome.status, outcome.body));
        }
        state.toolState = '';
        reDiscoverQuietly(id);
      })
      .catch(function () { flashStatus('Service indisponible momentanément.'); state.toolState = ''; renderServers(); });
  }

  /** Re-découverte silencieuse pour refléter l'état RÉEL du serveur après une action. */
  function reDiscoverQuietly(id) {
    apiFetch(CONNECTORS_BASE + '/' + encodeURIComponent(id) + '/tools', {})
      .then(function (outcome) {
        if (outcome.status === 200 && outcome.body && Array.isArray(outcome.body.tools)) {
          state.tools = outcome.body.tools;
          state.toolInvalidCount = Number(outcome.body.schemaInvalidCount) || 0;
          state.toolTruncatedCount = Number(outcome.body.displayTruncatedCount) || 0;
        }
        renderServers();
      })
      .catch(function () { renderServers(); });
  }

  /* -------------------------------------------------------------------------
   * Préparation → confirmation humaine → exécution
   * ---------------------------------------------------------------------- */
  function openPreparation(server, entryOrNull) {
    closePreparation();
    state.prepared = {
      connectorId: String(server.connectorId || ''),
      serverName: String(server.name || 'serveur'),
      toolName: entryOrNull ? String(entryOrNull.toolName || '') : '',
      argsText: canonical({}),
      args: {},
      confirmation: null,
      manual: !entryOrNull
    };
    refs.confirmServer.textContent = 'Serveur : ' + state.prepared.serverName;
    refs.confirmTool.textContent = entryOrNull ? 'Outil : ' + state.prepared.toolName : 'Outil : (à saisir)';
    refs.confirmDescrip.textContent = entryOrNull && typeof entryOrNull.description === 'string' && entryOrNull.description !== '' &&
      entryOrNull.description !== (typeof entryOrNull.title === 'string' ? entryOrNull.title : '')
      ? 'Action : ' + entryOrNull.description
      : 'Action : exécution d\'un outil distant (description fournie par le serveur)';
    setVisible(refs.manualNameWrap, 'space-y-1', !entryOrNull);
    refs.manualNameInput.value = '';
    refs.confirmArgsEcho.textContent = formatArgsPreview({});
    refs.confirmArgsInput.value = '{}';
    refs.confirmBanner.textContent = '';
    refs.confirmExpiry.textContent = 'Confirmation n\'existe pas encore : préparez-la d\'abord.';
    state.confirmExpired = false;
    refs.prepareBtn.disabled = false;
    refs.confirmBtn.disabled = true;
    updatePrepareLock();
    closeCallOutcome();
    setVisible(refs.confirmModal, MODAL_CLS, true);
  }

  function formatArgsPreview(args) {
    try { return JSON.stringify(args, null, 2); } catch (previewError) { return String(args); }
  }

  function closePreparation() {
    stopConfirmClock();
    state.prepared = null;
    state.confirmExpired = false;
    closeCallOutcome();
    if (refs.confirmModal) setVisible(refs.confirmModal, MODAL_CLS, false);
    if (refs.prepareBtn) refs.prepareBtn.disabled = true;
    if (refs.confirmBtn) refs.confirmBtn.disabled = true;
    if (refs.confirmBanner) refs.confirmBanner.textContent = '';
    if (refs.confirmExpiry) refs.confirmExpiry.textContent = '';
  }

  function closeCallOutcome() {
    state.callOutcome = { visible: false, kind: '', title: '', detail: '' };
    if (refs.callOutcome) {
      refs.callOutcome.textContent = '';
      refs.callOutcome.className = 'space-y-2';
    }
  }

  /** Verrou du bouton PRÉPARER : args JSON valides (+ nom d'outil en mode manuel). */
  function updatePrepareLock() {
    if (!refs.prepareBtn) return;
    var parsed = parseArgsText(refs.confirmArgsInput.value || '');
    var toolReady = true;
    if (state.prepared && state.prepared.manual) {
      toolReady = (refs.manualNameInput.value || '').trim() !== '';
    }
    refs.prepareBtn.disabled = Boolean(parsed.error) || !toolReady;
    if (state.prepared && !state.prepared.confirmation) {
      refs.confirmBanner.textContent = parsed.error || '';
    }
  }

  function onArgsInput() {
    if (state.prepared && state.prepared.confirmation) {
      refreshConfirmLock();
    } else {
      updatePrepareLock();
    }
  }

  function parseArgsText(raw) {
    var text = String(raw == null ? '' : raw).trim();
    if (text === '') return { error: 'Paramètres requis (objet JSON, ex. : {}).', args: null };
    try {
      var parsed = JSON.parse(text);
    } catch (parseError) {
      return { error: 'Paramètres invalides : JSON attendu (un objet, ex. : {}).', args: null };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: 'Paramètres invalides : un objet JSON est requis.', args: null };
    }
    return { error: '', args: parsed };
  }

  /** POST /prepare — émis UNIQUEMENT au clic explicite ; aucun tools/call ici. */
  function prepareConfirmation() {
    if (!state.prepared) return;
    var toolName = state.prepared.manual
      ? (refs.manualNameInput.value || '').trim()
      : state.prepared.toolName;
    if (!toolName) { refs.confirmBanner.textContent = 'Nom de l\'outil requis (mode manuel).'; return; }
    var parsed = parseArgsText(refs.confirmArgsInput.value || '');
    if (parsed.error) { refs.confirmBanner.textContent = parsed.error; return; }

    refs.confirmBanner.textContent = '';
    refs.prepareBtn.disabled = true;
    flashStatus('Préparation en cours…');
    apiFetch(
      CONNECTORS_BASE + '/' + encodeURIComponent(state.prepared.connectorId) + '/tools/' + encodeURIComponent(toolName) + '/prepare',
      { method: 'POST', body: { arguments: parsed.args } }
    )
      .then(function (outcome) {
        if (outcome.status === 201 && outcome.body && outcome.body.confirmation && typeof outcome.body.confirmation === 'object') {
          var confirmation = outcome.body.confirmation;
          state.prepared.confirmation = confirmation;
          state.prepared.toolName = toolName;
          state.prepared.args = parsed.args;
          state.prepared.argsText = canonical(parsed.args);
          refs.confirmTool.textContent = 'Outil : ' + toolName;
          refs.confirmArgsEcho.textContent = formatArgsPreview(parsed.args);
          refs.confirmBtn.disabled = true; // armée par le premier tick de l'horloge
          state.confirmExpired = false;
          startConfirmClock(confirmation);
          flashStatus('Confirmation préparée : vérifiez puis confirmez.');
          return;
        }
        refreshSessionFromCondition(outcome);
        refs.prepareBtn.disabled = false;
        var label = describeApiError(outcome.status, outcome.body);
        if (outcome.status === 403) label = 'Droits insuffisants : la préparation est réservée au gestionnaire et à ses délégués.';
        flashStatus('Préparation refusée — ' + label);
      })
      .catch(function () {
        refs.prepareBtn.disabled = false;
        flashStatus('Service indisponible momentanément.');
      });
  }

  function startConfirmClock(confirmation) {
    stopConfirmClock();
    var tick = function () {
      if (!state.prepared || !state.prepared.confirmation) { stopConfirmClock(); return; }
      var nowMs = Date.now();
      var clockState = confirmationClock(Number(confirmation.expiresAt), nowMs).state;
      if (clockState === 'expired') {
        state.confirmExpired = true;
        refs.confirmExpiry.textContent = 'Confirmation EXPIRÉE — préparez à nouveau.';
        refs.confirmExpiry.className = 'text-[10px] text-rose-300';
        refs.confirmBtn.disabled = true;
        stopConfirmClock();
        return;
      }
      var remaining = Number(confirmation.expiresAt) - nowMs;
      if (remaining > CONFIRM_TTL_MS_HINT) remaining = CONFIRM_TTL_MS_HINT;
      refs.confirmExpiry.textContent = 'Confirmation valable ~' + Math.ceil(remaining / 1000) + ' s.';
      refs.confirmExpiry.className = 'text-[10px] text-slate-400';
      state.confirmExpired = false;
      refreshConfirmLock();
    };
    tick(); // premier état immédiat (expiration immédiate incluse)
    if (typeof window.setInterval === 'function') {
      confirmClockInterval = window.setInterval(tick, 1000);
    }
  }

  function stopConfirmClock() {
    if (confirmClockInterval !== null && typeof window.clearInterval === 'function') {
      window.clearInterval(confirmClockInterval);
    }
    confirmClockInterval = null;
  }

  /** Verrou du bouton CONFIRMER : args canoniquement identiques + confirmation vivante. */
  function refreshConfirmLock() {
    if (!refs.confirmBtn || !state.prepared || !state.prepared.confirmation) return;
    var parsed = parseArgsText(refs.confirmArgsInput.value || '');
    var argsMatch = !parsed.error && canonical(parsed.args) === state.prepared.argsText;
    refs.confirmBtn.disabled = Boolean(parsed.error) || !argsMatch || state.confirmExpired;
    refs.confirmBanner.textContent = !argsMatch
      ? 'Paramètres modifiés (ou invalides) : rétablissez EXACTEMENT ceux affichés ci-dessus.'
      : '';
  }

  /** POST /call — UNIQUEMENT après /prepare + confirmation vivante + args identiques. */
  function dispatchConfirmedCall() {
    if (!state.prepared || !state.prepared.confirmation) return;
    var parsed = parseArgsText(refs.confirmArgsInput.value || '');
    if (parsed.error) { refs.confirmBanner.textContent = parsed.error; return; }
    if (canonical(parsed.args) !== state.prepared.argsText) {
      // Garde-fou local doublé par le backend (hash — refus définitif côté serveur).
      refs.confirmBanner.textContent = 'Paramètres modifiés : rétablissez EXACTEMENT ceux affichés.';
      return;
    }
    refs.confirmBtn.disabled = true;
    apiFetch(
      CONNECTORS_BASE + '/' + encodeURIComponent(state.prepared.connectorId) + '/tools/' + encodeURIComponent(state.prepared.toolName) + '/call',
      { method: 'POST', body: { confirmationId: state.prepared.confirmation.confirmationId, arguments: parsed.args } }
    )
      .then(function (outcome) {
        var body = outcome.body;
        if (outcome.status === 200 && body && body.result && typeof body.result === 'object') {
          var result = body.result;
          if (result.isError === true) {
            showCallOutcome('remote_error', 'Erreur métier DISTANTE (isError : true)',
              renderCallContentText(result) || 'Erreur signalée par le serveur distant.');
          } else {
            showCallOutcome('success', 'Exécution réussie — résultat réel :',
              renderCallContentText(result) || 'L\'outil n\'a renvoyé aucun contenu.');
          }
          return;
        }
        refreshSessionFromCondition(outcome);
        var kind = classifyCallFailure(outcome.status, body);
        var label = CALL_FAILURE_LABELS[kind] || 'Refus du backend.';
        var code = body && body.error && body.error.code ? ' (' + String(body.error.code) + ')' : '';
        showCallOutcome(kind, label + code,
          body && body.error && typeof body.error.message === 'string' ? body.error.message : '');
      })
      .catch(function () {
        showCallOutcome('transport', 'Transport impossible — état distant inconnu',
          'La requête n\'a pas abouti localement. Pour éviter un double appel, re-préparez une confirmation avant de réessayer.');
      });
  }

  /** Extraction TEXTE défensive d'un résultat MCP (jamais interprété, jamais HTML). */
  function renderCallContentText(result) {
    var chunks = [];
    var content = result && result.content;
    if (Array.isArray(content)) {
      for (var i = 0; i < content.length; i++) {
        var piece = content[i];
        if (piece && typeof piece === 'object') {
          if (typeof piece.text === 'string') chunks.push(piece.text);
          else chunks.push(JSON.stringify(piece));
        } else if (typeof piece === 'string') {
          chunks.push(piece);
        }
      }
    } else if (content !== undefined && content !== null) {
      chunks.push(JSON.stringify(content));
    }
    if (result && result.structuredContent !== undefined && result.structuredContent !== null) {
      chunks.push(JSON.stringify(result.structuredContent));
    }
    return chunks.join('\n');
  }

  function showCallOutcome(kind, title, detail) {
    state.callOutcome = { visible: true, kind: String(kind), title: String(title), detail: String(detail || '') };
    refs.callOutcome.textContent = '';
    var pillCls = kind === 'success' ? PILL_OK
      : (kind === 'remote_error' || kind === 'transport' || (kind && kind.indexOf('confirmation') === 0) ? PILL_ERR : PILL_WARN);
    refs.callOutcome.appendChild(statusPill(title, pillCls));
    if (detail) {
      refs.callOutcome.appendChild(el('pre', 'text-[10px] font-mono text-slate-200 bg-[#070912] border border-[#181d30] rounded-lg p-2.5 whitespace-pre-wrap break-all', String(detail)));
    }
  }

  /* -------------------------------------------------------------------------
   * Journal (libellés humains ; les données restent celles du serveur)
   * ---------------------------------------------------------------------- */
  var ACTION_LABELS = {
    MCP_REMOTE_CONNECTOR_CREATED: 'Serveur créé',
    MCP_REMOTE_CONNECTOR_UPDATED: 'Serveur mis à jour',
    MCP_REMOTE_CONNECTOR_DELETED: 'Serveur supprimé',
    MCP_REMOTE_CONNECTOR_SECRET_SET: 'Clé d\'accès enregistrée',
    MCP_REMOTE_CONNECTOR_SECRET_REMOVED: 'Clé d\'accès retirée',
    MCP_REMOTE_CONNECTION_TESTED: 'Test de connexion',
    MCP_REMOTE_TOOLS_DISCOVERED: 'Outils découverts',
    MCP_REMOTE_TOOL_APPROVED: 'Autorisation d\'outil accordée',
    MCP_REMOTE_TOOL_REVOKED: 'Autorisation d\'outil révoquée',
    MCP_REMOTE_TOOL_PREPARED: 'Exécution préparée',
    MCP_REMOTE_TOOL_CALLED: 'Outil exécuté',
    MCP_REMOTE_TOOL_CALL_FAILED: 'Exécution en échec',
    MCP_REMOTE_TOOLS_DISCOVERY_REFUSED: 'Découverte refusée',
    MCP_REMOTE_TOOL_APPROVE_REFUSED: 'Autorisation refusée',
    MCP_REMOTE_TOOL_REVOKE_REFUSED: 'Révocation refusée',
    MCP_REMOTE_TOOL_PREPARE_REFUSED: 'Préparation refusée',
    MCP_REMOTE_TOOL_CALL_REFUSED: 'Exécution refusée'
  };
  var REASON_LABELS = {
    PERMISSION_DENIED: 'droits insuffisants',
    CONNECTOR_NOT_FOUND: 'connecteur introuvable',
    INPUT_INVALID: 'entrée invalide',
    DISCOVERY_REFUSED: 'découverte refusée',
    TOOL_NOT_FOUND: 'outil introuvable',
    SCHEMA_INVALID: 'schéma refusé',
    APPROVAL_URL_DRIFT: 'URL modifiée pendant l\'autorisation',
    CONFIRMATION_EXPIRED: 'confirmation expirée',
    CONFIRMATION_CONSUMED: 'confirmation déjà utilisée',
    ARGS_DRIFT: 'arguments modifiés',
    SCHEMA_DRIFT: 'schéma de l\'outil dérivé',
    CONNECTOR_DISABLED: 'connecteur désactivé'
  };

  function renderJournal() {
    if (!refs.journalList) return;
    clearNode(refs.journalList);
    if (!state.accessToken) return;
    if (state.journalError) {
      refs.journalList.appendChild(el('div', 'text-[10px] text-rose-300', state.journalError));
      return;
    }
    if (state.journTrail.length === 0) {
      refs.journalList.appendChild(el('p', 'text-[10px] text-slate-500', 'Aucun événement enregistré.'));
      return;
    }
    for (var i = 0; i < state.journTrail.length; i++) {
      refs.journalList.appendChild(buildJournalRow(state.journTrail[i]));
    }
    if (state.journalTotal !== null && state.journalTotal > state.journTrail.length) {
      refs.journalList.appendChild(el('p', 'text-[9px] text-slate-500',
        'Total : ' + state.journalTotal + ' événements (derniers affichés).'));
    }
  }

  function buildJournalRow(event) {
    var row = el('div', 'rounded-lg border border-[#161b28] bg-[#080a14] p-2.5 space-y-1.5');
    var head = el('div', 'flex items-center gap-2 flex-wrap');
    var isRefusal = String(event.action || '').indexOf('REFUSED') !== -1;
    var status = String(event.status || '—');
    var pill = isRefusal ? statusPill('REFUS', PILL_ERR)
      : (status === 'SUCCESS' ? statusPill('OK', PILL_OK)
        : (status === 'FAILURE' ? statusPill('ÉCHEC', PILL_ERR) : statusPill(status, PILL_INFO)));
    head.appendChild(pill);
    head.appendChild(el('span', 'text-[10px] font-semibold text-slate-200',
      ACTION_LABELS[event.action] || String(event.action || '—')));
    if (event.timestamp) head.appendChild(el('span', 'text-[9px] font-mono text-slate-500', String(event.timestamp)));
    row.appendChild(head);

    if (isRefusal) {
      var reason = event.metadata && typeof event.metadata === 'object' && typeof event.metadata.reason === 'string'
        ? event.metadata.reason : '';
      row.appendChild(infoLine('Raison enregistrée', reason === '' ? '—' : (REASON_LABELS[reason] || reason)));
    }
    if (event.metadata && typeof event.metadata === 'object') {
      var meta = event.metadata;
      if (typeof meta.toolName === 'string') row.appendChild(infoLine('Outil', meta.toolName));
      if (status === 'FAILURE' && typeof meta.errorCode === 'string') {
        row.appendChild(infoLine('Cause technique', humanTransportKind(meta.errorCode) + ' (' + meta.errorCode + ')'));
      }
      if (typeof meta.ok === 'boolean') row.appendChild(infoLine('Test', meta.ok ? 'réussi' : 'échec'));
    }
    return row;
  }

  /* -------------------------------------------------------------------------
   * Démarrage
   * ---------------------------------------------------------------------- */
  function boot() {
    mountUi();
    var stored = readStoredToken();
    if (stored) {
      applyToken(stored, null);
      renderAll();
      loadServers();
      loadJournal();
    } else {
      renderAll();
    }
  }

  // Surface d'introspection pure pour les tests (aucun contenu sensible).
  window.__mcpHubInternals = {
    canonical: canonical,
    confirmationClock: confirmationClock,
    classifyCallFailure: classifyCallFailure,
    humanTransportKind: humanTransportKind,
    urlLooksSharable: urlLooksSharable,
    formatArgsPreview: formatArgsPreview
  };

  // DÉCONNEXION DU SHELL (menu utilisateur) — quand le Studio se déconnecte
  // (bouton « Déconnexion » du menu / du header, logoutAuth() dans
  // index.html), la session mémoire du hub doit partir aussi : sans cela ses
  // appels API continuaient avec un Bearer orphelin jusqu'au rechargement.
  // L'évènement est natif window (aucune dépendance inverse vers le shell).
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('vibecode:auth-logout', function () {
      if (state.accessToken || state.email || state.role || state.tenantId) {
        clearSession();
      }
    });
  }

  if (typeof document !== 'undefined') {
    boot();
  }
})();
