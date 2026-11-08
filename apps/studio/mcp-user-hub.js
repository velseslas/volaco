/**
 * LOT UI-MCP — Studio : page « Connecteurs » (espace UTILISATEUR / MCP Hub).
 *
 * Mandat : bibliothèque de connecteurs MCP moderne et simple, construite
 * UNIQUEMENT sur les contrats backend existants :
 *
 *   - découverte           : GET  /api/v1/mcp/catalog
 *                            (entrées PUBLIE + public ; brouillons invisibles) ;
 *   - activation réelle    : POST /api/v1/mcp/catalog/:id/activation
 *                            (instance scope 'catalog' enabled=1 côté serveur,
 *                            JWT + MCP_REMOTE_INVOKE — jamais un toggle visuel) ;
 *   - désactivation        : DELETE /api/v1/mcp/catalog/:id/activation
 *                            (enabled=0, instance conservée, idempotent) ;
 *   - imports personnels   : GET/POST /api/v1/mcp-remote/connectors
 *                            (scope=mine → uniquement MES lignes, JWT requis),
 *                            PATCH/DELETE /:id, POST /:id/test ;
 *   - secrets              : JAMAIS affichés (secretPresent seulement),
 *     saisi une seule fois au import, retirable via /:id/secret.
 *
 * Ce module n'exécute AUCUN outil MCP : l'exécution reste sur le flux
 * gouverné centralisé (/prepare → confirmation → /call) du hub existant
 * (mcp-hub.js), que ce module ne duplique pas.
 *
 * Sécurité DOM (héritage B4/mcp-hub) :
 *   - construction DOM exclusive via createElement + textContent
 *     (aucun innerHTML, aucun insertAdjacentHTML, aucun eval) ;
 *   - aucun classList : réaffectation complète de className (setVisible) ;
 *   - erreurs API affichées par message/code, jamais de corps secret.
 *
 * Le serveur reste l'AUTORITÉ : les libellés de droits (boutons) sont
 * cosmétiques ; chaque appel est contrôlé côté backend (401/403/404).
 */
