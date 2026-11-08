/**
 * LOT UI-MCP — Studio : page « Gestion MCP » (espace ADMINISTRATEUR).
 *
 * Mandat : pilotage du CATALOGUE GLOBAL MCP sur les contrats backend
 * existants (aucune deuxième couche de gestion, aucune exécution d'outil) :
 *
 *   - tableau de bord      : GET  /api/v1/mcp/admin/stats
 *                            (chiffres RÉELS : catalogue par statut, santé,
 *                             connexions en agrégats, imports personnels en
 *                             compteurs uniquement, dernières opérations) ;
 *   - consultation         : GET  /api/v1/mcp/admin/catalog (+filtres serveur)
 *   - création             : POST /api/v1/mcp/admin/catalog   (toujours BROUILLON)
 *   - modification         : PATCH /api/v1/mcp/admin/catalog/:id (whitelist)
 *   - publication          : POST /api/v1/mcp/admin/catalog/:id/status
 *                            (matrice EXCLUSIVE côté serveur → 409 sinon) ;
 *   - suppression          : DELETE /:id (409 MCP_CATALOG_DEPENDENCY si instances) ;
 *   - test de santé        : POST /:id/test (politique SSRF serveur, 200 {ok}) ;
 *   - historique           : GET  /:id/history (opérations ADMIN auditées).
 *
 * Chaque opération sensible est vérifiée PAR LE SERVEUR (MCP_CATALOG_MANAGE,
 * OWNER/ADMIN) et auditée côté backend. Les boutons de cette page sont
 * COSMÉTIQUES : masquer un bouton ne protège rien — les accès directs aux
 * endpoints sont testés (suite separation).
 *
 * Sécurité DOM (héritage B4/mcp-hub) : construction exclusive via
 * createElement + textContent (aucun innerHTML, aucun eval, aucun classList).
 * Aucun secret n'est affiché ni journalisé par ce module.
 */
