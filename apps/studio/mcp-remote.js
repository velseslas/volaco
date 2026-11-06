/**
 * C3.2-B4 — Studio : gestion des connecteurs MCP distants et exécution
 * confirmée d'outils.
 *
 * Périmètre (GO B4) :
 *   - consulter / créer / activer / désactiver / tester / supprimer un connecteur ;
 *   - découvrir les outils distants ; approuver / révoquer un outil ;
 *   - préparer une exécution (route /prepare, AUCUN tools/call) ;
 *   - confirmation humaine EXPlicite (connecteur + outil + arguments EXACTS de
 *     la préparation + expiration) ; exécution UNIQUEMENT après confirmation ;
 *   - états distincts : désactivé, inaccessible, découverte, non approuvé,
 *     révoqué, dérive de schéma, confirmation expirée / déjà utilisée,
 *     arguments modifiés, échec de transport, isError:true, succès.
 *
 * Sécurité DOM (GO §3) :
 *   - Tout contenu distant (schéma, description, résultats, messages d'erreur,
 *     noms, certificats) est rendu EXCLUSIVEMENT via textContent d'éléments
 *     créés explicitement. AUCUN innerHTML attribué, AUCUN gestionnaire
 *     d'événement construit à partir de données distantes, AUCUNE URL distante
 *     chargée comme ressource (src/href) — les URL sont inflt textuel.
 *   - Secrets : jamais affichés après saisie (champs vides après envoi),
 *     jamais journalisés dans la console. Arguments et résultats distants
 *     ne sont jamais loggés.
 *
 * Authentification (contrats réels du backend, D7) :
 *   - POST /api/v1/auth/login {email,password} / signup → {token,user} (JWT
 *     signé, prioritaire côté serveur) : requis pour TOUTE gestion
 *     (TENANT_MANAGE = OWNER) et TOUTE préparation/exécution
 *     (MCP_REMOTE_INVOKE = OWNER/ADMIN + identité individuelle JWT).
 *   - Sans JWT : lectures `PROJECT_READ` via les en-têtes dev notionnels déjà
 *     utilisés par le Studio (jamais d'élévation silencieuse) — la section
 *     affiche explicitement « Lecture seule ».
 *
 * Ce module N'AUCUN état d'exécution automatique : aucune route call n'est
 * appelée hors du gestionnaire de clic du bouton « Confirmer et exécuter ».
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') {
    // Hors navigateur (sandbox de tests purs) : rien à monter.
    return;
  }

  /* -------------------------------------------------------------------------
   * Constantes (contrats HTTP réels — routes C3.2 B1/B2/B3)
   * --------------------------------------------------------------------- */
  var API_BASE = '/api/v1/mcp-remote';
  var AUTH_LOGIN_PATH = '/api/v1/auth/login';
  var AUTH_SIGNUP_PATH = '/api/v1/auth/signup';
  var DEV_TENANT = 'studio-local';
  var DEV_ROLE = 'ENGINEER';
  /** TTL fixe du serveur (cap C3.1) — sert uniquement au libellé d'affichage. */
  var DISPLAY_TTL_HINT_MS = 15 * 60 * 1000;

  /* -------------------------------------------------------------------------
   * Helpers pure (exposés pour les tests headless hors navigateur)
   * --------------------------------------------------------------------- */

  /**
   * Chaîne canonique (clés triées récursivement, borée) — utilisée UNIQUEMENT
   * pour la comparaison d'affichage « arguments inchangés » côté navigateur.
   * Le serveur reste l'autorité finale (binding argsSha256 C3.1 au consume).
   */
  function canonicalForUi(value) {
    return canonicalValue(value, 0);
  }
  function canonicalValue(value, depth) {
    if (depth > 64) return '\u0000BORNE_PROFUNDEUR';
    if (value === null) return 'n';
    var valueType = typeof value;
    if (valueType === 'undefined') return 'u';
    if (valueType === 'number') {
      if (!isFinite(value)) return 'x:' + String(value);
      return '0:' + String(value === 0 && 1 / value === -Infinity ? '-0' : value);
    }
    if (valueType === 'boolean') return value ? '1' : '0';
    if (valueType === 'string') return 's:' + value.replace(/\\/g, '\\\\').replace(/\u001f/g, '\\u001f');
    if (Object.prototype.toString.call(value) === '[object Array]') {
      var parts = ['a'];
      for (var i = 0; i < value.length; i++) parts.push(canonicalValue(value[i], depth + 1));
      return parts.join('\u001f');
    }
    if (Object.prototype.toString.call(value) === '[object Object]') {
      var keys = Object.keys(value).sort();
      var parts2 = ['o'];
      for (var k = 0; k < keys.length; k++) {
        parts2.push(keys[k]);
        parts2.push(canonicalValue(value[keys[k]], depth + 1));
      }
      return parts2.join('\u001f');
    }
    // Fonctions / dates / autres : non sérialisables — rendu refusé à l'affiche.
    return 'f:' + String(Object.prototype.toString.call(value));
  }

  /** JSON lisible, borné — textContent uniquement (aucun HTML). */
  function prettyJson(value) {
    var text;
    try { text = JSON.stringify(value, null, 2); } catch (err) { text = String(value); }
    if (typeof text !== 'string') text = String(value);
    if (text.length > 10000) text = text.slice(0, 10000) + '\n… (tronqué pour affichage)';
    return text;
  }

  /**
   * Classification déterministe d'une réponse HTTP en état UI (GO §4).
   * Payload = corps JSON déjà décodé (peut être null/inattendu).
   */
  function classifyOutcome(status, payload) {
    var code = null;
    var message = null;
    if (payload && typeof payload === 'object' && payload.error && typeof payload.error === 'object') {
      code = typeof payload.error.code === 'string' ? payload.error.code : null;
      message = typeof payload.error.message === 'string' ? payload.error.message : null;
    }
    if (status >= 200 && status < 300) {
      return { kind: 'ok', label: 'Réponse OK', code: code, message: message, status: status };
    }
    var kind;
    if (status === 401) kind = 'auth_required';
    else if (status === 403) kind = 'forbidden';
    else if (status === 404) kind = 'not_found';
    else if (status === 429) kind = 'rate_limited';
    else if (status === 400) kind = 'invalid_input';
    else if (status === 413) kind = 'args_too_large';
    else if (status === 503) kind = 'config';
    else if (status === 502) kind = 'transport';
    else if (status === 504) kind = 'transport_timeout';
    else kind = 'http';

    if (code === 'MCP_REMOTE_DRIFT' && typeof message === 'string') {
      // Sous-états du drift (messages statiques serveur — correspondance exacte)
      if (message.indexOf('expirée') !== -1) return { kind: 'confirmation_expired', label: 'Confirmation expirée', code: code, message: message, status: status };
      if (message.indexOf('déjà consommée') !== -1) return { kind: 'confirmation_used', label: 'Confirmation déjà utilisée', code: code, message: message, status: status };
      if (message.indexOf('non liée') !== -1) return { kind: 'binding_mismatch', label: 'Arguments modifiés (liaison refusée)', code: code, message: message, status: status };
      if (message.indexOf('désactivé') !== -1) return { kind: 'connector_disabled', label: 'Connecteur désactivé', code: code, message: message, status: status };
      if (message.indexOf('dérivé') !== -1) return { kind: 'schema_drift', label: 'Schéma modifié (dérive)', code: code, message: message, status: status };
      if (message.indexOf('URL') !== -1) return { kind: 'url_changed', label: 'URL du connecteur modifiée', code: code, message: message, status: status };
      return { kind: 'drift_other', label: 'Dérive de contexte MCP distant', code: code, message: message, status: status };
    }
    var labels = {
      auth_required: 'Session JWT requise',
      forbidden: 'Droits insuffisants',
      not_found: 'Introuvable',
      rate_limited: 'Trop de tentatives',
      invalid_input: 'Requête invalide',
      args_too_large: 'Arguments trop volumineux',
      config: 'Configuration serveur indisponible',
      transport: 'Connecteur inaccessible',
      transport_timeout: 'Délai dépassé (transport)',
      http: 'Erreur HTTP'
    };
    return { kind: kind, label: labels[kind] || 'Erreur HTTP', code: code, message: message, status: status };
  }

  /** État d'une confirmation relative à l'horloge locale (affichage seulement). */
  function confirmationClock(expiresAt, nowMs) {
    var remaining = (typeof expiresAt === 'number' ? expiresAt : 0) - nowMs;
    if (remaining <= 0) return { state: 'expired', remainingMs: 0 };
    return { state: 'active', remainingMs: remaining };
  }

  /* -------------------------------------------------------------------------
   * État de session (en mémoire — jamais localStorage, jamais console)
   * --------------------------------------------------------------------- */
  var state = {
    session: { token: null, user: null }, // token JWT en mémoire (jamais persisté)
    connectors: [],
    selectedConnectorId: null,
    selectedConnector: null,
    tools: [],            // découverte courante du connecteur sélectionné
    preparingTool: null,  // { toolName } quand la forme de préparation est ouverte
    prepared: null,       // { connectorId, toolName, confirmation, args, argsCanonical }
    journal: [],
    identityError: null
  };
  var expiryTimer = null;

  function jwtActive() { return !!(state.session.token); }
  function authRole() {
    return state.session.user && typeof state.session.user.role === 'string' ? state.session.user.role : null;
  }
  function canManage() { return jwtActive() && authRole() === 'OWNER'; }
  function canInvoke() {
    var role = authRole();
    return jwtActive() && (role === 'OWNER' || role === 'ADMIN');
  }

  /* -------------------------------------------------------------------------
   * Transport — une seule porte de sortie réseau du module
   * --------------------------------------------------------------------- */
  function apiFetch(path, options) {
    var opts = options || {};
    var headers = { 'Content-Type': 'application/json' };
    if (jwtActive()) {
      headers['Authorization'] = 'Bearer ' + state.session.token;
    } else {
      headers['x-tenant-id'] = DEV_TENANT;
      headers['x-user-role'] = DEV_ROLE;
    }
    var init = { method: opts.method || 'GET', headers: headers };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    return fetch(path, init).then(function (res) {
      return res.text().then(function (text) {
        var payload = null;
        if (typeof text === 'string' && text.length > 0) {
          try { payload = JSON.parse(text); } catch (err) {
            payload = { _unexpectedBody: true, preview: String(text).slice(0, 200) };
          }
        }
        return { status: res.status, payload: payload };
      });
    }, function (networkErr) {
      // Erreur de transport navigateur (réseau/serveur éteint) — aucun contenu distant.
      var error = new Error('Transport impossible (serveur injoignable)');
      error.mcpNoResponse = true;
      throw error;
    });
  }

  /* -------------------------------------------------------------------------
   * Diesen DOM de base — textContent uniquement ailleurs. JAMAIS innerHTML.
   * --------------------------------------------------------------------- */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }
  function infoLine(label, value) {
    var row = el('div', 'flex gap-2 items-start');
    row.appendChild(el('span', 'text-[10px] uppercase tracking-wide text-slate-500 shrink-0', label));
    row.appendChild(el('span', 'text-[11px] text-slate-300 font-mono break-all', value === undefined || value === null || value === '' ? '—' : value));
    return row;
  }
  function jsonBlock(value, className) {
    return el('pre', className || 'text-[10px] font-mono text-slate-300 bg-[#06080e] border border-[#161a2c] rounded-lg p-2 overflow-auto max-h-56 whitespace-pre-wrap', prettyJson(value));
  }
  function statusPill(text, className) {
    return el('span', 'text-[9px] font-bold px-1.5 py-0.5 rounded ' + (className || 'bg-slate-800 text-slate-400'), text);
  }

  function showState(target, outcome, prefixLabel) {
    clearNode(target);
    var box = el('div', 'rounded-xl border px-3 py-2 space-y-1 ' + toneClassFor(outcome.kind));
    box.appendChild(el('div', 'text-[11px] font-bold', (prefixLabel ? prefixLabel + ' — ' : '') + outcome.label));
    if (outcome.status !== undefined && outcome.status !== null) {
      box.appendChild(infoLine('HTTP', String(outcome.status)));
    }
    if (outcome.code) box.appendChild(infoLine('code', outcome.code));
    if (outcome.message) box.appendChild(el('div', 'text-[10px] text-slate-400 break-words', outcome.message));
    target.appendChild(box);
  }
  function toneClassFor(kind) {
    switch (kind) {
      case 'ok': return 'border-emerald-800/50 bg-emerald-950/30 text-emerald-300';
      case 'connector_disabled': case 'schema_drift': case 'url_changed':
      case 'drift_other': case 'binding_mismatch':
      case 'confirmation_expired': case 'confirmation_used':
      case 'forbidden': case 'auth_required':
        return 'border-amber-800/50 bg-amber-950/30 text-amber-300';
      case 'not_found': case 'invalid_input': case 'rate_limited':
        return 'border-violet-800/50 bg-violet-950/30 text-violet-300';
      case 'transport': case 'transport_timeout': case 'config':
        return 'border-rose-800/50 bg-rose-950/30 text-rose-300';
      default: return 'border-rose-800/50 bg-rose-950/30 text-rose-300';
    }
  }

  /* -------------------------------------------------------------------------
   * Panneau principal — structure créée une fois
   * --------------------------------------------------------------------- */
  function mountUi() {
    if (document.getElementById('mcpRemoteToggleBtn')) return;

    var toggle = el('button', 'fixed bottom-4 left-4 z-[70] text-[11px] font-semibold text-slate-300 bg-[#0b0e1b] border border-[#1a2138] hover:border-violet-700 hover:text-white rounded-xl px-3 py-2 shadow-lg transition', 'MCP distant');
    toggle.id = 'mcpRemoteToggleBtn';
    toggle.setAttribute('type', 'button');
    toggle.addEventListener('click', function () {
      var panel = document.getElementById('mcpRemotePanel');
      if (panel) {
        if (panel.style.display === 'none') { panel.style.display = 'flex'; resetPanelToConnectors(); }
        else { panel.style.display = 'none'; }
      }
    });
    document.body.appendChild(toggle);

    var backdrop = el('div', 'fixed z-[90]');
    backdrop.id = 'mcpRemotePanel';
    backdrop.className = 'fixed inset-0 z-[90] bg-black/50 items-start justify-start';
    backdrop.style.display = 'none';
    backdrop.appendChild(buildPanel());
    document.body.appendChild(backdrop);
  }

  function buildPanel() {
    var panel = el('div', 'm-4 rounded-2xl border border-[#1a2138] bg-[#0b0e1b] text-slate-300 w-[960px] max-w-[94vw] max-h-[92vh] overflow-auto shadow-2xl');
    var header = el('div', 'flex items-center justify-between px-4 py-3 border-b border-[#1a2138] sticky top-0 bg-[#0b0e1b] z-10');
    header.appendChild(el('div', 'text-xs font-bold text-white', 'Connecteurs MCP distants (C3.2-B4)'));
    var headerRight = el('div', 'flex items-center gap-3');
    headerRight.appendChild(buildIdentityChip());
    var closeBtn = el('button', 'text-slate-500 hover:text-white text-xs', 'Fermer');
    closeBtn.setAttribute('type', 'button');
    closeBtn.addEventListener('click', function () {
      var wrap = panelWrap();
      if (wrap) wrap.style.display = 'none';
    });
    headerRight.appendChild(closeBtn);
    header.appendChild(headerRight);
    panel.appendChild(header);

    var tabs = el('div', 'flex gap-2 px-4 py-2 border-b border-[#1a2138]');
    var tabConnectors = el('button', 'text-[11px] px-3 py-1 rounded-lg bg-violet-950/60 text-violet-300 border border-violet-800/40', 'Connecteurs');
    var tabJournal = el('button', 'text-[11px] px-3 py-1 rounded-lg text-slate-400 hover:text-white', 'Journal');
    var tabSession = el('button', 'text-[11px] px-3 py-1 rounded-lg text-slate-400 hover:text-white', 'Session');
    tabConnectors.addEventListener('click', function () { setTab('connectors'); });
    tabJournal.addEventListener('click', function () { setTab('journal'); });
    tabSession.addEventListener('click', function () { setTab('session'); });
    tabs.appendChild(tabConnectors); tabs.appendChild(tabJournal); tabs.appendChild(tabSession);
    panel.appendChild(tabs);

    var body = el('div', 'p-4');
    body.id = 'mcpRemoteBody';
    // Views
    var connectorsView = el('div');
    connectorsView.id = 'mcpRemoteViewConnectors';
    var journalView = el('div');
    journalView.id = 'mcpRemoteViewJournal';
    journalView.className = 'hidden';
    var sessionView = el('div');
    sessionView.id = 'mcpRemoteViewSession';
    sessionView.className = 'hidden';
    buildConnectorsView(connectorsView);
    buildJournalView(journalView);
    buildSessionView(sessionView);
    body.appendChild(connectorsView); body.appendChild(journalView); body.appendChild(sessionView);
    panel.appendChild(body);
    return panel;
  }
  function panelWrap() { return document.getElementById('mcpRemotePanel'); }
  function setTab(which) {
    var map = { connectors: 'mcpRemoteViewConnectors', journal: 'mcpRemoteViewJournal', session: 'mcpRemoteViewSession' };
    Object.keys(map).forEach(function (key) {
      var node = document.getElementById(map[key]);
      if (node) node.className = which === key ? '' : 'hidden';
    });
    if (which === 'journal') loadJournal();
    if (which === 'session') renderSessionView();
    if (which === 'connectors') refreshConnectors();
  }
  function resetPanelToConnectors() { setTab('connectors'); }

  /* -------------------------------------------------------------------------
   * Vue Session (login / signup — JWT réel, D7)
   * --------------------------------------------------------------------- */
  function buildIdentityChip() {
    var chip = el('div', 'text-[10px] font-semibold');
    chip.id = 'mcpRemoteIdentityChip';
    renderIdentityChip(chip);
    return chip;
  }
  function renderIdentityChip(chip) {
    var node = chip || document.getElementById('mcpRemoteIdentityChip');
    if (!node) return;
    clearNode(node);
    if (jwtActive()) {
      var role = authRole() || '?';
      var email = state.session.user && state.session.user.email ? state.session.user.email : 'utilisateur';
      node.className = 'text-[10px] font-semibold px-2 py-1 rounded-lg bg-emerald-950/40 border border-emerald-800/50 text-emerald-300';
      node.appendChild(statusPill('JWT', 'bg-emerald-950 text-emerald-300 mr-1'));
      node.appendChild(el('span', '', email + ' · ' + role));
    } else {
      node.className = 'text-[10px] font-semibold px-2 py-1 rounded-lg bg-slate-900/60 border border-[#1a2138] text-slate-400';
      node.appendChild(el('span', '', 'Lecture seule (identité dev)'));
    }
  }

  function buildSessionView(view) {
    var grid = el('div', 'grid md:grid-cols-2 gap-4');
    // Login
    var loginCard = el('div', 'rounded-2xl border border-[#1a2138] bg-[#0f1220] p-4 space-y-2');
    loginCard.appendChild(el('div', 'text-[11px] font-bold text-white', 'Connexion (JWT signé)'));
    loginCard.appendChild(el('div', 'text-[10px] text-slate-500', 'POST /api/v1/auth/login — requis pour la gestion (OWNER) et la préparation/exécution (OWNER/ADMIN). Token en mémoire uniquement, jamais persisté.'));
    var loginStatus = el('div'); loginStatus.id = 'mcpRemoteLoginStatus';
    var emailInput = el('input', 'w-full bg-[#06080e] border border-[#161a2c] focus:border-violet-600 rounded-xl px-3 py-2 text-[11px] text-slate-200 focus:outline-none');
    emailInput.type = 'email'; emailInput.id = 'mcpRemoteLoginEmail'; emailInput.placeholder = 'email@example.com'; emailInput.autocomplete = 'username';
    var passwordInput = el('input', 'w-full bg-[#06080e] border border-[#161a2c] focus:border-violet-600 rounded-xl px-3 py-2 text-[11px] text-slate-200 focus:outline-none');
    passwordInput.type = 'password'; passwordInput.id = 'mcpRemoteLoginPassword'; passwordInput.placeholder = 'mot de passe'; passwordInput.autocomplete = 'current-password';
    var loginBtn = el('button', 'w-fit text-[11px] font-semibold px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white', 'Se connecter');
    loginBtn.setAttribute('type', 'button');
    loginBtn.addEventListener('click', function () { doLogin(); });
    loginCard.appendChild(emailInput); loginCard.appendChild(passwordInput); loginCard.appendChild(loginBtn); loginCard.appendChild(loginStatus);

    // Signup
    var signupCard = el('div', 'rounded-2xl border border-[#1a2138] bg-[#0f1220] p-4 space-y-2');
    signupCard.appendChild(el('div', 'text-[11px] font-bold text-white', 'Créer le 1er compte OWNER'));
    signupCard.appendChild(el('div', 'text-[10px] text-slate-500', 'POST /api/v1/auth/signup — crée un utilisateur OWNER dans un tenant dédié (contrat serveur réel). Utile si aucun utilisateur n\u2019existe encore.'));
    var signupStatus = el('div'); signupStatus.id = 'mcpRemoteSignupStatus';
    var signupEmail = el('input', 'w-full bg-[#06080e] border border-[#161a2c] focus:border-violet-600 rounded-xl px-3 py-2 text-[11px] text-slate-200 focus:outline-none');
    signupEmail.type = 'email'; signupEmail.id = 'mcpRemoteSignupEmail'; signupEmail.placeholder = 'email@example.com'; signupEmail.autocomplete = 'username';
    var signupPassword = el('input', 'w-full bg-[#06080e] border border-[#161a2c] focus:border-violet-600 rounded-xl px-3 py-2 text-[11px] text-slate-200 focus:outline-none');
    signupPassword.type = 'password'; signupPassword.id = 'mcpRemoteSignupPassword'; signupPassword.placeholder = 'mot de passe'; signupPassword.autocomplete = 'new-password';
    var signupName = el('input', 'w-full bg-[#06080e] border border-[#161a2c] focus:border-violet-600 rounded-xl px-3 py-2 text-[11px] text-slate-200 focus:outline-none');
    signupName.type = 'text'; signupName.id = 'mcpRemoteSignupName'; signupName.placeholder = 'nom (optionnel)';
    var signupBtn = el('button', 'w-fit text-[11px] font-semibold px-3 py-1.5 rounded-xl bg-[#12162a] text-slate-300 hover:text-white border border-[#1e2748]', 'Créer le compte');
    signupBtn.setAttribute('type', 'button');
    signupBtn.addEventListener('click', function () { doSignup(); });
    signupCard.appendChild(signupEmail); signupCard.appendChild(signupPassword); signupCard.appendChild(signupName); signupCard.appendChild(signupBtn); signupCard.appendChild(signupStatus);

    // Info مل contrats
    var infoCard = el('div', 'md:col-span-2 rounded-2xl border border-[#1a2138] bg-[#0f1220] p-4 space-y-1');
    infoCard.appendChild(el('div', 'text-[11px] font-bold text-white', 'Matrice de permissions (serveur)'));
    infoCard.appendChild(el('div', 'text-[10px] text-slate-400', 'Lecture connecteurs & journal : PROJECT_READ · Gestion (créer/modifier/test/découverte/approbation) : TENANT_MANAGE = OWNER · Préparation/exécution : MCP_REMOTE_INVOKE = OWNER+ADMIN + JWT obligatoire.'));
    grid.appendChild(loginCard); grid.appendChild(signupCard); grid.appendChild(infoCard);
    view.appendChild(grid);
  }
  function renderSessionView() { renderIdentityChip(); }

  function inputVal(id) {
    var node = document.getElementById(id);
    return node && typeof node.value === 'string' ? node.value : '';
  }
  function setInputVal(id, value) {
    var node = document.getElementById(id);
    if (node) node.value = value;
  }

  function doLogin() {
    var status = document.getElementById('mcpRemoteLoginStatus');
    writeFileStatus(status, 'Connexion en cours…', 'text-slate-400');
    apiFetch(AUTH_LOGIN_PATH, { method: 'POST', body: { email: inputVal('mcpRemoteLoginEmail'), password: inputVal('mcpRemoteLoginPassword') } })
      .then(function (result) {
        if (result.status === 200 && result.payload && result.payload.token) {
          state.session.token = result.payload.token;
          state.session.user = result.payload.user && typeof result.payload.user === 'object' ? result.payload.user : null;
          setInputVal('mcpRemoteLoginPassword', '');
          writeLoginStatus('Connecté : ' + (state.session.user && state.session.user.email || 'utilisateur') + ' (' + (authRole() || '?') + ')', true);
          renderIdentityChip();
          refreshConnectors();
        } else {
          var outcome = classifyOutcome(result.status, result.payload);
          writeLoginStatus((outcome.label || 'Échec') + (outcome.message ? ' : ' + outcome.message : ''), false);
        }
      })
      .catch(function () { writeLoginStatus('Transport impossible (serveur injoignable)', false); });
  }
  function doSignup() {
    var nameValue = inputVal('mcpRemoteSignupName');
    var body = { email: inputVal('mcpRemoteSignupEmail'), password: inputVal('mcpRemoteSignupPassword') };
    if (nameValue) body.name = nameValue;
    apiFetch(AUTH_SIGNUP_PATH, { method: 'POST', body: body })
      .then(function (result) {
        if ((result.status === 201 || result.status === 200) && result.payload && result.payload.token) {
          state.session.token = result.payload.token;
          state.session.user = result.payload.user && typeof result.payload.user === 'object' ? result.payload.user : null;
          setInputVal('mcpRemoteSignupPassword', '');
          writeSignupStatus('Compte créé et connecté : ' + (state.session.user && state.session.user.email || 'utilisateur') + ' (OWNER)', true);
          renderIdentityChip();
          refreshConnectors();
        } else {
          var outcome = classifyOutcome(result.status, result.payload);
          writeSignupStatus((outcome.label || 'Échec') + (outcome.message ? ' : ' + outcome.message : ''), false);
        }
      })
      .catch(function () { writeSignupStatus('Transport impossible (serveur injoignable)', false); });
  }
  function writeLoginStatus(text, ok) {
    var node = document.getElementById('mcpRemoteLoginStatus');
    if (node) writeStatus(node, text, ok);
  }
  function writeSignupStatus(text, ok) {
    var node = document.getElementById('mcpRemoteSignupStatus');
    if (node) writeStatus(node, text, ok);
  }
  function writeStatus(node, text, ok) {
    clearNode(node);
    node.appendChild(el('div', 'text-[10px] ' + (ok ? 'text-emerald-400' : 'text-rose-400') + ' break-words', text));
  }
  function writeFileStatus(node, text, cls) {
    if (node) {
      clearNode(node);
      node.appendChild(el('div', 'text-[10px] ' + cls, text));
    }
  }

  /* -------------------------------------------------------------------------
   * Vue Connecteurs : liste + détail + outils + préparation
   * --------------------------------------------------------------------- */
  function buildConnectorsView(view) {
    var layout = el('div', 'grid md:grid-cols-[320px_1fr] gap-4');
    var left = el('div', 'space-y-3');
    left.id = 'mcpRemoteConnectorsLeft';
    var right = el('div', 'space-y-3');
    right.id = 'mcpRemoteConnectorsRight';
    layout.appendChild(left); layout.appendChild(right);
    view.appendChild(layout);
    renderConnectorsLeft();
    renderConnectorsRight();
  }

  function renderConnectorsLeft() {
    var left = document.getElementById('mcpRemoteConnectorsLeft');
    if (!left) return;
    clearNode(left);

    // Création (gestion OWNER)
    var createCard = el('div', 'rounded-2xl border border-[#1a2138] bg-[#0f1220] p-3 space-y-2');
    createCard.appendChild(el('div', 'text-[11px] font-bold text-white', 'Nouveau connecteur'));
    createCard.appendChild(el('div', 'text-[10px] text-slate-500', 'POST /connectors — OWNER seul. HTTPS public uniquement (politique SSRF serveur).')); 
    var nameIn = el('input', 'w-full bg-[#06080e] border border-[#161a2c] rounded-xl px-3 py-2 text-[11px] text-slate-200 focus:outline-none');
    nameIn.type = 'text'; nameIn.id = 'mcpRemoteNewName'; nameIn.placeholder = 'nom (1 à 64 caractères)';
    var urlIn = el('input', 'w-full bg-[#06080e] border border-[#161a2c] rounded-xl px-3 py-2 text-[11px] text-slate-200 focus:outline-none');
    urlIn.type = 'url'; urlIn.id = 'mcpRemoteNewUrl'; urlIn.placeholder = 'https://serveur.mcp/exemple';
    var secretIn = el('input', 'w-full bg-[#06080e] border border-[#161a2c] rounded-xl px-3 py-2 text-[11px] text-slate-200 focus:outline-none');
    secretIn.type = 'password'; secretIn.id = 'mcpRemoteNewSecret'; secretIn.placeholder = 'secret/bearer (optionnel — chiffré serveur)';
    var createBtn = el('button', 'w-fit text-[11px] font-semibold px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white', 'Créer');
    createBtn.setAttribute('type', 'button');
    createBtn.addEventListener('click', function () {
      var body = { name: inputVal('mcpRemoteNewName'), url: inputVal('mcpRemoteNewUrl') };
      var secretValue = inputVal('mcpRemoteNewSecret');
      if (secretValue) body.secret = secretValue;
      apiFetch(API_BASE + '/connectors', { method: 'POST', body: body })
        .then(function (result) {
          if (result.status === 201) {
            setInputVal('mcpRemoteNewName', ''); setInputVal('mcpRemoteNewUrl', ''); setInputVal('mcpRemoteNewSecret', '');
            refreshConnectors();
          } else {
            var outcome = classifyOutcome(result.status, result.payload);
            var errSlot = document.getElementById('mcpRemoteCreateErr');
            if (errSlot) showState(errSlot, outcome, 'Création refusée');
          }
        })
        .catch(function () {
          var errSlot = document.getElementById('mcpRemoteCreateErr');
          if (errSlot) showState(errSlot, { kind: 'transport', label: 'Connecteur inaccessible', message: 'Transport impossible (serveur injoignable)' }, 'Création');
        });
    });
    var createErr = el('div'); createErr.id = 'mcpRemoteCreateErr';
    createCard.appendChild(nameIn); createCard.appendChild(urlIn); createCard.appendChild(secretIn);
    var createRow = el('div', 'flex items-center gap-2');
    createRow.appendChild(createBtn);
    if (!canManage()) createRow.appendChild(el('span', 'text-[10px] text-amber-400', 'Session OWNER requise'));
    createCard.appendChild(createRow); createCard.appendChild(createErr);
    left.appendChild(createCard);

    // Liste
    var listCard = el('div', 'rounded-2xl border border-[#1a2138] bg-[#0f1220] p-3 space-y-2');
    listCard.appendChild(el('div', 'text-[11px] font-bold text-white', 'Connecteurs (' + state.connectors.length + ')'));
    if (state.connectors.length === 0) {
      listCard.appendChild(el('div', 'text-[10px] text-slate-500', 'Aucun connecteur. Créez-en une clause OWNER pour commencer.'));
    }
    state.connectors.forEach(function (connector) {
      var row = el('div', 'flex items-center justify-between gap-2 rounded-xl border border-[#1a2138] bg-[#0b0e1b] px-2.5 py-2');
      var leftPart = el('div', 'min-w-0');
      leftPart.appendChild(el('div', 'text-[11px] font-semibold text-white truncate', connector.name));
      leftPart.appendChild(el('div', 'text-[9px] text-slate-500 truncate font-mono', connector.connectorId));
      row.appendChild(leftPart);
      row.appendChild(statusPill(connector.enabled ? 'ACTIF' : 'DÉSACTIVÉ', connector.enabled
        ? 'bg-emerald-950/60 text-emerald-300'
        : 'bg-slate-800 text-slate-400'));
      var openBtn = el('button', 'text-[10px] shrink-0 px-2 py-1 rounded-lg bg-[#12162a] border border-[#1e2748] hover:border-violet-700 text-slate-300 hover:text-white', 'Ouvrir');
      openBtn.setAttribute('type', 'button');
      openBtn.addEventListener('click', function () { selectConnector(connector.connectorId); });
      row.appendChild(openBtn);
      listCard.appendChild(row);
    });
    var refreshBtn = el('button', 'text-[10px] px-2 py-1 rounded-lg border border-[#1e2748] text-slate-400 hover:text-white', 'Rafraîchir la liste');
    refreshBtn.setAttribute('type', 'button');
    refreshBtn.addEventListener('click', function () { refreshConnectors(); });
    listCard.appendChild(refreshBtn);
    left.appendChild(listCard);
  }
  function refreshConnectors() {
    // Lecture seule : valide sans JWT (PROJECT_READ via repli dev).
    return apiFetch(API_BASE + '/connectors')
      .then(function (result) {
        if (result.status === 200 && result.payload && result.payload.connectors) {
          state.connectors = result.payload.connectors.filter(function (connector) {
            return connector && typeof connector.connectorId === 'string';
          });
        } else {
          state.connectors = [];
          var outcome = classifyOutcome(result.status, result.payload);
          state.identityError = outcome.label + (outcome.message ? ' : ' + outcome.message : '');
        }
        renderConnectorsLeft();
        renderConnectorsRight();
      })
      .catch(function () {
        state.identityError = 'Transport impossible (serveur injoignable)';
        renderConnectorsLeft();
        renderConnectorsRight();
      });
  }

  function renderConnectorsRight() {
    var right = document.getElementById('mcpRemoteConnectorsRight');
    if (!right) return;
    clearNode(right);
    if (!state.selectedConnectorId) {
      right.appendChild(el('div', 'rounded-2xl border border-dashed border-[#1a2138] bg-[#0f1220] p-4 text-[11px] text-slate-500', 'Sélectionnez un connecteur dans la liste (ou créez-en un) pour voir le détail, tester, découvrir les outils et exécuter avec confirmation.'));
      return;
    }
    var connector = state.selectedConnector;
    if (!connector) {
      right.appendChild(el('div', 'text-[11px] text-slate-500', 'Connecteur ' + state.selectedConnectorId + ' indisponible.'));
      return;
    }

    // Carte détail
    var card = el('div', 'rounded-2xl border border-[#1a2138] bg-[#0f1220] p-4 space-y-2');
    card.appendChild(el('div', 'text-[11px] font-bold text-white', connector.name));
    var statusRow = el('div', 'flex flex-wrap gap-2 items-center');
    statusRow.appendChild(statusPill(connector.enabled ? 'ACTIF' : 'DÉSACTIVÉ', connector.enabled ? 'bg-emerald-950/60 text-emerald-300' : 'bg-slate-800 text-slate-400'));
    statusRow.appendChild(statusPill(connector.secretPresent ? 'SECRET CHIFFRÉ PRÉSENT' : 'SECRET ABSENT', connector.secretPresent ? 'bg-violet-950/50 text-violet-300' : 'bg-slate-800 text-slate-400'));
    card.appendChild(statusRow);
    var grid = el('div', 'grid md:grid-cols-2 gap-x-4 gap-y-1');
    grid.appendChild(infoLine('ID', connector.connectorId));
    grid.appendChild(infoLine('URL cible', connector.url));
    grid.appendChild(infoLine('Transport', connector.transport));
    grid.appendChild(infoLine('Créé', connector.createdAt));
    grid.appendChild(infoLine('Mis à jour', connector.updatedAt));
    card.appendChild(grid);
    var stateSlot = el('div'); stateSlot.id = 'mcpRemoteConnectorState';
    card.appendChild(stateSlot);

    // Actions gestion (OWNER)
    var actionsRow = el('div', 'flex flex-wrap gap-2 items-center');
    var manageHint = null;
    if (!canManage()) {
      manageHint = el('span', 'text-[10px] text-amber-400', 'Gestion : session OWNER requise (JWT)');
    }
    var toggleBtn = el('button', 'text-[10px] px-2 py-1 rounded-lg border border-[#1e2748] text-slate-300 hover:text-white' , connector.enabled ? 'Désactiver' : 'Activer');
    toggleBtn.setAttribute('type', 'button');
    toggleBtn.disabled = !canManage();
    toggleBtn.addEventListener('click', function () { patchConnector({ enabled: !connector.enabled }); });
    actionsRow.appendChild(toggleBtn);

    var urlIn = el('input', 'flex-1 min-w-[240px] bg-[#06080e] border border-[#161a2c] rounded-xl px-3 py-2 text-[11px] text-slate-200 focus:outline-none');
    urlIn.type = 'url'; urlIn.id = 'mcpRemotePatchUrl'; urlIn.placeholder = 'nouvelle URL (révoque approbations + invalide confirmations)';
    if (canManage()) actionsRow.appendChild(urlIn);
    var patchUrlBtn = el('button', 'text-[10px] px-2 py-1 rounded-lg border border-[#1e2748] text-slate-300 hover:text-white', 'Modifier l\u2019URL');
    patchUrlBtn.setAttribute('type', 'button');
    patchUrlBtn.disabled = !canManage();
    patchUrlBtn.addEventListener('click', function () {
      var nextUrl = inputVal('mcpRemotePatchUrl');
      if (!nextUrl) return;
      var body = { url: nextUrl };
      apiFetch(API_BASE + '/connectors/' + encodeURIComponent(state.selectedConnectorId), { method: 'PATCH', body: body })
        .then(function (result) {
          if (result.status === 200 && result.payload && result.payload.connector) {
            setInputVal('mcpRemotePatchUrl', '');
            state.selectedConnector = result.payload.connector;
            var slot = document.getElementById('mcpRemoteConnectorState');
            if (slot) {
              clearNode(slot);
              var okBox = el('div', 'rounded-xl border border-emerald-800/50 bg-emerald-950/30 text-emerald-300 px-3 py-2 text-[11px] font-semibold', 'URL modifiée. Approbations révoquées : ' + (result.payload.revokedToolNames ? result.payload.revokedToolNames.length : 0) + ' · Confirmations invalidées : ' + (result.payload.invalidatedConfirmations !== undefined ? result.payload.invalidatedConfirmations : 0));
              slot.appendChild(okBox);
            }
            refreshConnectors();
          } else {
            var outcome = classifyOutcome(result.status, result.payload);
            var slot2 = document.getElementById('mcpRemoteConnectorState');
            if (slot2) showState(slot2, outcome, 'Modification refusée');
          }
        })
        .catch(function () {
          var slot3 = document.getElementById('mcpRemoteConnectorState');
          if (slot3) showState(slot3, { kind: 'transport', label: 'Transport impossible', message: 'Serveur injoignable' });
        });
    });
    if (canManage()) actionsRow.appendChild(patchUrlBtn);

    var testBtn = el('button', 'text-[10px] px-2 py-1 rounded-lg bg-[#12162a] border border-[#1e2748] hover:border-violet-700 text-slate-300 hover:text-white', 'Tester (initialize)');
    testBtn.setAttribute('type', 'button');
    testBtn.disabled = !canManage();
    testBtn.addEventListener('click', function () { testConnector(); });
    actionsRow.appendChild(testBtn);
    if (manageHint) actionsRow.appendChild(manageHint);
    card.appendChild(actionsRow);

    // Secret
    var secretRow = el('div', 'flex flex-wrap gap-2 items-center');
    var secretInput = el('input', 'flex-1 min-w-[240px] bg-[#06080e] border border-[#161a2c] rounded-xl px-3 py-2 text-[11px] text-slate-200 focus:outline-none');
    secretInput.type = 'password'; secretInput.id = 'mcpRemoteSecretInput'; secretInput.placeholder = 'nouveau secret/bearer (non re-affiché après envoi)';
    secretInput.autocomplete = 'off';
    var putSecretBtn = el('button', 'text-[10px] px-2 py-1 rounded-lg border border-[#1e2748] text-slate-300 hover:text-white', 'Définir le secret');
    putSecretBtn.setAttribute('type', 'button');
    putSecretBtn.disabled = !canManage();
    putSecretBtn.addEventListener('click', function () {
      var secretValue = inputVal('mcpRemoteSecretInput');
      if (!secretValue) return;
      apiFetch(API_BASE + '/connectors/' + encodeURIComponent(state.selectedConnectorId) + '/secret', { method: 'PUT', body: { secret: secretValue } })
        .then(function (result) {
          setInputVal('mcpRemoteSecretInput', '');
          if (result.status === 200 && result.payload && result.payload.connector) {
            state.selectedConnector = result.payload.connector;
            renderConnectorsRight();
          } else {
            var outcome = classifyOutcome(result.status, result.payload);
            var slot = document.getElementById('mcpRemoteConnectorState');
            if (slot) showState(slot, outcome, 'Secret refusé');
          }
        }).catch(function () {
          setInputVal('mcpRemoteSecretInput', '');
          var slot2 = document.getElementById('mcpRemoteConnectorState');
          if (slot2) showState(slot2, { kind: 'transport', label: 'Transport impossible' });
        });
    });
    var delSecretBtn = el('button', 'text-[10px] px-2 py-1 rounded-lg border border-rose-900/60 text-rose-300 hover:text-rose-200', 'Retirer le secret');
    delSecretBtn.setAttribute('type', 'button');
    delSecretBtn.disabled = !canManage();
    delSecretBtn.addEventListener('click', function () {
      apiFetch(API_BASE + '/connectors/' + encodeURIComponent(state.selectedConnectorId) + '/secret', { method: 'DELETE' })
        .then(function (result) {
          if (result.status === 200) { selectConnector(state.selectedConnectorId); }
          else {
            var outcome = classifyOutcome(result.status, result.payload);
            var slot = document.getElementById('mcpRemoteConnectorState');
            if (slot) showState(slot, outcome, 'Retrait refusé');
          }
        }).catch(function () {});
    });
    secretRow.appendChild(secretInput); secretRow.appendChild(putSecretBtn); secretRow.appendChild(delSecretBtn);
    card.appendChild(secretRow);

    var deleteBtn = el('button', 'text-[10px] px-2 py-1 rounded-lg border border-rose-900/60 text-rose-300 hover:text-rose-200', 'Supprimer le connecteur');
    deleteBtn.setAttribute('type', 'button');
    deleteBtn.disabled = !canManage();
    deleteBtn.addEventListener('click', function () {
      // Annulation facile : double confirmation explicite (gestion destructive).
      if (!window.confirm('Supprimer le connecteur ' + connector.name + ' ? (approbations et confirmations seront supprimées)')) return;
      if (!window.confirm('CONFIRMATION FINALE : supprimer définitivement ' + connector.connectorId + ' ?')) return;
      apiFetch(API_BASE + '/connectors/' + encodeURIComponent(state.selectedConnectorId), { method: 'DELETE' })
        .then(function (result) {
          if (result.status === 200) {
            state.selectedConnectorId = null; state.selectedConnector = null; state.tools = []; state.prepared = null;
            refreshConnectors();
          } else {
            var outcome = classifyOutcome(result.status, result.payload);
            var slot = document.getElementById('mcpRemoteConnectorState');
            if (slot) showState(slot, outcome, 'Suppression refusée');
          }
        }).catch(function () {});
    });
    card.appendChild(deleteBtn);
    right.appendChild(card);

    // Découverte / outils
    var toolsCard = el('div', 'rounded-2xl border border-[#1a2138] bg-[#0f1220] p-4 space-y-3');
    var toolsHeader = el('div', 'flex items-center justify-between gap-2');
    toolsHeader.appendChild(el('div', 'text-[11px] font-bold text-white', 'Outils distants (découverte expresse)'));
    var discoverBtn = el('button', 'text-[10px] px-2 py-1 rounded-lg bg-[#12162a] border border-[#1e2748] hover:border-violet-700 text-slate-300 hover:text-white', 'Découvrir');
    discoverBtn.setAttribute('type', 'button');
    discoverBtn.id = 'mcpRemoteDiscoverBtn';
    discoverBtn.disabled = !canManage();
    discoverBtn.addEventListener('click', function () { discoverTools(state.selectedConnectorId); });
    toolsHeader.appendChild(discoverBtn);
    toolsCard.appendChild(toolsHeader);
    toolsCard.appendChild(el('div', 'text-[10px] text-slate-500', 'GET /connectors/:id/tools — lecture seule du serveur distant ( OWNER) ; aucune approbation automatique, aucun appel d\u2019outil.'));
    var toolsState = el('div'); toolsState.id = 'mcpRemoteToolsState';
    toolsCard.appendChild(toolsState);
    var toolsList = el('div', 'space-y-2'); toolsList.id = 'mcpRemoteToolsList';
    toolsCard.appendChild(toolsList);
    right.appendChild(toolsCard);

    renderTools();
  }

  function patchConnector(body) {
    apiFetch(API_BASE + '/connectors/' + encodeURIComponent(state.selectedConnectorId), { method: 'PATCH', body: body })
      .then(function (result) {
        if (result.status === 200 && result.payload && result.payload.connector) {
          state.selectedConnector = result.payload.connector;
          renderConnectorsRight();
          refreshConnectors();
        } else {
          var outcome = classifyOutcome(result.status, result.payload);
          var slot = document.getElementById('mcpRemoteConnectorState');
          if (slot) showState(slot, outcome, 'Modification refusée');
        }
      }).catch(function () {
        var slot2 = document.getElementById('mcpRemoteConnectorState');
        if (slot2) showState(slot2, { kind: 'transport', label: 'Transport impossible' });
      });
  }
  function testConnector() {
    var slot = document.getElementById('mcpRemoteConnectorState');
    if (slot) writeFileStatus(slot, 'Test en cours…', 'text-slate-500');
    apiFetch(API_BASE + '/connectors/' + encodeURIComponent(state.selectedConnectorId) + '/test', { method: 'POST', body: {} })
      .then(function (result) {
        if (result.status === 200 && result.payload && result.payload.ok === true) {
          if (slot) {
            clearNode(slot);
            var box = el('div', 'rounded-xl border border-emerald-800/50 bg-emerald-950/30 text-emerald-300 px-3 py-2 text-[11px] space-y-1');
            box.appendChild(el('div', 'font-semibold', 'Handshake OK (initialize)'));
            box.appendChild(infoLine('protocole', result.payload.protocolVersion));
            box.appendChild(infoLine('serveur', result.payload.serverName + ' ' + (result.payload.serverVersion || '')));
            box.appendChild(infoLine('session capturée', result.payload.sessionCaptured ? 'oui' : 'non'));
            slot.appendChild(box);
          }
        } else if (result.status === 200 && result.payload && result.payload.ok === false) {
          if (slot) {
            clearNode(slot);
            var box2 = el('div', 'rounded-xl border border-rose-800/50 bg-rose-950/30 text-rose-300 px-3 py-2 text-[11px] space-y-1');
            box2.appendChild(el('div', 'font-semibold', 'Connecteur inaccessible (test)'));
            var errPayload = result.payload.error && typeof result.payload.error === 'object' ? result.payload.error : {};
            box2.appendChild(infoLine('code', errPayload.code || '—'));
            box2.appendChild(el('div', 'text-[10px] break-words text-rose-300/80', errPayload.message || 'Échec du handshake.'));
            slot.appendChild(box2);
          }
        } else {
          var outcome = classifyOutcome(result.status, result.payload);
          if (slot) showState(slot, outcome, 'Test refusé');
        }
      }).catch(function () {
        if (slot) showState(slot, { kind: 'transport', label: 'Connecteur inaccessible', message: 'Transport impossible (serveur injoignable)' });
      });
  }

  function selectConnector(connectorId) {
    state.prepared = null;
    state.tools = [];
    state.preparingTool = null;
    apiFetch(API_BASE + '/connectors/' + encodeURIComponent(connectorId))
      .then(function (result) {
        if (result.status === 200 && result.payload && result.payload.connector) {
          state.selectedConnectorId = connectorId;
          state.selectedConnector = result.payload.connector;
        } else {
          var outcome = classifyOutcome(result.status, result.payload);
          state.identityError = outcome.label;
          // 404 indiscernable : le connecteur a peut-être été supprimé.
          return refreshConnectors().then(function () {
            state.selectedConnectorId = null; state.selectedConnector = null; state.tools = [];
            renderConnectorsLeft(); renderConnectorsRight();
            var slot = document.getElementById('mcpRemoteConnectorState');
            if (slot) showState(slot, outcome, 'Ouverture refusée');
          });
        }
        renderConnectorsLeft();
        renderConnectorsRight();
      })
      .catch(function () {
        state.identityError = 'Transport impossible (serveur injoignable)';
        renderConnectorsLeft(); renderConnectorsRight();
      });
  }

  /* -------------------------------------------------------------------------
   * Découverte des outils (OWNER) — lecture pure du distant
   * --------------------------------------------------------------------- */
  function discoverTools(connectorId) {
    var stateSlot = document.getElementById('mcpRemoteToolsState');
    if (stateSlot) writeFileStatus(stateSlot, 'Découverte en cours…', 'text-slate-500');
    apiFetch(API_BASE + '/connectors/' + encodeURIComponent(connectorId) + '/tools')
      .then(function (result) {
        if (result.status === 200 && result.payload && result.payload.tools) {
          state.tools = result.payload.tools.filter(function (entry) {
            return entry && typeof entry.toolName === 'string';
          });
          if (stateSlot) {
            clearNode(stateSlot);
            var summary = el('div', 'rounded-xl border border-violet-800/50 bg-violet-950/30 text-violet-200 px-3 py-2 text-[11px] space-y-1');
            summary.appendChild(el('div', 'font-semibold', 'Découverte : ' + state.tools.length + ' outil(s)'));
            if (typeof result.payload.schemaInvalidCount === 'number' && result.payload.schemaInvalidCount > 0) {
              summary.appendChild(el('div', 'text-[10px]', 'Schémas non interprétables : ' + result.payload.schemaInvalidCount + ' (refus fail-closed).'));
            }
            if (typeof result.payload.displayTruncatedCount === 'number' && result.payload.displayTruncatedCount > 0) {
              summary.appendChild(el('div', 'text-[10px]', 'Schémas trop volumineux pour affichage complet : ' + result.payload.displayTruncatedCount + '.'));
            }
            stateSlot.appendChild(summary);
          }
          renderTools();
        } else {
          var outcome = classifyOutcome(result.status, result.payload);
          if (stateSlot) showState(stateSlot, outcome, 'Découverte refusée');
          if (outcome.kind === 'forbidden' || outcome.kind === 'auth_required') {
            // Service clair : la découverte exige OWNER (TENANT_MANAGE).
            stateSlot.appendChild(el('div', 'text-[10px] text-amber-300 mt-1', 'La découverte des outils distants exige une session JWT OWNER (onglet Session).'));
          }
          state.tools = [];
          renderTools();
        }
      })
      .catch(function () {
        if (stateSlot) showState(stateSlot, { kind: 'transport', label: 'Connecteur inaccessible', message: 'Transport impossible (serveur injoignable)' }, 'Découverte');
      });
  }

  function renderTools() {
    var list = document.getElementById('mcpRemoteToolsList');
    if (!list) return;
    clearNode(list);
    if (state.tools.length === 0 && !state.selectedConnectorId) return;
    if (state.tools.length === 0) {
      list.appendChild(el('div', 'text-[10px] text-slate-500', 'Aucune découverte en mémoire. Cliquez sur « Découvrir » (OWNER).'));
      return;
    }
    state.tools.forEach(function (entry) {
      list.appendChild(buildToolCard(entry));
    });
  }

  function buildToolCard(entry) {
    var card = el('div', 'rounded-xl border border-[#1a2138] bg-[#0b0e1b] p-3 space-y-2');
    var titleRow = el('div', 'flex items-center gap-2 flex-wrap');
    titleRow.appendChild(el('span', 'text-[11px] font-bold text-white font-mono', entry.toolName));
    var schemaStatus = entry.schemaStatus;
    if (schemaStatus === 'INVALID') {
      titleRow.appendChild(statusPill('SCHÉMA INVALIDE (REFUS)', 'bg-rose-950/60 text-rose-300'));
    } else if (schemaStatus === 'DISPLAY_TRUNCATED') {
      titleRow.appendChild(statusPill('SCHÉMA TROP GRAND POUR AFFICHAGE', 'bg-amber-950/60 text-amber-300'));
    }
    var approval = entry.approval && typeof entry.approval === 'object' ? entry.approval : null;
    if (!approval) {
      titleRow.appendChild(statusPill('NON APPROUVÉ', 'bg-slate-800 text-slate-400'));
    } else if (approval.status === 'APPROVED') {
      if (approval.drift === true) titleRow.appendChild(statusPill('APPROUVÉ · SCHÉMA DÉRIVÉ', 'bg-amber-950/70 text-amber-300'));
      else titleRow.appendChild(statusPill('APPROUVÉ', 'bg-emerald-950/60 text-emerald-300'));
    } else if (approval.status === 'REVOKED') {
      titleRow.appendChild(statusPill('APPROBATION RÉVOQUÉE', 'bg-rose-950/60 text-rose-300'));
    } else {
      titleRow.appendChild(statusPill('NON APPROUVÉ', 'bg-slate-800 text-slate-400'));
    }
    card.appendChild(titleRow);

    if (entry.title !== undefined && entry.title !== null) card.appendChild(infoLine('Titre (distant — non fiable)', entry.title));
    if (entry.description !== undefined && entry.description !== null && entry.description !== '') {
      card.appendChild(infoLine('Description (distant — non fiable)', entry.description));
    }
    if (entry.schemaSha256) card.appendChild(infoLine('hash schéma courant', entry.schemaSha256));
    if (approval && approval.approvedSchemaSha256) card.appendChild(infoLine('hash approuvé', approval.approvedSchemaSha256));

    if (entry.inputSchema !== undefined && entry.inputSchema !== null) {
      card.appendChild(infoLine('inputSchema (distant — non fiable)', ''));
      card.appendChild(jsonBlock(entry.inputSchema));
    } else if (schemaStatus === 'INVALID' || schemaStatus === 'DISPLAY_TRUNCATED') {
      card.appendChild(el('div', 'text-[10px] text-amber-400', 'Schéma masqué côté serveur (invalide ou trop grand) : approbation/exécution refusées fail-closed.'));
    }

    var actions = el('div', 'flex flex-wrap gap-2');
    if (canManage()) {
      if (!approval || approval.status !== 'APPROVED') {
        var approveBtn = el('button', 'text-[10px] px-2 py-1 rounded-lg border border-emerald-800/60 text-emerald-300 hover:text-emerald-200', 'Approuver (hash recalculé serveur)');
        approveBtn.setAttribute('type', 'button');
        approveBtn.disabled = schemaStatus === 'INVALID';
        approveBtn.addEventListener('click', function () { approveTool(entry.toolName); });
        actions.appendChild(approveBtn);
      }
      if (approval && (approval.status === 'APPROVED' || approval.status === 'REVOKED')) {
        var revokeBtn = el('button', 'text-[10px] px-2 py-1 rounded-lg border border-rose-900/60 text-rose-300 hover:text-rose-200', approval.status === 'APPROVED' ? 'Révoquer' : 'Retirer la politique révoquée');
        revokeBtn.setAttribute('type', 'button');
        revokeBtn.addEventListener('click', function () { revokeTool(entry.toolName); });
        actions.appendChild(revokeBtn);
      }
    } else {
      actions.appendChild(el('span', 'text-[10px] text-amber-400', 'Approbation/exécution : session OWNER requise'));
    }
    if (canInvoke() && entry.schemaStatus === 'OK') {
      var invokeAllowed = approval && approval.status === 'APPROVED' && approval.drift !== true;
      var prepareBtn = el('button', 'text-[10px] px-2 py-1 rounded-lg bg-violet-950/60 border border-violet-800/60 text-violet-200 hover:text-white', 'Préparer l\u2019exécution');
      prepareBtn.setAttribute('type', 'button');
      prepareBtn.disabled = !(invokeAllowed && state.selectedConnector && state.selectedConnector.enabled === true);
      if (!prepareBtn.disabled) {
        prepareBtn.addEventListener('click', function () { openPrepare(entry.toolName); });
      } else {
        prepareBtn.title = 'Requiert : outil APPROVED sans dérive + connecteur actif';
      }
      actions.appendChild(prepareBtn);
    }
    card.appendChild(actions);
    return card;
  }

  function approveTool(toolName) {
    var stateSlot = document.getElementById('mcpRemoteToolsState');
    if (stateSlot) writeFileStatus(stateSlot, 'Approbation en cours (re-découverte serveur puis écriture)…', 'text-slate-500');
    apiFetch(API_BASE + '/connectors/' + encodeURIComponent(state.selectedConnectorId) + '/tools/' + encodeURIComponent(toolName) + '/approve', { method: 'POST', body: {} })
      .then(function (result) {
        if (result.status === 200 && result.payload && result.payload.approval) {
          if (stateSlot) writeFileStatus(stateSlot, 'Approuvé : ' + toolName + ' · hash ' + result.payload.approval.schemaSha256, 'text-emerald-400');
          // Re-découverte pour rafraîchir les états (JAMAIS d'exécution ici).
          discoverTools(state.selectedConnectorId);
        } else {
          var outcome = classifyOutcome(result.status, result.payload);
          if (stateSlot) showState(stateSlot, outcome, 'Approbation refusée');
        }
      })
      .catch(function () {
        if (stateSlot) showState(stateSlot, { kind: 'transport', label: 'Connecteur inaccessible' }, 'Approbation');
      });
  }
  function revokeTool(toolName) {
    var stateSlot = document.getElementById('mcpRemoteToolsState');
    if (stateSlot) writeFileStatus(stateSlot, 'Révocation en cours…', 'text-slate-500');
    apiFetch(API_BASE + '/connectors/' + encodeURIComponent(state.selectedConnectorId) + '/tools/' + encodeURIComponent(toolName) + '/revoke', { method: 'POST' })
      .then(function (result) {
        if (result.status === 200 && result.payload && result.payload.revocation) {
          if (stateSlot) writeFileStatus(stateSlot, 'Révocation : ' + toolName, 'text-amber-400');
          discoverTools(state.selectedConnectorId);
        } else {
          var outcome = classifyOutcome(result.status, result.payload);
          if (stateSlot) showState(stateSlot, outcome, 'Révocation refusée');
        }
      })
      .catch(function () {
        if (stateSlot) showState(stateSlot, { kind: 'transport', label: 'Connecteur inaccessible' }, 'Révocation');
      });
  }

  /* -------------------------------------------------------------------------
   * Préparation (B3) puis confirmation humaine EXPlicite puis exécution
   * --------------------------------------------------------------------- */
  function openPrepare(toolName) {
    clearPrepared();
    state.preparingTool = { toolName: toolName };
    renderTools();
    // Insertion de la forme de préparation en tête de la liste d'outils.
    var list = document.getElementById('mcpRemoteToolsList');
    if (!list) return;
    clearNode(list);
    list.appendChild(buildPrepareCard(toolName));
    state.tools.forEach(function (entry) {
      list.appendChild(buildToolCard(entry));
    });
    var argsArea = document.getElementById('mcpRemoteArgsArea');
    if (argsArea) argsArea.focus();
  }

  function buildPrepareCard(toolName) {
    var card = el('div', 'rounded-xl border border-violet-800/60 bg-violet-950/20 p-3 space-y-2');
    card.appendChild(el('div', 'text-[11px] font-bold text-white', 'Préparation : ' + toolName));
    card.appendChild(el('div', 'text-[10px] text-slate-400', 'POST /prepare — crée une confirmation liée à VOS arguments (-hash canonique via serveur). AUCUN appel d\u2019outil à cette étape.'));
    var argsArea = el('textarea', 'w-full bg-[#06080e] border border-[#161a2c] rounded-xl px-3 py-2 text-[11px] font-mono text-slate-200 focus:outline-none h-32');
    argsArea.id = 'mcpRemoteArgsArea';
    argsArea.value = '{}';
    argsArea.spellcheck = false;
    card.appendChild(argsArea);
    var argHint = el('div', 'text-[10px] text-slate-500', 'JSON objet ({} par défaut). Changer les arguments APRÈS la préparation rend la confirmation non liée : une nouvelle préparation serait exigée.');
    card.appendChild(argHint);
    var argsState = el('div'); argsState.id = 'mcpRemotePrepareState';
    card.appendChild(argsState);
    var row = el('div', 'flex gap-2');
    var prepareBtn = el('button', 'text-[11px] font-semibold px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white', 'Préparer la confirmation');
    prepareBtn.setAttribute('type', 'button');
    prepareBtn.id = 'mcpRemotePrepareBtn';
    prepareBtn.addEventListener('click', function () { doPrepare(toolName); });
    var cancelBtn = el('button', 'text-[11px] px-3 py-1.5 rounded-xl bg-[#12162a] border border-[#1e2748] text-slate-300 hover:text-white', 'Annuler la préparation');
    cancelBtn.setAttribute('type', 'button');
    cancelBtn.addEventListener('click', function () {
      // Annulation de la préparation : si une confirmation est déjà ouverte,
      // elle est refermée sans AUCUN appel (state.prepared jeté).
      var modal = document.getElementById('mcpRemoteConfirmModal');
      if (modal) modal.remove();
      clearPrepared();
      state.preparingTool = null;
      renderTools();
    });
    row.appendChild(prepareBtn); row.appendChild(cancelBtn);
    card.appendChild(row);
    return card;
  }

  function parseArgsTextarea() {
    var node = document.getElementById('mcpRemoteArgsArea');
    if (!node) return { ok: false, error: 'Zone d\u2019arguments introuvable.' };
    var raw = node.value;
    var parsed;
    try { parsed = JSON.parse(raw); } catch (err) { return { ok: false, error: 'JSON invalide : ' + String(err.message || err) }; }
    if (parsed === null || typeof parsed !== 'object' || Object.prototype.toString.call(parsed) === '[object Array]') {
      return { ok: false, error: 'Les arguments doivent être un objet JSON.' };
    }
    return { ok: true, args: parsed };
  }

  function doPrepare(toolName) {
    var stateSlot = document.getElementById('mcpRemotePrepareState');
    var parsed = parseArgsTextarea();
    if (!parsed.ok) {
      if (stateSlot) {
        clearNode(stateSlot);
        stateSlot.appendChild(el('div', 'text-[10px] text-rose-400', parsed.error));
      }
      return;
    }
    if (stateSlot) writeFileStatus(stateSlot, 'Préparation en cours (ré-interrogation distante + binding serveur)…', 'text-slate-500');
    apiFetch(API_BASE + '/connectors/' + encodeURIComponent(state.selectedConnectorId) + '/tools/' + encodeURIComponent(toolName) + '/prepare', { method: 'POST', body: { arguments: parsed.args } })
      .then(function (result) {
        if (result.status === 201 && result.payload && result.payload.confirmation) {
          var confirmation = result.payload.confirmation;
          state.prepared = {
            connectorId: state.selectedConnectorId,
            connectorName: state.selectedConnector ? state.selectedConnector.name : state.selectedConnectorId,
            toolName: confirmation.toolName || toolName,
            confirmation: confirmation,
            args: parsed.args,
            argsCanonical: canonicalForUi(parsed.args)
          };
          state.preparingTool = null;
          // La carte de préparation RESTE montée (textarea d'arguments
          // disponible sous la modale) : si l'utilisateur modifie ensuite les
          // arguments, la détection « arguments modifiés » doit pouvoir
          // comparer la saisie courante à la préparation et désactiver
          // l'exécution. Re-render détruirait cette garantie.
          openConfirmationModal();
        } else {
          var outcome = classifyOutcome(result.status, result.payload);
          if (stateSlot) showState(stateSlot, outcome, 'Préparation refusée (aucun appel d\u2019outil effectué)');
        }
      })
      .catch(function () {
        if (stateSlot) showState(stateSlot, { kind: 'transport', label: 'Transport impossible (serveur injoignable)' }, 'Préparation');
      });
  }

  function clearPrepared() {
    stopExpiryTimer();
    state.prepared = null;
  }

  function openConfirmationModal() {
    if (!state.prepared) return;
    stopExpiryTimer();
    var existing = document.getElementById('mcpRemoteConfirmModal');
    if (existing) existing.remove();
    var backdrop = el('div', 'fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4');
    backdrop.id = 'mcpRemoteConfirmModal';

    var modal = el('div', 'rounded-2xl border border-amber-800/60 bg-[#0b0e1b] text-slate-300 w-[640px] max-w-full max-h-[90vh] overflow-auto shadow-2xl');
    var header = el('div', 'px-4 py-3 border-b border-[#1a2138] flex items-center justify-between');
    header.appendChild(el('div', 'text-xs font-bold text-amber-300', 'Confirmation humaine requise avant exécution'));
    var closeX = el('button', 'text-slate-500 hover:text-white text-xs', '✕');
    closeX.setAttribute('type', 'button');
    closeX.addEventListener('click', cancelConfirmation);
    header.appendChild(closeX);
    modal.appendChild(header);

    var body = el('div', 'p-4 space-y-3');
    var rule = el('div', 'rounded-xl border border-[#1a2138] bg-[#0f1220] p-3 space-y-1');
    rule.appendChild(infoLine('Connecteur', state.prepared.connectorName));
    rule.appendChild(infoLine('Outil', state.prepared.toolName));
    rule.appendChild(infoLine('confirmationId', state.prepared.confirmation.confirmationId));
    rule.appendChild(infoLine('hash schéma', state.prepared.confirmation.schemaSha256));
    rule.appendChild(infoLine('hash arguments', state.prepared.confirmation.argsSha256));
    body.appendChild(rule);

    body.appendChild(el('div', 'text-[10px] font-bold uppercase tracking-wide text-slate-400', 'Arguments EXACTS qui seront envoyés'));
    body.appendChild(jsonBlock(state.prepared.args));

    var warn = el('div', 'text-[10px] text-amber-300', 'L\u2019exécution consomme la confirmation (usage unique). Annulez si besoin : AUCUN appel ne part tant que vous n\u2019avez pas confirmé.');
    body.appendChild(warn);

    var expirySlot = el('div'); expirySlot.id = 'mcpRemoteExpirySlot';
    body.appendChild(expirySlot);

    var btnRow = el('div', 'flex gap-2 justify-end');
    var cancelBtn = el('button', 'text-[11px] font-semibold px-3 py-2 rounded-xl bg-[#12162a] border border-[#1e2748] text-slate-300 hover:text-white', 'Annuler (aucune exécution)');
    cancelBtn.id = 'mcpRemoteCancelBtn';
    cancelBtn.setAttribute('type', 'button');
    cancelBtn.addEventListener('click', cancelConfirmation);
    var confirmBtn = el('button', 'text-[11px] font-bold px-3 py-2 rounded-xl bg-rose-700 hover:bg-rose-600 text-white', 'Confirmer et exécuter');
    confirmBtn.id = 'mcpRemoteConfirmBtn';
    confirmBtn.setAttribute('type', 'button');
    confirmBtn.disabled = true; // activé uniquement si arguments identiques + confirmation active
    confirmBtn.addEventListener('click', executePrepared);
    btnRow.appendChild(cancelBtn); btnRow.appendChild(confirmBtn);
    body.appendChild(btnRow);

    var argsMismatchSlot = el('div'); argsMismatchSlot.id = 'mcpRemoteArgsMismatch';
    body.appendChild(argsMismatchSlot);

    modal.appendChild(body);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    updateExpiryAndArgsMatch();
    expiryTimer = window.setInterval(updateExpiryAndArgsMatch, 1000);
  }

  function updateExpiryAndArgsMatch() {
    if (!state.prepared) return;
    var expirySlot = document.getElementById('mcpRemoteExpirySlot');
    var confirmBtn = document.getElementById('mcpRemoteConfirmBtn');
    var mismatch = (function () {
      var area = document.getElementById('mcpRemoteArgsArea');
      var argsChanged = false;
      if (area) argsChanged = canonicalForUi(parseArgsTextarea().args) !== state.prepared.argsCanonical;
      return argsChanged;
    })();
    var mismatchSlot = document.getElementById('mcpRemoteArgsMismatch');
    var clock = confirmationClock(state.prepared.confirmation.expiresAt, Date.now());

    if (expirySlot) {
      clearNode(expirySlot);
      var expiresAt = state.prepared.confirmation.expiresAt;
      if (clock.state === 'expired') {
        expirySlot.appendChild(el('div', 'text-[10px] font-semibold text-rose-400', 'Confirmation EXPIRÉE (' + prettyDate(expiresAt) + ') — nouvelle préparation nécessaire.'));
      } else {
        var seconds = Math.floor(clock.remainingMs / 1000);
        var minutes = Math.floor(seconds / 60);
        expirySlot.appendChild(el('div', 'text-[10px] font-semibold text-slate-300', 'Expire dans ' + minutes + ' min ' + (seconds % 60) + ' s (' + prettyDate(expiresAt) + ') — TTL fixe serveur (cap 15 min).'));
      }
    }
    if (mismatchSlot) {
      clearNode(mismatchSlot);
      if (mismatch) {
        mismatchSlot.appendChild(el('div', 'rounded-xl border border-amber-800/60 bg-amber-950/30 text-amber-300 px-3 py-2 text-[10px] font-semibold', 'Arguments modifiés depuis la préparation : la liaison serveur (args hash) ne matcherait pas. Préparez à nouveau pour changer les arguments.'));
      }
    }
    if (confirmBtn) confirmBtn.disabled = mismatch || clock.state === 'expired';
  }
  function prettyDate(epochMs) {
    try { return new Date(epochMs).toLocaleTimeString(); } catch (err) { return String(epochMs); }
  }
  function stopExpiryTimer() {
    if (expiryTimer !== null) {
      window.clearInterval(expiryTimer);
      expiryTimer = null;
    }
  }

  function cancelConfirmation() {
    // Annulation : aucune exécution, la confirmation reste coté serveur
    // jusqu'à expiry (elle sera refusée REJEU à son échéance) — pur frontend.
    stopExpiryTimer();
    var modal = document.getElementById('mcpRemoteConfirmModal');
    if (modal) modal.remove();
    state.prepared = null;
    renderTools();
  }

  // SEUL chemin d'exécution de tout le module — action expresse utilisateur.
  function executePrepared() {
    var confirmBtn = document.getElementById('mcpRemoteConfirmBtn');
    if (!state.prepared || !confirmBtn || confirmBtn.disabled === true) return;
    confirmBtn.disabled = true;
    confirmBtn.appendChild(el('span', 'ml-1', 'exécution…'));
    var callBody = {
      confirmationId: state.prepared.confirmation.confirmationId,
      arguments: state.prepared.args // EXACTEMENT les arguments PREPARED (jamais recopier la textarea)
    };
    apiFetch(API_BASE + '/connectors/' + encodeURIComponent(state.prepared.connectorId) + '/tools/' + encodeURIComponent(state.prepared.toolName) + '/call', { method: 'POST', body: callBody })
      .then(function (result) {
        stopExpiryTimer();
        var modal = document.getElementById('mcpRemoteConfirmModal');
        if (modal) modal.remove();
        var prepared = state.prepared;
        state.prepared = null;
        if (result.status === 200 && result.payload && typeof result.payload.result === 'object' && result.payload.result !== null) {
          if (result.payload.result.isError === true) {
            showCallOutcome(prepared, { kind: 'remote_is_error', label: 'Erreur métier DISTANTE (isError: true)', payload: result.payload });
          } else {
            showCallOutcome(prepared, { kind: 'remote_ok', label: 'Exécution réussie', payload: result.payload });
          }
        } else {
          var outcome = classifyOutcome(result.status, result.payload);
          showCallOutcome(prepared, { kind: outcome.kind, label: 'Exécution refusée : ' + outcome.label, ok: false, status: outcome.status, code: outcome.code, message: outcome.message });
        }
      })
      .catch(function () {
        stopExpiryTimer();
        var modal2 = document.getElementById('mcpRemoteConfirmModal');
        if (modal2) modal2.remove();
        showCallOutcome(state.prepared, { kind: 'transport', label: 'Exécution interrompue : transport impossible', ok: false, message: 'Serveur injoignable (réponse non reçue — état distant inconnu)' });
        state.prepared = null;
      });
  }

  function showCallOutcome(prepared, outcome) {
    var slot = document.getElementById('mcpRemoteCallOutcome');
    if (!slot) {
      // Insère le résultat au-dessus de la liste des outils.
      var right = document.getElementById('mcpRemoteConnectorsRight');
      if (!right) return;
      slot = el('div');
      slot.id = 'mcpRemoteCallOutcome';
      right.insertBefore(slot, right.firstChild);
    }
    clearNode(slot);
    var box = el('div', 'rounded-2xl border p-3 space-y-2 ' + (outcome.kind === 'remote_ok'
      ? 'border-emerald-800/50 bg-emerald-950/30 text-emerald-200'
      : outcome.kind === 'remote_is_error'
        ? 'border-amber-800/60 bg-amber-950/30 text-amber-200'
        : toneClassFor(outcome.kind)));
    box.appendChild(el('div', 'text-[11px] font-bold', (prepared ? (prepared.toolName + ' @ ' + prepared.connectorName + ' — ') : '') + outcome.label));
    if (outcome.status !== undefined && outcome.status !== null) box.appendChild(infoLine('HTTP', String(outcome.status)));
    if (outcome.code) box.appendChild(infoLine('code', outcome.code));
    if (outcome.message) box.appendChild(el('div', 'text-[10px] break-words text-slate-400', outcome.message));
    if (outcome.payload && outcome.payload.result) {
      var res = outcome.payload.result;
      if (Array.isArray(res.content)) {
        box.appendChild(el('div', 'text-[10px] font-bold uppercase tracking-wide mt-1', 'Contenu distant (non fiable)'));
        res.content.forEach(function (item, index) {
          var itemBox = el('div', 'text-[10px] font-mono text-slate-200 bg-[#06080e] border border-[#161a2c] rounded-lg p-2 break-words', prettyJson(item));
          box.appendChild(itemBox);
        });
      } else {
        box.appendChild(el('div', 'text-[10px] font-bold uppercase tracking-wide mt-1', 'Contenu distant (non fiable)'));
        box.appendChild(jsonBlock(res.content));
      }
      if (res.structuredContent !== undefined && res.structuredContent !== null) {
        box.appendChild(el('div', 'text-[10px] font-bold uppercase tracking-wide mt-1', 'structuredContent (non fiable)'));
        box.appendChild(jsonBlock(res.structuredContent));
      }
    }
    var closeOutcome = el('button', 'text-[10px] px-2 py-1 rounded-lg border border-[#1e2748] text-slate-400 hover:text-white', 'Fermer ce résultat');
    closeOutcome.setAttribute('type', 'button');
    closeOutcome.addEventListener('click', function () { if (slot.parentNode) slot.remove(); });
    box.appendChild(closeOutcome);
    slot.appendChild(box);
  }

  /* -------------------------------------------------------------------------
   * Journal (PROJECT_READ — le volet de lecture tenant)
   * --------------------------------------------------------------------- */
  function buildJournalView(view) {
    var card = el('div', 'rounded-2xl border border-[#1a2138] bg-[#0f1220] p-4 space-y-3');
    var header = el('div', 'flex items-center justify-between gap-2');
    header.appendChild(el('div', 'text-[11px] font-bold text-white', 'Journal des opérations MCP distantes (tenant)'));
    var refreshBtn = el('button', 'text-[10px] px-2 py-1 rounded-lg border border-[#1e2748] text-slate-400 hover:text-white', 'Rafraîchir');
    refreshBtn.setAttribute('type', 'button');
    refreshBtn.addEventListener('click', function () { loadJournal(); });
    header.appendChild(refreshBtn);
    card.appendChild(header);
    var listSlot = el('div', 'space-y-2'); listSlot.id = 'mcpRemoteJournalList';
    card.appendChild(listSlot);
    view.appendChild(card);
  }
  function loadJournal() {
    var listSlot = document.getElementById('mcpRemoteJournalList');
    if (!listSlot) return;
    writeFileStatus(listSlot, 'Chargement du journal…', 'text-slate-500');
    apiFetch(API_BASE + '/journal')
      .then(function (result) {
        if (result.status === 200 && result.payload && result.payload.events) {
          state.journal = result.payload.events;
          renderJournal();
        } else {
          var outcome = classifyOutcome(result.status, result.payload);
          clearNode(listSlot);
          var box = el('div', 'rounded-xl border px-3 py-2 text-[11px] ' + toneClassFor(outcome.kind));
          box.appendChild(el('div', 'font-semibold', 'Journal indisponible : ' + outcome.label));
          if (outcome.message) box.appendChild(el('div', 'text-[10px] text-slate-400 break-words', outcome.message));
          listSlot.appendChild(box);
        }
      })
      .catch(function () {
        clearNode(listSlot);
        listSlot.appendChild(el('div', 'text-[11px] text-rose-400', 'Transport impossible (journal).'));
      });
  }
  function renderJournal() {
    var listSlot = document.getElementById('mcpRemoteJournalList');
    if (!listSlot) return;
    clearNode(listSlot);
    if (state.journal.length === 0) {
      listSlot.appendChild(el('div', 'text-[10px] text-slate-500', 'Aucun événement.'));
      return;
    }
    state.journal.forEach(function (event) {
      var row = el('div', 'rounded-xl border border-[#161a2c] bg-[#0b0e1b] p-2 space-y-1');
      var head = el('div', 'flex flex-wrap gap-2 items-center');
      head.appendChild(statusPill(event.status || '—', event.status === 'SUCCESS' ? 'bg-emerald-950/50 text-emerald-300' : 'bg-rose-950/50 text-rose-300'));
      head.appendChild(el('span', 'text-[10px] font-semibold text-slate-200 font-mono', event.action || '—'));
      head.appendChild(el('span', 'text-[9px] text-slate-500 font-mono', event.timestamp || ''));
      row.appendChild(head);
      row.appendChild(infoLine('ressource', event.resourceId));
      row.appendChild(infoLine('utilisateur', event.userId));
      if (event.metadata !== undefined && event.metadata !== null) {
        row.appendChild(jsonBlock(event.metadata));
      }
      listSlot.appendChild(row);
    });
  }

  /* -------------------------------------------------------------------------
   * Montage
   * --------------------------------------------------------------------- */
  function boot() {
    mountUi();
  }

  // Surface de test/introspection pure (aucun contenu sensible contenu).
  window.__mcpRemoteInternals = {
    canonicalForUi: canonicalForUi,
    classifyOutcome: classifyOutcome,
    confirmationClock: confirmationClock,
    API_BASE: API_BASE
  };

  // DÉCONNEXION DU SHELL (menu utilisateur) — quand le Studio se déconnecte
  // (logoutAuth() dans index.html), la session mémoire de ce module doit
  // partir aussi (sinon ses appels continuaient avec un Bearer orphelin).
  // Évènement natif window -> aucune dépendance inverse vers le shell.
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('vibecode:auth-logout', function () {
      if (state.session.token || state.session.user) {
        state.session.token = null;
        state.session.user = null;
        try { renderSessionView(); } catch (eRender) { /* jamais bloquant */ }
      }
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }
})();