(function () {
  'use strict';

  /* ---------------------------------------------------------------------------
   * Contrats (surface réelle du backend — rien d'inventé)
   * ---------------------------------------------------------------------- */
  var CATALOG_BASE = '/api/v1/mcp/catalog';
  var CONNECTORS_BASE = '/api/v1/mcp-remote/connectors';
  var TOKEN_KEY = 'vibecode_auth_token'; // clé existante du Studio (session partagée)

  /* ---------------------------------------------------------------------------
   * Helpers DOM purs (identiques à mcp-hub.js — aucun innerHTML)
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
  /** Élément masqué/togglé par réaffectation COMPLÈTE du className (pas de classList). */
  function setVisible(node, baseClass, visible) {
    node.className = baseClass + (visible ? '' : ' hidden');
  }
  function input(textPlaceholder, inputType) {
    var node = el('input', 'w-full bg-[#0e1322] border border-[#20273a] rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:border-violet-500/60 focus:outline-none');
    node.setAttribute('type', inputType || 'text');
    node.setAttribute('placeholder', String(textPlaceholder || ''));
    return node;
  }

  var PILL_OK = 'text-[9px] px-2 py-0.5 rounded-full font-bold bg-emerald-950/60 text-emerald-300 border border-emerald-900/40';
  var PILL_INFO = 'text-[9px] px-2 py-0.5 rounded-full font-bold bg-white/[0.06] text-slate-300 border border-white/10';
  var PILL_WARN = 'text-[9px] px-2 py-0.5 rounded-full font-bold bg-amber-950/60 text-amber-300 border border-amber-900/40';
  var PILL_ERR = 'text-[9px] px-2 py-0.5 rounded-full font-bold bg-rose-950/60 text-rose-300 border border-rose-900/40';
  var PILL_MUTED = 'text-[9px] px-2 py-0.5 rounded-full font-bold bg-slate-800 text-slate-400';

  var BTN_SOFT = 'px-3 py-1.5 rounded-lg bg-[#141a24] hover:bg-[#1a2130] border border-[#20273a] text-slate-200 text-[11px] font-semibold transition';
  var BTN_PRIMARY = 'px-3.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-bold transition';
  var BTN_DANGER = 'px-3 py-1.5 rounded-lg bg-rose-950/50 hover:bg-rose-900/50 border border-rose-900/40 text-rose-200 text-[11px] font-semibold transition';
  var CARD = 'rounded-xl border border-[#1a2138] bg-[#0b0e1b] p-4 space-y-2';

  function button(labelText, cls, listener, disabled) {
    var b = el('button', cls || BTN_SOFT, String(labelText));
    if (disabled) b.disabled = true;
    if (listener) b.addEventListener('click', listener);
    return b;
  }

  /* ---------------------------------------------------------------------------
   * Session (JWT réel de la session Studio — jamais d'en-têtes de repli)
   * ---------------------------------------------------------------------- */
  var state = {
    accessToken: '',
    role: 'UNKNOWN',
    userId: '',
    // Données
    entries: [],
    categories: [],
    personal: [],
    // UI
    query: '',
    filter: 'tous',        // 'tous' | 'actives'
    category: '',          // '' = toutes
    loadingCatalog: false,
    loadingPersonal: false,
    catalogError: '',
    personalError: '',
    formError: '',
    busyId: '',            // entrée en cours d'activation/désactivation
    busyConnectorId: '',   // connecteur perso en cours d'opération
    editingId: '',
    toast: ''              // message positif transitoire (aria-live)
  };

  var refs = {
    root: null, statusLine: null, searchInput: null, filterPills: null,
    categoryRow: null, grid: null, personalList: null, personalForm: null,
    personalInfo: null
  };

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
  function applyToken(token) {
    state.accessToken = token || '';
    state.role = 'UNKNOWN';
    state.userId = '';
    var payload = decodeJwtPayload(token);
    if (payload) {
      state.userId = typeof payload.sub === 'string' ? payload.sub : '';
      if (payload.role === 'OWNER' || payload.role === 'ADMIN' || payload.role === 'ENGINEER' || payload.role === 'VIEWER') {
        state.role = payload.role;
      }
    }
  }
  function hasSession() { return state.accessToken !== ''; }

  /* ---------------------------------------------------------------------------
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
      return res.text().then(function (text) {
        var body = null;
        try { body = text ? JSON.parse(text) : null; } catch (parseError) { body = null; }
        return { ok: res.ok, status: res.status, body: body, text: text };
      });
    });
  }

  /** Traduit une erreur API en libellé humain (code + message serveur, aucun secret). */
  function describeApiError(status, body) {
    var error = body && typeof body === 'object' && body.error && typeof body.error === 'object'
      ? body.error : null;
    var code = error && typeof error.code === 'string' ? error.code : '';
    var message = error && typeof error.message === 'string' ? error.message : '';
    if (status === 401) return 'Session requise ou expirée — reconnectez-vous.';
    if (status === 403) return 'Droits insuffisants : le serveur a refusé cette opération.' + (code ? ' (' + code + ')' : '');
    if (status === 404) return 'Ressource introuvable (elle n\'existe peut-être plus).';
    if (status === 429) return 'Trop de tentatives — réessayez plus tard.';
    if (status === 409) return message || ('Conflit (' + (code || '409') + ')');
    if (status === 400) return message || ('Requête invalide (' + (code || '400') + ')');
    if (status >= 500) return 'Erreur du serveur — réessayez plus tard.';
    return message || (code !== '' ? code : 'Erreur réseau.');
  }

  /* ---------------------------------------------------------------------------
   * Filtres purs (testables sans DOM)
   * ---------------------------------------------------------------------- */
  /** Recherche insensible à la casse et aux accents (miroir léger du serveur). */
  function normalizeText(value) {
    var raw = typeof value === 'string' ? value.toLowerCase() : '';
    try {
      return raw.normalize('NFD').replace(/[̀-ͯ]/g, '');
    } catch (normalizeError) { return raw; }
  }
  /** Une entrée passe le triple filtre (recherche + Tous/Activés + catégorie). */
  function matchesFilters(entry, query, filter, category) {
    if (filter === 'actives' && !entry.activated) return false;
    if (category !== '' && entry.category !== category) return false;
    var needle = normalizeText(query).trim();
    if (needle === '') return true;
    var haystack = normalizeText(String(entry.name || '') + ' ' + String(entry.description || '') + ' ' + String(entry.category || ''));
    return haystack.indexOf(needle) !== -1;
  }
  function visibleEntries() {
    return state.entries.filter(function (one) {
      return matchesFilters(one, state.query, state.filter, state.category);
    });
  }
  /** Nombre d'activations parmi les entrées chargées (compteur du filtre). */
  function activatedCount() {
    return state.entries.filter(function (one) { return !!one.activated; }).length;
  }

  /* ---------------------------------------------------------------------------
   * Chargements
   * ---------------------------------------------------------------------- */
  function loadCatalog() {
    state.loadingCatalog = true;
    state.catalogError = '';
    renderCatalogArea();
    apiFetch(CATALOG_BASE, {}).then(function (out) {
      state.loadingCatalog = false;
      if (!out.ok) {
        state.catalogError = describeApiError(out.status, out.body);
        state.entries = [];
        state.categories = [];
      } else {
        var body = out.body || {};
        state.entries = Array.isArray(body.entries) ? body.entries : [];
        state.categories = Array.isArray(body.categories) ? body.categories : [];
        // La catégorie active disparaît-elle ? Retour au filtre « toutes ».
        if (state.category !== '' && !state.categories.some(function (one) { return one.category === state.category; })) {
          state.category = '';
        }
      }
      renderCatalogArea();
    }).catch(function () {
      state.loadingCatalog = false;
      state.catalogError = 'Serveur injoignable.';
      state.entries = [];
      renderCatalogArea();
    });
  }

  function loadPersonal() {
    if (!hasSession()) {
      state.personal = [];
      state.personalError = '';
      renderPersonalArea();
      return;
    }
    state.loadingPersonal = true;
    state.personalError = '';
    renderPersonalArea();
    apiFetch(CONNECTORS_BASE + '?scope=mine', {}).then(function (out) {
      state.loadingPersonal = false;
      if (!out.ok) {
        state.personalError = describeApiError(out.status, out.body);
        state.personal = [];
      } else {
        var body = out.body || {};
        var all = Array.isArray(body.connectors) ? body.connectors : [];
        // Uniquement MES imports personnels (les instances de catalogue sont
        // affichées via la bibliothèque, pas dans cette liste).
        state.personal = all.filter(function (one) { return one.scope === 'personal'; });
      }
      renderPersonalArea();
    }).catch(function () {
      state.loadingPersonal = false;
      state.personalError = 'Serveur injoignable.';
      state.personal = [];
      renderPersonalArea();
    });
  }

  /* ---------------------------------------------------------------------------
   * Actions (chaque bouton appelle le BACKEND — aucun état local seul)
   * ---------------------------------------------------------------------- */
  function toggleActivation(entry) {
    if (state.busyId !== '') return;
    if (!hasSession()) {
      state.toast = '';
      state.catalogError = 'Session requise : connectez-vous pour activer un connecteur.';
      renderCatalogArea();
      return;
    }
    state.busyId = entry.catalogId;
    state.catalogError = '';
    renderCatalogArea();
    var path = CATALOG_BASE + '/' + encodeURIComponent(entry.catalogId) + '/activation';
    var method = entry.activated ? 'DELETE' : 'POST';
    apiFetch(path, { method: method, body: {} }).then(function (out) {
      state.busyId = '';
      if (!out.ok) {
        state.catalogError = describeApiError(out.status, out.body);
        renderCatalogArea();
        return;
      }
      // Réconciliation avec l'état RÉEL renvoyé par le serveur.
      var connector = out.body && out.body.connector ? out.body.connector : null;
      entry.activated = !!(out.body && out.body.activated);
      entry.instanceConnectorId = connector ? connector.connectorId : null;
      state.toast = entry.activated
        ? '« ' + entry.name + ' » est activé sur votre compte.'
        : '« ' + entry.name + ' » est désactivé sur votre compte.';
      renderCatalogArea();
      loadPersonal();
    }).catch(function () {
      state.busyId = '';
      state.catalogError = 'Serveur injoignable.';
      renderCatalogArea();
    });
  }

  function importPersonal(payload) {
    state.formError = '';
    apiFetch(CONNECTORS_BASE, { method: 'POST', body: payload }).then(function (out) {
      if (!out.ok) {
        state.formError = describeApiError(out.status, out.body);
        renderPersonalArea();
        return;
      }
      state.toast = 'Import personnel ajouté (privé, absent du catalogue global).';
      if (refs.personalForm) clearNode(refs.personalForm);
      renderPersonalArea();
      loadPersonal();
    }).catch(function () {
      state.formError = 'Serveur injoignable.';
      renderPersonalArea();
    });
  }

  function patchPersonal(connectorId, patch, doneMessage) {
    state.busyConnectorId = connectorId;
    state.personalError = '';
    renderPersonalArea();
    apiFetch(CONNECTORS_BASE + '/' + encodeURIComponent(connectorId), { method: 'PATCH', body: patch }).then(function (out) {
      state.busyConnectorId = '';
      if (!out.ok) {
        state.personalError = describeApiError(out.status, out.body);
        renderPersonalArea();
        return;
      }
      state.toast = doneMessage || 'Import mis à jour.';
      state.editingId = '';
      loadPersonal();
    }).catch(function () {
      state.busyConnectorId = '';
      state.personalError = 'Serveur injoignable.';
      renderPersonalArea();
    });
  }

  function deletePersonal(connectorId, name) {
    var confirmed = true;
    if (typeof confirm === 'function') {
      confirmed = confirm('Supprimer définitivement l\'import « ' + name + ' » ?');
    }
    if (!confirmed) return;
    state.busyConnectorId = connectorId;
    renderPersonalArea();
    apiFetch(CONNECTORS_BASE + '/' + encodeURIComponent(connectorId), { method: 'DELETE' }).then(function (out) {
      state.busyConnectorId = '';
      if (!out.ok) {
        state.personalError = describeApiError(out.status, out.body);
        renderPersonalArea();
        return;
      }
      state.toast = 'Import personnel supprimé.';
      loadPersonal();
    }).catch(function () {
      state.busyConnectorId = '';
      state.personalError = 'Serveur injoignable.';
      renderPersonalArea();
    });
  }

  function testPersonal(connectorId) {
    state.busyConnectorId = connectorId;
    state.personalError = '';
    renderPersonalArea();
    apiFetch(CONNECTORS_BASE + '/' + encodeURIComponent(connectorId) + '/test', { method: 'POST', body: {} }).then(function (out) {
      state.busyConnectorId = '';
      var body = out.body || {};
      if (out.ok && body.ok === true) {
        state.toast = 'Connexion réussie' + (body.serverName ? ' (' + body.serverName + (body.serverVersion ? ' ' + body.serverVersion : '') + ')' : '') + '.';
      } else if (out.ok && body.ok === false) {
        var err = body.error && typeof body.error === 'object' ? body.error : {};
        state.personalError = 'Test en échec : ' + (typeof err.message === 'string' && err.message ? err.message : 'cible injoignable')
          + (err.code ? ' (' + err.code + ')' : '');
      } else {
        state.personalError = describeApiError(out.status, body);
      }
      renderPersonalArea();
    }).catch(function () {
      state.busyConnectorId = '';
      state.personalError = 'Serveur injoignable.';
      renderPersonalArea();
    });
  }

  /* ---------------------------------------------------------------------------
   * Rendu — bibliothèque
   * ---------------------------------------------------------------------- */
  function statusLineRender() {
    if (!refs.statusLine) return;
    clearNode(refs.statusLine);
    var text = state.toast !== '' ? state.toast
      : (state.catalogError !== '' ? state.catalogError : '');
    if (text === '') return;
    var isError = state.catalogError !== '' && state.toast === '';
    refs.statusLine.className = 'text-[11px] ' + (isError ? 'text-rose-300' : 'text-emerald-300');
    refs.statusLine.textContent = text;
  }

  function renderFilterPills() {
    if (!refs.filterPills) return;
    clearNode(refs.filterPills);
    var options = [
      { key: 'tous', label: 'Tous (' + state.entries.length + ')' },
      { key: 'actives', label: 'Activés (' + activatedCount() + ')' }
    ];
    options.forEach(function (option) {
      var active = state.filter === option.key;
      var cls = active
        ? 'px-3 py-1.5 rounded-full text-[11px] font-bold bg-violet-600 text-white transition'
        : 'px-3 py-1.5 rounded-full text-[11px] font-semibold bg-[#141a24] border border-[#20273a] text-slate-300 hover:text-white transition';
      var b = button(option.label, cls, function () {
        state.filter = option.key;
        renderCatalogArea();
      });
      b.setAttribute('data-filter', option.key);
      refs.filterPills.appendChild(b);
    });
  }

  function renderCategoryRow() {
    if (!refs.categoryRow) return;
    clearNode(refs.categoryRow);
    var allCls = state.category === ''
      ? 'px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-950/60 text-emerald-300 border border-emerald-900/40'
      : 'px-2.5 py-1 rounded-full text-[10px] font-semibold bg-[#141a24] border border-[#20273a] text-slate-400 hover:text-white transition';
    var allBtn = button('Toutes (' + state.entries.length + ')', allCls, function () {
      state.category = '';
      renderCatalogArea();
    });
    allBtn.setAttribute('data-category', '');
    refs.categoryRow.appendChild(allBtn);
    state.categories.forEach(function (one) {
      var active = state.category === one.category;
      var cls = active
        ? 'px-2.5 py-1 rounded-full text-[10px] font-bold bg-violet-600 text-white transition'
        : 'px-2.5 py-1 rounded-full text-[10px] font-semibold bg-[#141a24] border border-[#20273a] text-slate-400 hover:text-white transition';
      var b = button(String(one.category) + ' (' + one.count + ')', cls, function () {
        state.category = one.category;
        renderCatalogArea();
      });
      b.setAttribute('data-category', String(one.category));
      refs.categoryRow.appendChild(b);
    });
  }

  function entryCard(entry) {
    var card = el('div', CARD + (entry.activated ? ' border-emerald-900/50' : ''));
    card.setAttribute('data-catalog-id', String(entry.catalogId));

    var head = el('div', 'flex items-start justify-between gap-2');
    var idBlock = el('div', 'flex items-center gap-2.5 min-w-0');
    var iconBox = el('div', 'w-9 h-9 shrink-0 rounded-lg bg-[#12162a] border border-[#1e2748] flex items-center justify-center text-lg',
      entry.icon ? String(entry.icon) : '🔌');
    idBlock.appendChild(iconBox);
    var texts = el('div', 'min-w-0');
    texts.appendChild(el('div', 'text-xs font-bold text-white truncate', String(entry.name || '')));
    texts.appendChild(el('div', 'text-[10px] text-slate-500', String(entry.category || '')));
    idBlock.appendChild(texts);
    head.appendChild(idBlock);
    head.appendChild(entry.activated
      ? statusPillNode('Activé', PILL_OK)
      : statusPillNode('Désactivé', PILL_MUTED));
    card.appendChild(head);

    card.appendChild(el('p', 'text-[11px] leading-relaxed text-slate-400',
      entry.description ? String(entry.description) : 'Aucune description.'));

    var meta = el('div', 'flex items-center gap-1.5 flex-wrap');
    meta.appendChild(statusPillNode(String(entry.transport || 'url'), PILL_INFO));
    if (entry.lastTestStatus === 'OK') meta.appendChild(statusPillNode('Santé : OK', PILL_INFO));
    else if (entry.lastTestStatus === 'FAILED') meta.appendChild(statusPillNode('Santé : échec', PILL_WARN));
    card.appendChild(meta);

    var actions = el('div', 'flex items-center gap-2 flex-wrap pt-1');
    var busy = state.busyId === entry.catalogId;
    if (entry.activated) {
      actions.appendChild(button(busy ? 'Désactivation…' : 'Désactiver', BTN_SOFT, function () { toggleActivation(entry); }, busy));
    } else {
      actions.appendChild(button(busy ? 'Activation…' : 'Activer', BTN_PRIMARY, function () { toggleActivation(entry); }, busy || !hasSession()));
    }
    actions.appendChild(el('span', 'text-[9px] text-slate-500',
      entry.activated
        ? 'Instance active sur votre compte'
        : (hasSession()
          ? 'Activation réelle vérifiée par le serveur'
          : 'Connectez-vous pour activer')));
    card.appendChild(actions);
    return card;
  }

  function statusPillNode(text, cls) {
    return el('span', cls || PILL_INFO, String(text));
  }

  function renderCatalogArea() {
    if (!refs.grid) return;
    statusLineRender();
    renderFilterPills();
    renderCategoryRow();
    if (refs.searchInput && refs.searchInput.value !== state.query) {
      refs.searchInput.value = state.query;
    }
    clearNode(refs.grid);

    if (state.loadingCatalog) {
      var loading = el('div', 'text-xs text-slate-500 italic', 'Chargement du catalogue…');
      loading.setAttribute('role', 'status');
      refs.grid.appendChild(loading);
      return;
    }
    if (state.catalogError !== '' && state.entries.length === 0) {
      var errBox = el('div', 'rounded-xl border border-rose-900/50 bg-rose-950/20 p-4 text-xs text-rose-300',
        state.catalogError);
      errBox.setAttribute('data-state', 'error');
      refs.grid.appendChild(errBox);
      var retry = button('Réessayer', BTN_SOFT, function () { loadCatalog(); });
      refs.grid.appendChild(retry);
      return;
    }
    var visible = visibleEntries();
    if (state.entries.length === 0) {
      var empty = el('div', 'rounded-xl border border-[#1a2138] bg-[#0b0e1b] p-5 text-xs text-slate-500 italic',
        'Aucun connecteur publié pour le moment.');
      empty.setAttribute('data-state', 'empty');
      refs.grid.appendChild(empty);
      return;
    }
    if (visible.length === 0) {
      var noMatch = el('div', 'rounded-xl border border-[#1a2138] bg-[#0b0e1b] p-5 text-xs text-slate-500 italic',
        'Aucun connecteur ne correspond à vos filtres.');
      noMatch.setAttribute('data-state', 'no-match');
      refs.grid.appendChild(noMatch);
      return;
    }
    var gridWrap = el('div', 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3');
    visible.forEach(function (one) { gridWrap.appendChild(entryCard(one)); });
    refs.grid.appendChild(gridWrap);
  }

  /* ---------------------------------------------------------------------------
   * Rendu — imports personnels
   * ---------------------------------------------------------------------- */
  function renderPersonalArea() {
    if (!refs.personalList) return;
    // La ligne d'état globale (aria-live) partage les toasts des opérations
    // personnelles (import, test, modification, suppression).
    statusLineRender();
    // Ligne d'information / erreurs de la section (aria-live).
    var infoBox = refs.personalInfo;
    if (infoBox) {
      clearNode(infoBox);
      var infoText = state.personalError !== '' ? state.personalError
        : (state.formError !== '' ? state.formError : '');
      if (infoText !== '') {
        infoBox.className = 'text-[11px] text-rose-300';
        infoBox.textContent = infoText;
      }
    }
    clearNode(refs.personalList);

    if (!hasSession()) {
      var needSession = el('div', 'text-xs text-slate-500 italic',
        'Connectez-vous pour importer et gérer vos serveurs personnels.');
      needSession.setAttribute('data-state', 'no-session');
      refs.personalList.appendChild(needSession);
      return;
    }
    if (state.loadingPersonal) {
      var loading = el('div', 'text-xs text-slate-500 italic', 'Chargement de vos imports…');
      loading.setAttribute('role', 'status');
      refs.personalList.appendChild(loading);
      return;
    }
    if (state.personal.length === 0) {
      var empty = el('div', 'text-xs text-slate-500 italic',
        'Aucun import personnel. Vos serveurs restent privés : jamais visibles des autres, jamais dans le catalogue global.');
      empty.setAttribute('data-state', 'empty');
      refs.personalList.appendChild(empty);
      return;
    }
    state.personal.forEach(function (one) {
      refs.personalList.appendChild(personalRow(one));
    });
  }

  function personalRow(connector) {
    var row = el('div', 'rounded-xl border border-[#1a2138] bg-[#0b0e1b] p-3 space-y-2');
    row.setAttribute('data-connector-id', String(connector.connectorId));
    var busy = state.busyConnectorId === connector.connectorId;

    var head = el('div', 'flex items-center justify-between gap-2 flex-wrap');
    head.appendChild(el('span', 'text-xs font-bold text-white', String(connector.name || '')));
    var pills = el('div', 'flex items-center gap-1.5 flex-wrap');
    pills.appendChild(connector.enabled ? statusPillNode('Activé', PILL_OK) : statusPillNode('Désactivé', PILL_MUTED));
    pills.appendChild(connector.secretPresent
      ? statusPillNode('Secret configuré', PILL_INFO)
      : statusPillNode('Sans secret', PILL_MUTED));
    head.appendChild(pills);
    row.appendChild(head);
    row.appendChild(el('p', 'text-[10px] text-slate-500 break-all', String(connector.url || '')));

    var actions = el('div', 'flex items-center gap-2 flex-wrap');
    actions.appendChild(button(busy ? '…' : (connector.enabled ? 'Désactiver' : 'Activer'), BTN_SOFT, function () {
      patchPersonal(connector.connectorId, { enabled: !connector.enabled },
        connector.enabled ? 'Import désactivé.' : 'Import activé.');
    }, busy));
    actions.appendChild(button(busy ? '…' : 'Tester', BTN_SOFT, function () {
      testPersonal(connector.connectorId);
    }, busy));
    actions.appendChild(button('Modifier', BTN_SOFT, function () {
      state.editingId = state.editingId === connector.connectorId ? '' : connector.connectorId;
      renderPersonalArea();
    }, busy));
    actions.appendChild(button('Supprimer', BTN_DANGER, function () {
      deletePersonal(connector.connectorId, String(connector.name || ''));
    }, busy));
    row.appendChild(actions);

    if (state.editingId === connector.connectorId) {
      row.appendChild(editForm(connector));
    }
    return row;
  }

  function editForm(connector) {
    var wrap = el('div', 'rounded-lg border border-[#20273a] bg-[#0e1322] p-3 space-y-2');
    var nameInput = input('Nom', 'text');
    nameInput.value = String(connector.name || '');
    var urlInput = input('https://votre-serveur/mcp', 'text');
    urlInput.value = String(connector.url || '');
    wrap.appendChild(field('Nom', nameInput));
    wrap.appendChild(field('URL du serveur', urlInput));
    var row = el('div', 'flex items-center gap-2');
    row.appendChild(button('Enregistrer', BTN_PRIMARY, function () {
      var patch = {};
      if (nameInput.value !== String(connector.name || '')) patch.name = nameInput.value;
      if (urlInput.value !== String(connector.url || '')) patch.url = urlInput.value;
      if (Object.keys(patch).length === 0) {
        state.editingId = '';
        renderPersonalArea();
        return;
      }
      patchPersonal(connector.connectorId, patch, 'Import mis à jour.');
    }));
    row.appendChild(button('Annuler', BTN_SOFT, function () {
      state.editingId = '';
      renderPersonalArea();
    }));
    wrap.appendChild(row);
    return wrap;
  }

  function field(labelText, control) {
    var wrap = el('label', 'block space-y-1');
    wrap.appendChild(el('span', 'block text-[10px] font-semibold text-slate-400', String(labelText)));
    wrap.appendChild(control);
    return wrap;
  }

  function renderPersonalForm() {
    if (!refs.personalForm) return;
    clearNode(refs.personalForm);
    if (!hasSession()) return;

    var nameInput = input('Nom (ex. Mon serveur interne)', 'text');
    var urlInput = input('https://exemple.org/mcp', 'text');
    var secretInput = input('Secret (optionnel — jamais affiché après)', 'password');
    refs.personalForm.appendChild(field('Nom', nameInput));
    refs.personalForm.appendChild(field('URL du serveur (http/https)', urlInput));
    refs.personalForm.appendChild(field('Secret d\'accès (facultatif)', secretInput));

    var hint = el('p', 'text-[9px] leading-relaxed text-slate-500',
      'Cet import reste PRIVÉ : lié à votre compte, invisible des autres utilisateurs, absent du catalogue global. ' +
      'Le secret est chiffré côté serveur et n\'est jamais renvoyé en lecture.');
    refs.personalForm.appendChild(hint);

    var submit = button('Importer ce serveur', BTN_PRIMARY, function () {
      var payload = {
        name: String(nameInput.value || '').trim(),
        url: String(urlInput.value || '').trim(),
        scope: 'personal'
      };
      var secret = String(secretInput.value || '');
      if (secret !== '') payload.secret = secret;
      if (payload.name === '' || payload.url === '') {
        state.formError = 'Nom et URL requis.';
        renderPersonalArea();
        return;
      }
      importPersonal(payload);
    });
    refs.personalForm.appendChild(submit);
  }

  /* ---------------------------------------------------------------------------
   * Montage
   * ---------------------------------------------------------------------- */
  function ensureRoot() {
    var existing = document.getElementById('mcpUserHubMount');
    if (existing) return existing;
    var created = el('div', '', '');
    created.id = 'mcpUserHubMount';
    if (document.body) document.body.appendChild(created);
    return created;
  }

  function mountUi() {
    refs.root = ensureRoot();
    clearNode(refs.root);

    var shell = el('section', 'space-y-5');
    refs.root.appendChild(shell);

    // En-tête
    shell.appendChild(el('h3', 'text-lg font-bold text-white', 'Connecteurs MCP'));
    shell.appendChild(el('p', 'text-xs text-slate-400 mt-1',
      'Bibliothèque de services compatibles MCP. Choisissez, activez, et laissez le serveur vérifier chaque droit : ' +
      'aucune exécution n\'a lieu sans confirmation et contrôle centralisé.'));

    // Ligne d'état globale (aria-live)
    refs.statusLine = el('p', 'text-[11px]', '');
    refs.statusLine.setAttribute('role', 'status');
    shell.appendChild(refs.statusLine);

    // Barre d'outils : recherche + filtres
    var toolbar = el('div', 'space-y-3 rounded-xl border border-[#1a2138] bg-[#0b0e1b] p-3');
    refs.searchInput = input('Rechercher un connecteur (nom, description, catégorie)…', 'search');
    refs.searchInput.setAttribute('data-role', 'search');
    refs.searchInput.addEventListener('input', function () {
      state.query = refs.searchInput.value;
      renderCatalogArea();
    });
    toolbar.appendChild(refs.searchInput);
    refs.filterPills = el('div', 'flex items-center gap-2 flex-wrap');
    toolbar.appendChild(refs.filterPills);
    refs.categoryRow = el('div', 'flex items-center gap-1.5 flex-wrap');
    toolbar.appendChild(refs.categoryRow);
    shell.appendChild(toolbar);

    // Grille de cartes
    refs.grid = el('div', '');
    refs.grid.setAttribute('data-role', 'catalog-grid');
    shell.appendChild(refs.grid);

    // ---- Section imports personnels ----
    var personal = el('div', 'space-y-3');
    personal.appendChild(el('h4', 'text-sm font-bold text-white', 'Mes serveurs personnels'));
    var personalInfo = el('p', 'text-[10px] text-slate-500', '');
    personalInfo.setAttribute('data-personal-info', '');
    personalInfo.setAttribute('role', 'status');
    personal.appendChild(personalInfo);
    refs.personalInfo = personalInfo;
    refs.personalForm = el('div', 'rounded-xl border border-[#1a2138] bg-[#0b0e1b] p-4 space-y-3');
    personal.appendChild(refs.personalForm);
    refs.personalList = el('div', 'space-y-3');
    personal.appendChild(refs.personalList);
    shell.appendChild(personal);
  }

  function renderAll() {
    renderPersonalForm();
    renderCatalogArea();
    renderPersonalArea();
  }

  function refresh() {
    loadCatalog();
    loadPersonal();
  }

  /** Appelé par switchSystemView('mcphub') : (re)charge à chaque ouverture. */
  function onShow() {
    refresh();
  }

  /* ---------------------------------------------------------------------------
   * Démarrage
   * ---------------------------------------------------------------------- */
  function boot() {
    mountUi();
    var stored = readStoredToken();
    applyToken(stored);
    renderAll();
    loadCatalog();
    loadPersonal();
  }

  // Surface d'introspection PURE pour les tests vm (aucun contenu sensible).
  window.__mcpUserHubInternals = {
    normalizeText: normalizeText,
    matchesFilters: matchesFilters,
    describeApiError: describeApiError,
    decodeJwtPayload: decodeJwtPayload
  };
  // Points d'accès du shell (navigation).
  window.__mcpUserHub = {
    onShow: onShow,
    refresh: refresh
  };

  // DÉCONNEXION DU SHELL → la session mémoire du hub part aussi.
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('vibecode:auth-logout', function () {
      if (state.accessToken || state.role !== 'UNKNOWN') {
        storeToken('');
        applyToken('');
        state.entries = [];
        state.personal = [];
        state.query = '';
        state.filter = 'tous';
        state.category = '';
        state.toast = '';
        state.catalogError = '';
        state.personalError = '';
        renderAll();
        loadCatalog();
      }
    });
  }

  if (typeof document !== 'undefined') {
    boot();
  }
})();