(function () {
  'use strict';

  /* ---------------------------------------------------------------------------
   * Contrats
   * ---------------------------------------------------------------------- */
  var STATS_PATH = '/api/v1/mcp/admin/stats';
  var ADMIN_BASE = '/api/v1/mcp/admin/catalog';
  var TOKEN_KEY = 'vibecode_auth_token';

  var STATUSES = ['BROUILLON', 'VALIDATION', 'PUBLIE', 'DESACTIVE'];
  var STATUS_LABELS = {
    BROUILLON: 'Brouillon',
    VALIDATION: 'En validation',
    PUBLIE: 'Publié',
    DESACTIVE: 'Désactivé'
  };
  var STATUS_PILLS = {
    BROUILLON: 'text-[9px] px-2 py-0.5 rounded-full font-bold bg-slate-800 text-slate-300 border border-white/10',
    VALIDATION: 'text-[9px] px-2 py-0.5 rounded-full font-bold bg-amber-950/60 text-amber-300 border border-amber-900/40',
    PUBLIE: 'text-[9px] px-2 py-0.5 rounded-full font-bold bg-emerald-950/60 text-emerald-300 border border-emerald-900/40',
    DESACTIVE: 'text-[9px] px-2 py-0.5 rounded-full font-bold bg-rose-950/60 text-rose-300 border border-rose-900/40'
  };
  /** Miroir CLIENT de la matrice serveur (le serveur reste l'autorité : 409 sinon). */
  var TRANSITIONS = {
    BROUILLON: [{ to: 'VALIDATION', label: 'Envoyer en validation' }],
    VALIDATION: [{ to: 'PUBLIE', label: 'Publier' }, { to: 'BROUILLON', label: 'Revenir en brouillon' }],
    PUBLIE: [{ to: 'DESACTIVE', label: 'Désactiver (dépublier)' }],
    DESACTIVE: [{ to: 'PUBLIE', label: 'Republier' }, { to: 'BROUILLON', label: 'Revenir en brouillon' }]
  };
  var ACTION_LABELS = {
    MCP_CATALOG_CREATED: 'Création',
    MCP_CATALOG_UPDATED: 'Modification',
    MCP_CATALOG_DELETED: 'Suppression',
    MCP_CATALOG_TRANSITIONED: 'Changement de statut',
    MCP_CATALOG_TESTED: 'Test de santé'
  };

  /* ---------------------------------------------------------------------------
   * Helpers DOM purs (aucun innerHTML, aucun classList)
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
  function input(textPlaceholder, inputType) {
    var node = el('input', 'w-full bg-[#0e1322] border border-[#20273a] rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:border-violet-500/60 focus:outline-none');
    node.setAttribute('type', inputType || 'text');
    node.setAttribute('placeholder', String(textPlaceholder || ''));
    return node;
  }
  function button(labelText, cls, listener, disabled) {
    var b = el('button', cls || BTN_SOFT, String(labelText));
    if (disabled) b.disabled = true;
    if (listener) b.addEventListener('click', listener);
    return b;
  }
  function pill(text, cls) { return el('span', cls || PILL_INFO, String(text)); }
  /** Compteur sûr (les stats servies sont numériques ; tout autre type → fallback). */
  function nz(value, fallback) { return typeof value === 'number' && isFinite(value) ? value : fallback; }

  var PILL_OK = 'text-[9px] px-2 py-0.5 rounded-full font-bold bg-emerald-950/60 text-emerald-300 border border-emerald-900/40';
  var PILL_INFO = 'text-[9px] px-2 py-0.5 rounded-full font-bold bg-white/[0.06] text-slate-300 border border-white/10';
  var PILL_WARN = 'text-[9px] px-2 py-0.5 rounded-full font-bold bg-amber-950/60 text-amber-300 border border-amber-900/40';
  var PILL_ERR = 'text-[9px] px-2 py-0.5 rounded-full font-bold bg-rose-950/60 text-rose-300 border border-rose-900/40';
  var PILL_MUTED = 'text-[9px] px-2 py-0.5 rounded-full font-bold bg-slate-800 text-slate-400';

  var BTN_SOFT = 'px-3 py-1.5 rounded-lg bg-[#141a24] hover:bg-[#1a2130] border border-[#20273a] text-slate-200 text-[11px] font-semibold transition';
  var BTN_PRIMARY = 'px-3.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-bold transition';
  var BTN_DANGER = 'px-3 py-1.5 rounded-lg bg-rose-950/50 hover:bg-rose-900/50 border border-rose-900/40 text-rose-200 text-[11px] font-semibold transition';
  var CARD = 'rounded-xl border border-[#1a2138] bg-[#0b0e1b] p-4 space-y-2';
  var STAT_CARD = 'rounded-xl border border-[#1a2138] bg-[#0b0e1b] p-3 space-y-1';

  /* ---------------------------------------------------------------------------
   * État
   * ---------------------------------------------------------------------- */
  var state = {
    accessToken: '',
    role: 'UNKNOWN',
    // Données réelles
    stats: null,             // corps de /admin/stats
    entries: [],             // corps de /admin/catalog (tous statuts)
    historyId: '',           // entrée dont l'historique est ouvert
    history: [],
    historyLoading: false,
    historyError: '',
    // UI
    query: '',
    statusFilter: '',
    categoryFilter: '',
    loading: false,
    loadError: '',           // erreur globale de chargement (403 → refus)
    adminDenied: false,      // 403 serveur sur la surface admin
    toast: '',
    busyId: '',
    showCreate: false,
    editingId: '',
    testResults: {}          // { catalogId: { ok, message } } (affichage local)
  };

  var refs = {
    root: null, statusLine: null, dashBoard: null, opList: null,
    toolbar: null, filterRows: null, list: null, createWrap: null, searchInput: null
  };

  /* ---------------------------------------------------------------------------
   * Session
   * ---------------------------------------------------------------------- */
  function readStoredToken() {
    try {
      if (typeof localStorage === 'undefined') return '';
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch (tokenError) { return ''; }
  }
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
  function applyToken(token) {
    state.accessToken = token || '';
    state.role = 'UNKNOWN';
    var payload = decodeJwtPayload(token);
    if (payload && (payload.role === 'OWNER' || payload.role === 'ADMIN' || payload.role === 'ENGINEER' || payload.role === 'VIEWER')) {
      state.role = payload.role;
    }
  }
  /** Rôle porteur de MCP_CATALOG_MANAGE (cosmétique — le serveur vérifie). */
  function roleManagesCatalog() { return state.role === 'OWNER' || state.role === 'ADMIN'; }

  /* ---------------------------------------------------------------------------
   * Transport HTTP
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
      return res.text().then(function (text) {
        var body = null;
        try { body = text ? JSON.parse(text) : null; } catch (parseError) { body = null; }
        return { ok: res.ok, status: res.status, body: body, text: text };
      });
    });
  }

  function describeApiError(status, body) {
    var error = body && typeof body === 'object' && body.error && typeof body.error === 'object'
      ? body.error : null;
    var code = error && typeof error.code === 'string' ? error.code : '';
    var message = error && typeof error.message === 'string' ? error.message : '';
    if (status === 401) return 'Session requise ou expirée — reconnectez-vous.';
    if (status === 403) return 'Accès administrateur refusé par le serveur.' + (code ? ' (' + code + ')' : '');
    if (status === 404) return 'Entrée introuvable (supprimée ou inexistante).';
    if (status === 409) {
      if (code === 'MCP_CATALOG_INVALID_TRANSITION') return 'Transition refusée par le serveur : ' + (message || 'état source/destination illégal.');
      if (code === 'MCP_CATALOG_DEPENDENCY') return 'Suppression bloquée : ' + (message || 'des instances d\'activation existent encore.');
      return message || ('Conflit (' + (code || '409') + ')');
    }
    if (status === 400) return message || ('Requête invalide (' + (code || '400') + ')');
    if (status === 429) return 'Trop de tentatives — réessayez plus tard.';
    if (status >= 500) return 'Erreur du serveur — réessayez plus tard.';
    return message || (code !== '' ? code : 'Erreur réseau.');
  }

  /* ---------------------------------------------------------------------------
   * Filtres purs (testables sans DOM)
   * ---------------------------------------------------------------------- */
  function normalizeText(value) {
    var raw = typeof value === 'string' ? value.toLowerCase() : '';
    try {
      return raw.normalize('NFD').replace(/[̀-ͯ]/g, '');
    } catch (normalizeError) { return raw; }
  }
  function matchesFilters(entry, query, statusFilter, categoryFilter) {
    if (statusFilter !== '' && entry.status !== statusFilter) return false;
    if (categoryFilter !== '' && entry.category !== categoryFilter) return false;
    var needle = normalizeText(query).trim();
    if (needle === '') return true;
    var haystack = normalizeText(
      String(entry.name || '') + ' ' + String(entry.description || '') + ' ' +
      String(entry.category || '') + ' ' + String(entry.url || ''));
    return haystack.indexOf(needle) !== -1;
  }
  function visibleEntries() {
    return state.entries.filter(function (one) {
      return matchesFilters(one, state.query, state.statusFilter, state.categoryFilter);
    });
  }
  /** Cibles légales affichées pour un statut (la matrice SERVEUR arbitre). */
  function transitionTargets(status) {
    return Array.isArray(TRANSITIONS[status]) ? TRANSITIONS[status] : [];
  }

  /* ---------------------------------------------------------------------------
   * Chargements
   * ---------------------------------------------------------------------- */
  function loadAll() {
    state.loading = true;
    state.loadError = '';
    state.adminDenied = false;
    renderStatus();
    Promise.all([apiFetch(STATS_PATH, {}), apiFetch(ADMIN_BASE, {})]).then(function (results) {
      var statsOut = results[0];
      var listOut = results[1];
      state.loading = false;
      var denied = (!statsOut.ok && statsOut.status === 403) || (!listOut.ok && listOut.status === 403);
      if (denied) {
        state.adminDenied = true;
        state.loadError = 'Accès administrateur requis (MCP_CATALOG_MANAGE). Le serveur a refusé cette surface.';
        state.stats = null;
        state.entries = [];
      } else if (!statsOut.ok || !listOut.ok) {
        var failing = !statsOut.ok ? statsOut : listOut;
        state.loadError = describeApiError(failing.status, failing.body);
        state.stats = statsOut.ok ? statsOut.body : state.stats;
        state.entries = listOut.ok && listOut.body && Array.isArray(listOut.body.entries) ? listOut.body.entries : state.entries;
      } else {
        state.stats = statsOut.body || null;
        state.entries = listOut.body && Array.isArray(listOut.body.entries) ? listOut.body.entries : [];
        state.loadError = '';
      }
      renderAll();
    }).catch(function () {
      state.loading = false;
      state.loadError = 'Serveur injoignable.';
      renderAll();
    });
  }

  function reloadList() {
    apiFetch(ADMIN_BASE, {}).then(function (out) {
      if (out.ok && out.body && Array.isArray(out.body.entries)) {
        state.entries = out.body.entries;
      }
      renderListArea();
    }).catch(function () { /* déjà signalé globalement */ });
  }

  function reloadStats() {
    apiFetch(STATS_PATH, {}).then(function (out) {
      if (out.ok) state.stats = out.body || null;
      renderDashboard();
    }).catch(function () { /* déjà signalé globalement */ });
  }

  /** Rechargement complet après une mutation (les chiffres restent RÉELS). */
  function reloadAfterMutation() {
    loadAll();
    if (state.historyId !== '') loadHistory(state.historyId);
  }

  /* ---------------------------------------------------------------------------
   * Mutations
   * ---------------------------------------------------------------------- */
  function finishMutation(out, okMessage) {
    state.busyId = '';
    if (!out.ok) {
      state.loadError = describeApiError(out.status, out.body);
      if (out.status === 403) state.adminDenied = true;
      state.toast = '';
      renderStatus();
      renderListArea();
      return false;
    }
    state.loadError = '';
    state.adminDenied = false;
    state.toast = okMessage;
    return true;
  }

  function createEntry(payload) {
    state.busyId = '__create__';
    renderStatus();
    apiFetch(ADMIN_BASE, { method: 'POST', body: payload }).then(function (out) {
      var ok = finishMutation(out, 'Entrée créée en BROUILLON (statut initial forcé par le serveur).');
      if (ok) {
        state.showCreate = false;
      }
      reloadAfterMutation();
    }).catch(function () {
      state.busyId = '';
      state.loadError = 'Serveur injoignable.';
      renderStatus();
    });
  }

  function patchEntry(catalogId, patch) {
    state.busyId = catalogId;
    renderStatus();
    renderListArea();
    apiFetch(ADMIN_BASE + '/' + encodeURIComponent(catalogId), { method: 'PATCH', body: patch }).then(function (out) {
      var ok = finishMutation(out, 'Entrée mise à jour (version incrémentée).');
      if (ok) state.editingId = '';
      reloadAfterMutation();
    }).catch(function () {
      state.busyId = '';
      state.loadError = 'Serveur injoignable.';
      renderStatus();
    });
  }

  function transitionEntry(catalogId, status) {
    state.busyId = catalogId;
    renderStatus();
    renderListArea();
    apiFetch(ADMIN_BASE + '/' + encodeURIComponent(catalogId) + '/status', {
      method: 'POST',
      body: { status: status }
    }).then(function (out) {
      finishMutation(out, 'Statut maintenant : ' + (STATUS_LABELS[status] || status) + '.');
      reloadAfterMutation();
    }).catch(function () {
      state.busyId = '';
      state.loadError = 'Serveur injoignable.';
      renderStatus();
    });
  }

  function deleteEntry(catalogId, name) {
    var confirmed = true;
    if (typeof confirm === 'function') {
      confirmed = confirm('Supprimer définitivement l\'entrée « ' + name + ' » du catalogue global ?');
    }
    if (!confirmed) return;
    state.busyId = catalogId;
    renderStatus();
    renderListArea();
    apiFetch(ADMIN_BASE + '/' + encodeURIComponent(catalogId), { method: 'DELETE' }).then(function (out) {
      finishMutation(out, 'Entrée supprimée du catalogue.');
      if (state.historyId === catalogId) { state.historyId = ''; state.history = []; }
      reloadAfterMutation();
    }).catch(function () {
      state.busyId = '';
      state.loadError = 'Serveur injoignable.';
      renderStatus();
    });
  }

  function testEntry(catalogId) {
    state.busyId = catalogId;
    renderStatus();
    renderListArea();
    apiFetch(ADMIN_BASE + '/' + encodeURIComponent(catalogId) + '/test', { method: 'POST', body: {} }).then(function (out) {
      state.busyId = '';
      if (!out.ok) {
        state.loadError = describeApiError(out.status, out.body);
        renderStatus();
        renderListArea();
        return;
      }
      var body = out.body || {};
      if (body.ok === true) {
        // Le succès efface l'éventuel échec précédent (sinon l'ancien message
        // d'erreur masquerait ce toast dans la ligne d'état).
        state.loadError = '';
        state.adminDenied = false;
        state.testResults[catalogId] = {
          ok: true,
          message: 'Connexion réussie' + (body.serverName ? ' (' + body.serverName + (body.serverVersion ? ' ' + body.serverVersion : '') + ')' : '')
        };
        state.toast = 'Test réussi pour cette entrée.';
      } else {
        var err = body.error && typeof body.error === 'object' ? body.error : {};
        state.testResults[catalogId] = {
          ok: false,
          message: (typeof err.message === 'string' && err.message ? err.message : 'cible injoignable') +
            (err.code ? ' (' + err.code + ')' : '')
        };
        state.toast = '';
        state.loadError = 'Test en échec : ' + state.testResults[catalogId].message;
      }
      renderStatus();
      reloadList();
      reloadStats();
    }).catch(function () {
      state.busyId = '';
      state.loadError = 'Serveur injoignable.';
      renderStatus();
    });
  }

  function loadHistory(catalogId) {
    if (state.historyId === catalogId) {
      // Refermer.
      state.historyId = '';
      state.history = [];
      renderListArea();
      return;
    }
    state.historyId = catalogId;
    state.historyLoading = true;
    state.historyError = '';
    state.history = [];
    renderListArea();
    apiFetch(ADMIN_BASE + '/' + encodeURIComponent(catalogId) + '/history', {}).then(function (out) {
      state.historyLoading = false;
      if (!out.ok) {
        state.historyError = describeApiError(out.status, out.body);
        state.history = [];
      } else {
        state.history = out.body && Array.isArray(out.body.history) ? out.body.history : [];
      }
      renderListArea();
    }).catch(function () {
      state.historyLoading = false;
      state.historyError = 'Serveur injoignable.';
      renderListArea();
    });
  }

  /* ---------------------------------------------------------------------------
   * Rendu — statut global
   * ---------------------------------------------------------------------- */
  function renderStatus() {
    if (!refs.statusLine) return;
    clearNode(refs.statusLine);
    var text = state.loadError !== '' ? state.loadError
      : (state.toast !== '' ? state.toast : '');
    if (text === '') return;
    var isError = state.loadError !== '';
    refs.statusLine.className = 'text-[11px] ' + (isError ? 'text-rose-300' : 'text-emerald-300');
    refs.statusLine.textContent = text;
  }

  /* ---------------------------------------------------------------------------
   * Rendu — tableau de bord (chiffres RÉELS du backend)
   * ---------------------------------------------------------------------- */
  function statCard(label, value, extra, accentClass) {
    var card = el('div', STAT_CARD);
    card.appendChild(el('div', 'text-[10px] font-semibold text-slate-500 uppercase tracking-wide', String(label)));
    card.appendChild(el('div', 'text-xl font-bold ' + (accentClass || 'text-white'), String(value)));
    if (extra) card.appendChild(el('div', 'text-[10px] text-slate-500', String(extra)));
    return card;
  }

  function renderDashboard() {
    if (!refs.dashBoard) return;
    clearNode(refs.dashBoard);
    if (state.loading && state.stats === null) {
      var loading = el('div', 'text-xs text-slate-500 italic', 'Chargement des statistiques…');
      loading.setAttribute('role', 'status');
      refs.dashBoard.appendChild(loading);
      return;
    }
    if (state.stats === null) {
      var unavailable = el('div', 'text-xs text-slate-500 italic',
        state.adminDenied ? 'Statistiques indisponibles : accès administrateur requis.' : 'Statistiques indisponibles.');
      unavailable.setAttribute('data-state', 'empty');
      refs.dashBoard.appendChild(unavailable);
      return;
    }
    var stats = state.stats;
    var catalog = stats.catalog || {};
    var byStatus = catalog.byStatus || {};
    var health = catalog.health || {};
    var connections = stats.connections || {};
    var lastTest = connections.lastTest || {};
    var personal = stats.personalImports || {};

    var grid = el('div', 'grid grid-cols-2 md:grid-cols-4 gap-3');
    grid.appendChild(statCard('Catalogue — total', nz(catalog.total, 0), 'entrées tous statuts'));
    grid.appendChild(statCard('Publiés', nz(byStatus.PUBLIE, 0), 'visibles des utilisateurs', 'text-emerald-300'));
    grid.appendChild(statCard('Désactivés', nz(byStatus.DESACTIVE, 0), 'retirés de la bibliothèque', 'text-rose-300'));
    grid.appendChild(statCard('En validation', nz(byStatus.VALIDATION, 0), 'en attente de publication', 'text-amber-300'));
    grid.appendChild(statCard('Brouillons', nz(byStatus.BROUILLON, 0), 'non soumis'));
    grid.appendChild(statCard('Santé : OK', nz(health.ok, 0), 'dernier test réussi', 'text-emerald-300'));
    grid.appendChild(statCard('Santé : échecs', nz(health.failed, 0), 'dernier test en échec', 'text-rose-300'));
    grid.appendChild(statCard('Jamais testés', nz(health.neverTested, 0), 'aucun test déclenché'));
    refs.dashBoard.appendChild(grid);

    var second = el('div', 'grid grid-cols-1 md:grid-cols-3 gap-3 pt-1');
    // Imports personnels — AGRÉGATS uniquement (jamais de lignes individuelles).
    var personalCard = el('div', STAT_CARD);
    personalCard.appendChild(el('div', 'text-[10px] font-semibold text-slate-500 uppercase tracking-wide', 'Imports personnels (agrégats)'));
    personalCard.appendChild(el('div', 'text-lg font-bold text-white', nz(personal.total, 0) + ' imports'));
    personalCard.appendChild(el('div', 'text-[10px] text-slate-500',
      nz(personal.enabled, 0) + ' actifs — compteurs agrégés uniquement, aucune donnée de ligne, aucun secret.'));
    personalCard.setAttribute('data-card', 'personal-aggregates');
    second.appendChild(personalCard);

    // État global des connexions (compteurs par portée).
    var connCard = el('div', STAT_CARD);
    connCard.appendChild(el('div', 'text-[10px] font-semibold text-slate-500 uppercase tracking-wide', 'État global des connexions'));
    var byScope = Array.isArray(connections.byScope) ? connections.byScope : [];
    if (byScope.length === 0) {
      connCard.appendChild(el('div', 'text-[10px] text-slate-500', 'Aucune connexion enregistrée.'));
    } else {
      byScope.forEach(function (one) {
        connCard.appendChild(el('div', 'text-[11px] text-slate-300',
          String(one.scope) + ' : ' + one.total + ' total, ' + one.enabled + ' actives'));
      });
    }
    connCard.appendChild(el('div', 'text-[10px] text-slate-500 mt-1',
      'Tests : ' + nz(lastTest.ok, 0) + ' OK / ' + nz(lastTest.failed, 0) + ' échecs / ' + nz(lastTest.neverTested, 0) + ' jamais testés'));
    connCard.setAttribute('data-card', 'connections');
    second.appendChild(connCard);

    // Catégories (compteurs réels).
    var catCard = el('div', STAT_CARD);
    catCard.appendChild(el('div', 'text-[10px] font-semibold text-slate-500 uppercase tracking-wide', 'Catégories'));
    var byCategory = Array.isArray(catalog.byCategory) ? catalog.byCategory : [];
    if (byCategory.length === 0) {
      catCard.appendChild(el('div', 'text-[10px] text-slate-500', 'Aucune catégorie.'));
    } else {
      byCategory.forEach(function (one) {
        catCard.appendChild(el('div', 'text-[11px] text-slate-300', String(one.category) + ' : ' + one.count));
      });
    }
    second.appendChild(catCard);
    refs.dashBoard.appendChild(second);

    // Dernières opérations administratives.
    refs.dashBoard.appendChild(el('h5', 'text-xs font-semibold text-white pt-2', 'Dernières opérations administratives'));
    clearNode(refs.opList);
    var ops = Array.isArray(stats.recentOperations) ? stats.recentOperations : [];
    if (ops.length === 0) {
      var noOps = el('div', 'text-[11px] text-slate-500 italic', 'Aucune opération administrative enregistrée.');
      noOps.setAttribute('data-state', 'empty-ops');
      refs.opList.appendChild(noOps);
    } else {
      ops.forEach(function (op) {
        var row = el('div', 'flex items-center justify-between gap-2 py-1 border-b border-[#141a2e] last:border-0');
        var left = el('div', 'flex items-center gap-2 min-w-0');
        left.appendChild(pill(ACTION_LABELS[op.action] || String(op.action),
          op.status === 'FAILURE' ? PILL_ERR : PILL_INFO));
        left.appendChild(el('span', 'text-[10px] font-mono text-slate-500 truncate', String(op.resourceId || '')));
        row.appendChild(left);
        var right = el('div', 'flex items-center gap-2 shrink-0');
        right.appendChild(el('span', 'text-[9px] text-slate-500', String(op.userId || '')));
        right.appendChild(el('span', 'text-[9px] font-mono text-slate-600', String(op.timestamp || '')));
        row.appendChild(right);
        refs.opList.appendChild(row);
      });
    }
  }

  /* ---------------------------------------------------------------------------
   * Rendu — formulaire de création
   * ---------------------------------------------------------------------- */
  function field(labelText, control) {
    var wrap = el('label', 'block space-y-1');
    wrap.appendChild(el('span', 'block text-[10px] font-semibold text-slate-400', String(labelText)));
    wrap.appendChild(control);
    return wrap;
  }

  function renderCreateWrap() {
    if (!refs.createWrap) return;
    clearNode(refs.createWrap);
    if (!state.showCreate) return;

    var form = el('div', 'rounded-xl border border-violet-500/30 bg-violet-950/10 p-4 space-y-3');
    form.appendChild(el('div', 'text-xs font-bold text-white', 'Nouvelle entrée de catalogue'));
    form.appendChild(el('p', 'text-[10px] text-slate-500',
      'L\'entrée naît systématiquement en BROUILLON : la publication passe par le cycle contrôlé ' +
      'BROUILLON → VALIDATION → PUBLIE → DÉSACTIVÉ (transitions validées par le serveur).'));

    var nameInput = input('Nom du connecteur', 'text');
    var descInput = input('Description courte affichée aux utilisateurs', 'text');
    var iconInput = input('Icône (emoji, ex. 📚)', 'text');
    var categoryInput = input('Catégorie (ex. productivite, outils, divers)', 'text');
    var urlInput = input('https://api.exemple.org/mcp', 'text');
    var visibilitySelect = el('select', 'w-full bg-[#0e1322] border border-[#20273a] rounded-lg px-3 py-2 text-xs text-slate-200');
    ['public', 'prive'].forEach(function (value) {
      var opt = el('option', '', value === 'public' ? 'public — visible des utilisateurs' : 'prive — masquée aux utilisateurs');
      opt.setAttribute('value', value);
      visibilitySelect.appendChild(opt);
    });

    form.appendChild(field('Nom *', nameInput));
    form.appendChild(field('Description', descInput));
    form.appendChild(field('Icône', iconInput));
    form.appendChild(field('Catégorie', categoryInput));
    form.appendChild(field('URL / endpoint (transport url) *', urlInput));
    form.appendChild(field('Visibilité', visibilitySelect));

    var row = el('div', 'flex items-center gap-2 flex-wrap');
    row.appendChild(button(state.busyId === '__create__' ? 'Création…' : 'Créer en brouillon', BTN_PRIMARY, function () {
      var payload = {
        name: String(nameInput.value || '').trim(),
        url: String(urlInput.value || '').trim()
      };
      var desc = String(descInput.value || '').trim();
      var icon = String(iconInput.value || '').trim();
      var category = String(categoryInput.value || '').trim();
      if (desc !== '') payload.description = desc;
      if (icon !== '') payload.icon = icon;
      if (category !== '') payload.category = category;
      payload.visibility = visibilitySelect.value === 'prive' ? 'prive' : 'public';
      if (payload.name === '' || payload.url === '') {
        state.loadError = 'Nom et URL obligatoires.';
        renderStatus();
        return;
      }
      createEntry(payload);
    }, state.busyId === '__create__'));
    row.appendChild(button('Annuler', BTN_SOFT, function () {
      state.showCreate = false;
      renderCreateWrap();
    }));
    form.appendChild(row);
    refs.createWrap.appendChild(form);
  }

  /* ---------------------------------------------------------------------------
   * Rendu — filtres + liste
   * ---------------------------------------------------------------------- */
  function renderToolbar() {
    if (!refs.filterRows) return;
    clearNode(refs.filterRows);
    if (state.adminDenied) return;

    var statusRow = el('div', 'flex items-center gap-1.5 flex-wrap pt-1');
    var options = [{ key: '', label: 'Tous statuts (' + state.entries.length + ')' }].concat(
      STATUSES.map(function (status) {
        var count = state.entries.filter(function (one) { return one.status === status; }).length;
        return { key: status, label: (STATUS_LABELS[status] || status) + ' (' + count + ')' };
      })
    );
    options.forEach(function (option) {
      var active = state.statusFilter === option.key;
      var cls = active
        ? 'px-2.5 py-1 rounded-full text-[10px] font-bold bg-violet-600 text-white transition'
        : 'px-2.5 py-1 rounded-full text-[10px] font-semibold bg-[#141a24] border border-[#20273a] text-slate-400 hover:text-white transition';
      var b = button(option.label, cls, function () {
        state.statusFilter = option.key;
        renderListArea();
      });
      b.setAttribute('data-status-filter', option.key);
      statusRow.appendChild(b);
    });
    refs.filterRows.appendChild(statusRow);

    // Catégories réellement présentes.
    var categories = [];
    state.entries.forEach(function (one) {
      if (one.category && categories.indexOf(one.category) === -1) categories.push(one.category);
    });
    categories.sort();
    if (categories.length > 0) {
      var catRow = el('div', 'flex items-center gap-1.5 flex-wrap pt-1');
      [{ key: '', label: 'Toutes catégories' }].concat(categories.map(function (category) {
        return { key: category, label: category };
      })).forEach(function (option) {
        var active = state.categoryFilter === option.key;
        var cls = active
          ? 'px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-700 text-white transition'
          : 'px-2.5 py-1 rounded-full text-[10px] font-semibold bg-[#141a24] border border-[#20273a] text-slate-400 hover:text-white transition';
        var b = button(option.label, cls, function () {
          state.categoryFilter = option.key;
          renderListArea();
        });
        b.setAttribute('data-category-filter', option.key);
        catRow.appendChild(b);
      });
      refs.filterRows.appendChild(catRow);
    }

    var actions = el('div', 'flex items-center gap-2 flex-wrap pt-2');
    actions.appendChild(button(state.showCreate ? 'Fermer' : '＋ Nouvelle entrée', BTN_PRIMARY, function () {
      state.showCreate = !state.showCreate;
      renderToolbar();
      renderCreateWrap();
    }));
    actions.appendChild(button('Actualiser', BTN_SOFT, function () { loadAll(); }));
    refs.filterRows.appendChild(actions);
  }

  function entryRow(entry) {
    var row = el('div', CARD);
    row.setAttribute('data-catalog-id', String(entry.catalogId));
    var busy = state.busyId === entry.catalogId;

    var head = el('div', 'flex items-start justify-between gap-2 flex-wrap');
    var idBlock = el('div', 'flex items-center gap-2.5 min-w-0');
    idBlock.appendChild(el('div', 'w-9 h-9 shrink-0 rounded-lg bg-[#12162a] border border-[#1e2748] flex items-center justify-center text-lg',
      entry.icon ? String(entry.icon) : '🔌'));
    var texts = el('div', 'min-w-0');
    texts.appendChild(el('div', 'text-xs font-bold text-white', String(entry.name || '')));
    texts.appendChild(el('div', 'text-[10px] text-slate-500 font-mono break-all', String(entry.url || '')));
    idBlock.appendChild(texts);
    head.appendChild(idBlock);
    var pills = el('div', 'flex items-center gap-1.5 flex-wrap shrink-0');
    pills.appendChild(pill(STATUS_LABELS[entry.status] || String(entry.status), STATUS_PILLS[entry.status] || PILL_INFO));
    pills.appendChild(pill(entry.visibility === 'prive' ? 'privée' : 'publique',
      entry.visibility === 'prive' ? PILL_WARN : PILL_MUTED));
    pills.appendChild(pill('v' + entry.version, PILL_MUTED));
    head.appendChild(pills);
    row.appendChild(head);

    if (entry.description) {
      row.appendChild(el('p', 'text-[11px] leading-relaxed text-slate-400', String(entry.description)));
    }

    var meta = el('div', 'flex items-center gap-1.5 flex-wrap');
    meta.appendChild(pill(String(entry.category || 'sans catégorie'), PILL_INFO));
    meta.appendChild(pill(String(entry.transport || 'url'), PILL_INFO));
    meta.appendChild(el('span', 'text-[9px] text-slate-500',
      entry.activationCount + ' activation(s)'));
    meta.appendChild(el('span', 'text-[9px] text-slate-500',
      'Modifiée le ' + String(entry.updatedAt || '').replace('T', ' ').slice(0, 16)));
    if (entry.createdBy) meta.appendChild(el('span', 'text-[9px] text-slate-600', 'par ' + String(entry.createdBy)));
    row.appendChild(meta);

    // Dernier test connu (aucun secret — code transport seul côté store).
    if (entry.lastTest && typeof entry.lastTest === 'object') {
      var testLine = el('div', 'text-[10px] ' + (entry.lastTest.status === 'OK' ? 'text-emerald-300/80' : 'text-amber-300/80'),
        'Dernier test : ' + String(entry.lastTest.status) +
        (entry.lastTest.at ? ' — ' + String(entry.lastTest.at).replace('T', ' ').slice(0, 16) : '') +
        (entry.lastTest.detail ? ' (' + String(entry.lastTest.detail) + ')' : ''));
      row.appendChild(testLine);
    }
    var localTest = state.testResults[entry.catalogId];
    if (localTest) {
      row.appendChild(el('div', 'text-[10px] ' + (localTest.ok ? 'text-emerald-300/80' : 'text-rose-300/80'),
        (localTest.ok ? 'Test récent : succès' : 'Test récent : échec') + ' — ' + localTest.message));
    }

    // Actions de gouvernance.
    var actions = el('div', 'flex items-center gap-2 flex-wrap pt-1');
    transitionTargets(entry.status).forEach(function (transition) {
      actions.appendChild(button(busy ? '…' : transition.label,
        transition.to === 'PUBLIE' ? BTN_PRIMARY : BTN_SOFT,
        function () { transitionEntry(entry.catalogId, transition.to); },
        busy));
    });
    actions.appendChild(button(busy ? '…' : 'Tester la connexion', BTN_SOFT, function () {
      testEntry(entry.catalogId);
    }, busy));
    actions.appendChild(button('Historique', BTN_SOFT, function () {
      loadHistory(entry.catalogId);
    }));
    actions.appendChild(button('Modifier', BTN_SOFT, function () {
      state.editingId = state.editingId === entry.catalogId ? '' : entry.catalogId;
      renderListArea();
    }, busy));
    actions.appendChild(button('Supprimer', BTN_DANGER, function () {
      deleteEntry(entry.catalogId, String(entry.name || ''));
    }, busy));
    row.appendChild(actions);

    if (state.editingId === entry.catalogId) row.appendChild(editForm(entry));
    if (state.historyId === entry.catalogId) row.appendChild(historyPanel(entry));
    return row;
  }

  function editForm(entry) {
    var wrap = el('div', 'rounded-lg border border-[#20273a] bg-[#0e1322] p-3 space-y-2');
    wrap.appendChild(el('div', 'text-[10px] font-bold text-slate-300 uppercase tracking-wide', 'Modifier l\'entrée'));
    var nameInput = input('Nom', 'text'); nameInput.value = String(entry.name || '');
    var descInput = input('Description', 'text'); descInput.value = String(entry.description || '');
    var iconInput = input('Icône (emoji)', 'text'); iconInput.value = String(entry.icon || '');
    var categoryInput = input('Catégorie', 'text'); categoryInput.value = String(entry.category || '');
    var urlInput = input('URL', 'text'); urlInput.value = String(entry.url || '');
    var visibilitySelect = el('select', 'w-full bg-[#0e1322] border border-[#20273a] rounded-lg px-3 py-2 text-xs text-slate-200');
    ['public', 'prive'].forEach(function (value) {
      var opt = el('option', '', value);
      opt.setAttribute('value', value);
      if (entry.visibility === value) opt.setAttribute('selected', 'selected');
      visibilitySelect.appendChild(opt);
    });
    visibilitySelect.value = String(entry.visibility || 'public');
    wrap.appendChild(field('Nom', nameInput));
    wrap.appendChild(field('Description', descInput));
    wrap.appendChild(field('Icône', iconInput));
    wrap.appendChild(field('Catégorie', categoryInput));
    wrap.appendChild(field('URL', urlInput));
    wrap.appendChild(field('Visibilité', visibilitySelect));

    var row = el('div', 'flex items-center gap-2');
    row.appendChild(button('Enregistrer', BTN_PRIMARY, function () {
      var patch = {};
      if (nameInput.value !== String(entry.name || '')) patch.name = nameInput.value;
      if (descInput.value !== String(entry.description || '')) patch.description = descInput.value;
      if (iconInput.value !== String(entry.icon || '')) patch.icon = iconInput.value;
      if (categoryInput.value !== String(entry.category || '')) patch.category = categoryInput.value;
      if (urlInput.value !== String(entry.url || '')) patch.url = urlInput.value;
      if (visibilitySelect.value !== String(entry.visibility || 'public')) patch.visibility = visibilitySelect.value;
      if (Object.keys(patch).length === 0) { state.editingId = ''; renderListArea(); return; }
      patchEntry(entry.catalogId, patch);
    }, state.busyId === entry.catalogId));
    row.appendChild(button('Annuler', BTN_SOFT, function () {
      state.editingId = '';
      renderListArea();
    }));
    wrap.appendChild(row);
    return wrap;
  }

  function historyPanel(entry) {
    var wrap = el('div', 'rounded-lg border border-[#20273a] bg-[#0e1322] p-3 space-y-2');
    wrap.setAttribute('data-history-for', String(entry.catalogId));
    wrap.appendChild(el('div', 'text-[10px] font-bold text-slate-300 uppercase tracking-wide',
      'Historique administratif — ' + String(entry.name || '')));
    if (state.historyLoading) {
      var loading = el('div', 'text-[11px] text-slate-500 italic', 'Chargement de l\'historique…');
      loading.setAttribute('role', 'status');
      wrap.appendChild(loading);
      return wrap;
    }
    if (state.historyError !== '') {
      wrap.appendChild(el('div', 'text-[11px] text-rose-300', state.historyError));
      return wrap;
    }
    if (state.history.length === 0) {
      var empty = el('div', 'text-[11px] text-slate-500 italic',
        'Aucune opération administrative auditée pour cette entrée.');
      empty.setAttribute('data-state', 'empty-history');
      wrap.appendChild(empty);
      return wrap;
    }
    state.history.forEach(function (event) {
      var line = el('div', 'flex items-center justify-between gap-2 py-1 border-b border-[#141a2e] last:border-0');
      wrap.appendChild(line);
      var left = el('div', 'flex items-center gap-2 min-w-0');
      left.appendChild(pill(ACTION_LABELS[event.action] || String(event.action),
        event.action === 'MCP_CATALOG_DELETED' ? PILL_ERR : PILL_INFO));
      var meta = event.metadata && typeof event.metadata === 'object' ? event.metadata : null;
      if (meta && typeof meta.from === 'string' && typeof meta.to === 'string') {
        left.appendChild(el('span', 'text-[10px] text-slate-400', meta.from + ' → ' + meta.to));
      } else if (meta && typeof meta.fields === 'object' && meta.fields !== null) {
        left.appendChild(el('span', 'text-[10px] text-slate-400', Object.keys(meta.fields).join(', ')));
      } else if (meta && typeof meta.ok === 'boolean') {
        left.appendChild(el('span', 'text-[10px] ' + (meta.ok ? 'text-emerald-300' : 'text-rose-300'),
          meta.ok ? 'test réussi' : 'test en échec'));
      }
      line.appendChild(left);
      var right = el('div', 'flex items-center gap-2 shrink-0');
      right.appendChild(el('span', 'text-[9px] text-slate-500', String(event.userId || '')));
      right.appendChild(el('span', 'text-[9px] font-mono text-slate-600', String(event.timestamp || '')));
      line.appendChild(right);
    });
    return wrap;
  }

  function renderListArea() {
    renderToolbar();
    renderCreateWrap();
    if (!refs.list) return;
    clearNode(refs.list);

    if (state.adminDenied) {
      var denied = el('div', 'rounded-xl border border-rose-900/50 bg-rose-950/20 p-5 space-y-2');
      denied.setAttribute('data-state', 'forbidden');
      denied.appendChild(el('div', 'text-xs font-bold text-rose-200', 'Accès administrateur requis'));
      denied.appendChild(el('p', 'text-[11px] text-rose-300/80',
        'Cette surface nécessite la permission MCP_CATALOG_MANAGE (OWNER/ADMIN). ' +
        'Le serveur vérifie cette permission sur CHAQUE endpoint, indépendamment de cette interface.'));
      refs.list.appendChild(denied);
      return;
    }
    if (state.loading && state.entries.length === 0) {
      var loading = el('div', 'text-xs text-slate-500 italic', 'Chargement du catalogue…');
      loading.setAttribute('role', 'status');
      refs.list.appendChild(loading);
      return;
    }
    if (state.loadError !== '' && state.entries.length === 0) {
      var err = el('div', 'rounded-xl border border-rose-900/50 bg-rose-950/20 p-4 text-xs text-rose-300', state.loadError);
      err.setAttribute('data-state', 'error');
      refs.list.appendChild(err);
      refs.list.appendChild(button('Réessayer', BTN_SOFT, function () { loadAll(); }));
      return;
    }
    if (state.entries.length === 0) {
      var empty = el('div', 'rounded-xl border border-[#1a2138] bg-[#0b0e1b] p-5 text-xs text-slate-500 italic',
        'Le catalogue global est vide — créez la première entrée.');
      empty.setAttribute('data-state', 'empty');
      refs.list.appendChild(empty);
      return;
    }
    var visible = visibleEntries();
    if (visible.length === 0) {
      var noMatch = el('div', 'rounded-xl border border-[#1a2138] bg-[#0b0e1b] p-5 text-xs text-slate-500 italic',
        'Aucune entrée ne correspond à vos filtres.');
      noMatch.setAttribute('data-state', 'no-match');
      refs.list.appendChild(noMatch);
      return;
    }
    var wrap = el('div', 'space-y-3');
    visible.forEach(function (one) { wrap.appendChild(entryRow(one)); });
    refs.list.appendChild(wrap);
  }

  function renderAll() {
    renderStatus();
    renderDashboard();
    renderListArea();
  }

  /* ---------------------------------------------------------------------------
   * Visibilité du menu (cosmétique — fail-closed : masqué par défaut)
   * ---------------------------------------------------------------------- */
  /**
   * Visibilité du menu admin : purement COSMÉTIQUE (fail-closed — masqué par
   * défaut, le serveur vérifie MCP_CATALOG_MANAGE sur chaque endpoint). On
   * ne manipule QUE le mot « hidden » pour préserver le style actif/inactif
   * posé par switchSystemView (réécriture complète du className).
   */
  function syncMcpAdminMenu() {
    var item = document.getElementById('menuNav-mcpadmin');
    if (!item) return;
    var cls = String(item.className || '');
    var hasHidden = /(^|\s)hidden(\s|$)/.test(cls);
    var shouldHide = !(state.accessToken !== '' && roleManagesCatalog());
    if (shouldHide && !hasHidden) {
      item.className = cls + ' hidden';
    } else if (!shouldHide && hasHidden) {
      item.className = cls.replace(/(?:^|\s)hidden(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
    }
  }
  window.syncMcpAdminMenu = syncMcpAdminMenu;

  /* ---------------------------------------------------------------------------
   * Montage
   * ---------------------------------------------------------------------- */
  function ensureRoot() {
    var existing = document.getElementById('mcpAdminMount');
    if (existing) return existing;
    var created = el('div', '', '');
    created.id = 'mcpAdminMount';
    if (document.body) document.body.appendChild(created);
    return created;
  }

  function mountUi() {
    refs.root = ensureRoot();
    clearNode(refs.root);

    var shell = el('section', 'space-y-5');
    refs.root.appendChild(shell);

    shell.appendChild(el('h3', 'text-lg font-bold text-white', 'Gestion du catalogue MCP'));
    shell.appendChild(el('p', 'text-xs text-slate-400 mt-1',
      'Cycle de gouvernance : BROUILLON → VALIDATION → PUBLIE → DÉSACTIVÉ. ' +
      'Chaque opération est vérifiée (MCP_CATALOG_MANAGE), auditée et appliquée par le serveur ; ' +
      'les tests de connexion passent par la politique réseau (SSRF) du backend.'));

    refs.statusLine = el('p', 'text-[11px]', '');
    refs.statusLine.setAttribute('role', 'status');
    shell.appendChild(refs.statusLine);

    // Tableau de bord
    refs.dashBoard = el('div', 'space-y-3');
    refs.dashBoard.setAttribute('data-role', 'admin-dashboard');
    shell.appendChild(refs.dashBoard);
    refs.opList = el('div', 'space-y-0.5');
    shell.appendChild(refs.opList);

    // Catalogue
    shell.appendChild(el('h4', 'text-sm font-bold text-white pt-2', 'Catalogue global'));
    refs.toolbar = el('div', 'space-y-1 rounded-xl border border-[#1a2138] bg-[#0b0e1b] p-3');
    // Champ de recherche construit UNE seule fois (le focus survit aux
    // rendus de filtres : seules les pilules sont reconstruites).
    refs.searchInput = input('Rechercher (nom, description, catégorie, URL)…', 'search');
    refs.searchInput.setAttribute('data-role', 'admin-search');
    refs.searchInput.addEventListener('input', function () {
      state.query = refs.searchInput.value;
      renderListArea();
    });
    refs.toolbar.appendChild(refs.searchInput);
    refs.filterRows = el('div', '');
    refs.toolbar.appendChild(refs.filterRows);
    shell.appendChild(refs.toolbar);
    refs.createWrap = el('div', '');
    shell.appendChild(refs.createWrap);
    refs.list = el('div', 'space-y-3');
    refs.list.setAttribute('data-role', 'admin-list');
    shell.appendChild(refs.list);
  }

  function onShow() {
    loadAll();
  }

  /* ---------------------------------------------------------------------------
   * Démarrage
   * ---------------------------------------------------------------------- */
  function boot() {
    mountUi();
    applyToken(readStoredToken());
    syncMcpAdminMenu();
    renderAll();
    loadAll();
  }

  // Surface d'introspection PURE pour les tests vm (aucun contenu sensible).
  window.__mcpAdminInternals = {
    normalizeText: normalizeText,
    matchesFilters: matchesFilters,
    describeApiError: describeApiError,
    transitionTargets: transitionTargets,
    decodeJwtPayload: decodeJwtPayload
  };
  window.__mcpAdminUi = {
    onShow: onShow,
    refresh: loadAll
  };

  // DÉCONNEXION DU SHELL → session + menu admin réinitialisés.
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('vibecode:auth-logout', function () {
      storeToken('');
      applyToken('');
      state.stats = null;
      state.entries = [];
      state.history = [];
      state.historyId = '';
      state.query = '';
      state.statusFilter = '';
      state.categoryFilter = '';
      state.toast = '';
      state.loadError = '';
      state.adminDenied = false;
      state.showCreate = false;
      syncMcpAdminMenu();
      renderAll();
    });
  }

  function storeToken(token) {
    try {
      if (typeof localStorage === 'undefined') return;
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (writeError) { /* sandbox / lecture seule */ }
  }

  if (typeof document !== 'undefined') {
    boot();
  }
})();
