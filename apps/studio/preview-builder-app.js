    import { applyBuildEvent, createPreviewBuildState, BUILD_STAGES, PRESENTATION_VARIANTS, RESIZE_BOUNDS } from '/preview-builder/engine.js';
    import { renderPreview, buildTimeline, shouldRefreshNode, previewNodeId, resolvePreviewTarget, buildInspector, resolveDropTarget } from '/preview-builder/renderer.js';
    import { updateComponentLabel, updateComponentVariant, moveComponent, computeDropTarget, applyDragIntent, resizeComponent, updateTextContent, updateImageSource, updateLinkHref, inventoryEditableElements, restoreComponentHtml } from '/preview-builder/editing.js';
    import { runAiEditLoop, runAiComponentEditLoop, runAiPageEditLoop } from '/preview-builder/ai-edit.js';
    import { extractSections } from '/preview-builder/section-parse.js';
    import { layoutTree } from '/preview-builder/layout.js';
    import { renderComponentVisual } from '/preview-builder/visuals.js';
    import { demoBuildScript, scriptToEvents } from '/preview-builder/mocks.js';
    import { MockBuildEventSource, SSEBuildEventSource, normalizeGenerationEvent } from '/preview-builder/adapter.js';
    import { demoSseChunks } from '/preview-builder/mocks.js';
    import { resolvePreviewBuilderV2 } from '/preview-builder/flags.js';
    const btnSse = document.getElementById('btnSse');
    const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'studio-local', 'x-user-role': 'ENGINEER' };

    const el = (id) => document.getElementById(id);
    // É30 — mode INTÉGRÉ : la page tourne dans l iframe du Studio
    // (window.parent !== window) → classe html.embedded (canvas plein).
    if (window.parent && window.parent !== window) {
      document.documentElement.classList.add('embedded');
    }
    let state = createPreviewBuildState();
    let lastFocusId = null;
    let timer = null;

    /* ===== VIBE_ELEMENT_REVEAL v1 : construction élément par élément =====
     * Quand un bloc passe de « building » à « completed », ses éléments (titres,
     * textes, boutons, images, liens…) apparaissent un par un, au lieu du bloc
     * entier d'un coup. Observateur autonome : il ne touche ni au state, ni au
     * moteur, ni au rendu, et restaure les styles d'origine à la fin.
     * Désactivation : localStorage.setItem('vibe_reveal', '0') puis recharger. */
    (function installElementReveal() {
      try { if (localStorage.getItem('vibe_reveal') === '0') return; } catch (e) { /* stockage indisponible */ }
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const TARGETS = 'h1,h2,h3,h4,h5,h6,p,a,button,img,picture,svg,li,input,textarea,select,blockquote,figure,video,table,hr,label';
      const MAX = 40, SCAN = 300, TOTAL_MS = 1500, STEP_MS = 80, DUR_MS = 460;

      /** Éléments visibles « de premier niveau » (on ignore ceux contenus dans un autre élément retenu). */
      function pickTargets(root) {
        const all = Array.from(root.querySelectorAll(TARGETS)).slice(0, SCAN);
        return all.filter(function (e) { return !all.some(function (o) { return o !== e && o.contains(e); }); });
      }

      function reveal(root) {
        const els = pickTargets(root).slice(0, MAX);
        if (!els.length) return;
        const step = Math.min(STEP_MS, Math.floor(TOTAL_MS / els.length));
        const saved = els.map(function (e) {
          return { e: e, had: e.hasAttribute('style'), style: e.getAttribute('style'), op: e.style.opacity, tf: e.style.transform };
        });
        els.forEach(function (e) {
          e.style.transition = 'none';
          e.style.opacity = '0';
          e.style.transform = 'translateY(10px)';
        });
        void root.offsetHeight; // fige l'état de départ avant d'animer
        requestAnimationFrame(function () {
          saved.forEach(function (s, i) {
            s.e.style.transition = 'opacity ' + DUR_MS + 'ms ease, transform ' + DUR_MS + 'ms cubic-bezier(.22,.9,.34,1)';
            s.e.style.transitionDelay = (i * step) + 'ms';
            s.e.style.opacity = s.op || '';
            s.e.style.transform = s.tf || '';
          });
          setTimeout(function () {
            saved.forEach(function (s) {
              if (s.had) s.e.setAttribute('style', s.style); else s.e.removeAttribute('style');
            });
          }, els.length * step + DUR_MS + 120);
        });
      }

      function start() {
        const canvas = document.getElementById('canvas');
        if (!canvas) return;
        new MutationObserver(function (records) {
          const finished = new Set();
          records.forEach(function (r) {
            if (r.type === 'attributes' && r.attributeName === 'data-pv-status' && r.oldValue === 'building' &&
                r.target.getAttribute('data-pv-status') === 'completed') finished.add(r.target);
          });
          finished.forEach(function (node) {
            const real = node.querySelector('.pvz-real');
            if (real) reveal(real);
          });
        }).observe(canvas, { subtree: true, attributes: true, attributeFilter: ['data-pv-status'], attributeOldValue: true });
      }
      // Un script de type module s'exécute une fois la page analysée : le canvas existe déjà.
      if (document.getElementById('canvas')) start(); else setTimeout(start, 0);
    })();


    /* ---------- LOT 03 — render DOM INCRÉMENTAL ---------- */
    /* Le canvas est synchronisé par data-pv-id : un nœud n'est recréé QUE
       lorsque son STATUT (ou son focus) change — c'est ce changement qui
       déclenche les animations CSS de construction. Les animations sont une
       conséquence du state, jamais sa source (aucun timer ne décide d'un état). */

    /* ===== ÉTAPE 07 — SYNC PAR COMPOSITION (layoutTree(state) → DOM) =====
       Les conteneurs racines (pv-root-col / pv-root-row) et les wrappers de
       composition (pv-comp-col/row/grid/stack) sont upsertés par identité ;
       le DOM incrémental data-pv-id reste la règle pour les nœuds. */
    function syncLayout(focusId) {
      const canvas = el('canvas');
      const { groups } = layoutTree(state);

      // Retire les nœuds et conteneurs disparus
      [...canvas.querySelectorAll('[data-pv-id]')].forEach((nodeEl) => {
        const stillVisible = groups.some((g) => g.nodes.some((ln) => ln.component.id === nodeEl.dataset.pvId));
        if (!stillVisible) nodeEl.remove();
      });
      [...canvas.querySelectorAll(':scope > [data-root-group]')].forEach((wrap) => {
        const i = Number(wrap.dataset.rootGroup);
        const g = groups[i];
        if (i >= groups.length || !g || g.kind !== wrap.dataset.rootKind) {
          // É18 — les nœuds du conteneur condamné restent dans le canvas :
          // ils seront ADOPTÉS par leur nouveau conteneur ci-dessous (aucun
          // nœud perdu, aucun doublon recréé).
          [...wrap.querySelectorAll('[data-pv-id]')].forEach((n) => canvas.appendChild(n));
          wrap.remove();
        }
      });

      // Placeholder quand aucune construction visible
      const totalVisible = groups.reduce((acc, g) => acc + g.nodes.length, 0);
      let ph = canvas.querySelector('.placeholder');
      if (totalVisible === 0 && !ph) canvas.innerHTML = '<div class="placeholder">construction…</div>';
      if (totalVisible > 0 && ph) ph.remove();

      groups.forEach((group, i) => {
        let wrap = canvas.querySelector(':scope > [data-root-group="' + i + '"]');
        if (!wrap) {
          wrap = document.createElement('div');
          wrap.dataset.rootGroup = String(i);
          wrap.dataset.rootKind = group.kind;
          wrap.className = 'pv-root-' + group.kind;
          canvas.appendChild(wrap);
        }
        for (const ln of group.nodes) upsertLayoutNode(wrap, ln, focusId);
        // É18 — l'ordre DOM suit l'ordre du modèle (déplacement structurel)
        reorderChildren(wrap, group.nodes.map((ln) => ln.component.id));
      });
    }

    /* É18 — réordonnancement par insertions minimales : l'ordre DOM suit
       l'ordre du modèle sans recréer aucun nœud. */
    function reorderChildren(container, ids) {
      ids.forEach((id, position) => {
        const nodeEl = container.querySelector(':scope > [data-pv-id="' + id + '"]');
        if (nodeEl && container.children[position] !== nodeEl) {
          container.insertBefore(nodeEl, container.children[position] || null);
        }
      });
    }

    function upsertLayoutNode(parentEl, ln, focusId) {
      const c = ln.component;
      const isFocus = focusId === c.id;
      let nodeEl = parentEl.querySelector(':scope > [data-pv-id="' + c.id + '"]');
      if (!nodeEl) {
        // É18 — ADOPTION : un nœud déplacé existe ailleurs dans le canvas →
        // DÉPLACÉ par appendChild, jamais recréé (zéro doublon, data-pv-id,
        // contenu et animations préservés).
        const existing = el('canvas').querySelector('[data-pv-id="' + c.id + '"]');
        if (existing) {
          nodeEl = existing;
        } else {
          nodeEl = document.createElement('div');
          // É13 — l'identité VIENT DU MODÈLE (component.id), via la
          // définition unique previewNodeId : jamais un index, une position
          // ou un ordre d'affichage. Stable building → completed → viewports.
          nodeEl.dataset.pvId = previewNodeId(c);
          nodeEl.dataset.pvStatus = '';
          nodeEl.dataset.pvLabel = '';
        }
        parentEl.appendChild(nodeEl);
      }
      const statusChanged = nodeEl.dataset.pvStatus !== c.status;
      const focusChanged = nodeEl.classList.contains('focus') !== isFocus;
      // É16 — le label rendu est suivi comme le statut : un label ÉDITÉ dans
      // le modèle justifie la SEULE réécriture hors cycle (politique É11
      // inchangée sinon). Ce livre de rendu reste de la comptabilité page.
      const labelChanged = nodeEl.dataset.pvLabel !== (c.label || '');
      // É22 — le HTML réel édité (updateTextContent) passe par le même canal
      // que le label : une seule réécriture de contenu, puis stabilité.
      const realChanged = dirtyReal.has(c.id);
      // ÉTAPE 11 — la politique de rafraîchissement est PURE (renderer.js) :
      // un composant completed n'est JAMAIS re-rendu pour un simple passage
      // de focus — son contenu ne scintille pas, ses animations ne repartent
      // pas. La classe focus reste un simple toggle.
      if (shouldRefreshNode({ statusChanged: statusChanged, focusChanged: focusChanged, nextStatus: c.status, contentChanged: labelChanged || realChanged })) {
        // Lors d'une transition (building → completed), les enfants déjà
        // construits CONSERVENT leur DOM : détachés avant remplacement du
        // contenu, re-attachés par la boucle enfants ci-dessous — aucun
        // contenu perdu, aucune animation relancée (stabilisation, brief).
        const alive = nodeEl.querySelectorAll('[data-pv-id]');
        const keep = alive.length ? document.createDocumentFragment() : null;
        if (keep) alive.forEach((child) => keep.appendChild(child));
        nodeEl.className = 'pv-node ' + c.status + (isFocus ? ' focus' : '');
        nodeEl.innerHTML = nodeInner(c, isFocus);
        nodeEl.dataset.pvStatus = c.status;
        nodeEl.dataset.pvLabel = c.label || '';
        if (realChanged) dirtyReal.delete(c.id);
      } else if (focusChanged) {
        nodeEl.classList.toggle('focus', isFocus);
      }
      // É17 — variant de présentation : ATTRIBUT seul (aucune réécriture de
      // contenu, aucun rebuild) — le CSS dérive la présentation de l'attribut.
      const variant = c.variant || 'default';
      if (nodeEl.dataset.pvVariant !== variant) nodeEl.dataset.pvVariant = variant;
      // É21 — dimensions éditées : style inline seul (aucun contenu réécrit)
      const size = c.size;
      if (size) {
        nodeEl.style.width = size.width + 'px';
        nodeEl.style.height = size.height + 'px';
      } else if (nodeEl.dataset.resized === '1') {
        nodeEl.style.width = '';
        nodeEl.style.height = '';
      }
      nodeEl.dataset.resized = size ? '1' : '';
      // Wrapper de composition des enfants (kind dérivé du state)
      let wrap = nodeEl.querySelector(':scope > .pv-children');
      const kind = ln.layout.kind;
      if (ln.children.length) {
        if (!wrap) {
          wrap = document.createElement('div');
          wrap.className = 'pv-children pv-comp-' + kind;
          if (kind === 'grid') wrap.style.setProperty('--pv-cols', String(ln.layout.columns));
          nodeEl.appendChild(wrap);
        } else {
          wrap.className = 'pv-children pv-comp-' + kind;
          if (kind === 'grid') wrap.style.setProperty('--pv-cols', String(ln.layout.columns));
        }
        for (const child of ln.children) upsertLayoutNode(wrap, child, focusId);
        // É18 — ordre DOM des enfants imbriqués = ordre du modèle
        reorderChildren(wrap, ln.children.map((ch) => ch.component.id));
      } else if (wrap) {
        wrap.remove();
      }
    }

    function nodeInner(c, isFocus) {
      // ÉTAPE 05 — le VISUEL vient du registry (type → représentation), au
      // statut réel du state : building = titre + zones ghost, completed =
      // contenu final révélé. Type inconnu → visuel générique.
      if (c.status === 'error') {
        return '<div><span class="pv-label">' + c.label + '</span></div><div class="pv-error">' + (c.error || 'generation failed') + '</div>';
      }
      const visual = renderComponentVisual({ id: c.id, type: c.type, label: c.label, metadata: c.metadata }, c.status === 'building' ? 'building' : 'completed');
      if (c.status === 'building') {
        const banner = isFocus ? '<div class="pv-focus-banner"><span>◉</span> BUILDING</div>' : '';
        return banner + '<div><span class="pv-label">' + c.label + '</span><span class="pv-building-tag"></span></div>' + visual;
      }
      return visual;
    }

    /* ---------- RENDU GLOBAL (state → model → DOM) ---------- */
    function render(model) {
      const dot = el('statusDot'), badge = el('statusBadge');
      dot.className = 'dot ' + (model.status === 'building' ? 'building' : model.status === 'completed' ? 'completed' : model.status === 'error' ? 'error' : '');
      badge.textContent = model.statusLabel;
      badge.style.color = model.status === 'building' ? '#c4b5fd' : model.status === 'completed' ? '#34d399' : model.status === 'error' ? '#fb7185' : '#94a3b8';

      // LOT 06 — PASSAGE DE TÉMOIN : quand le focus CHANGE d'id, le nouveau
      // nœud reçoit un highlight court (classe visuelle retirée par l'anim CSS
      // — aucun état modifié, aucune décision venue de l'animation).
      const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (model.focusId && model.focusId !== lastFocusId && !reducedMotion) {
        const newNode = el('canvas').querySelector('[data-pv-id="' + model.focusId + '"]');
        if (newNode) {
          newNode.classList.remove('focus-move');
          void newNode.offsetWidth; // rejoue l'animation
          newNode.classList.add('focus-move');
          newNode.addEventListener('animationend', () => newNode.classList.remove('focus-move'), { once: true });
        }
      }
      lastFocusId = model.focusId || null;

      // LOT 04 — BUILD TIMELINE : dérivée de buildTimeline(state) — l'échelle
      // et la ligne « error » viennent du même state que le canvas.
      const steps = buildTimeline(state);
      el('stageLadder').innerHTML = steps.map((s) => {
        const cls = s.status === 'active' ? 'stage current' : s.status === 'completed' ? 'stage done' : 'stage';
        return '<div class="' + cls + '">' + s.stage + '</div>';
      }).join('') + (model.status === 'error' ? '<div class="stage error">error — ' + canonicalize(model.buildError || 'échec') + '</div>' : '');

      // LOT 04 — PROGRESSION : fraction réelle des composants terminés
      const pct = model.counts.total > 0 ? Math.round((model.counts.completed / model.counts.total) * 100) : 0;
      el('progressBar').style.width = pct + '%';
      el('progressText').textContent = model.progressLabel;

      // LOT 04 — CONSTRUCTION TREE : arbre indenté dérivé du model (pré-ordre
      // + depth), glyphes par statut, focus identifié (même state que le canvas).
      // ÉTAPE 14 — la sélection utilisateur lit le MÊME model : ▶ = intention
      // utilisateur (cyan), ◉ = Build Focus IA (violet) — indépendants.
      const glyphs = { building: '◉', completed: '✓', pending: '○', error: '⚠' };
      el('compTree').innerHTML = model.flat.map((n) => {
        const focusTag = n.isBuildFocus ? ' <span style="color:#a78bfa;">construction…</span>' : '';
        const selectedTag = n.isUserSelected ? ' <span style="color:#67e8f9;">sélection</span>' : '';
        const glyph = n.isUserSelected ? '▶' : (glyphs[n.status] || '○');
        return '<div class="tree-row ' + n.status + (n.isBuildFocus ? ' focus-row' : '') + (n.isUserSelected ? ' selected-row' : '') + '" style="margin-left:' + (n.depth * 16) + 'px;">'
          + '<span class="glyph">' + glyph + '</span>'
          + '<span>' + n.label + focusTag + selectedTag + '</span>'
          + '<span class="type">' + n.type + '</span></div>';
      }).join('') || '<div class="tree-row">—</div>';

      syncLayout(model.focusId);

      // ÉTAPE 14 — HIGHLIGHT DE SÉLECTION : classes + attribut UNIQUEMENT,
      // après syncLayout. Aucun innerHTML, aucun rebuild (politique É11) :
      // un clic ne reconstruit jamais le canvas. Le chip lit son libellé
      // DANS LE MODÈLE via l'attribut (content: attr(...) en CSS).
      const canvasEl = el('canvas');
      canvasEl.querySelectorAll('.selected').forEach((n) => {
        n.classList.remove('selected');
        n.removeAttribute('data-selected-label');
      });
      // É21 — les poignées de resize sont retirées à chaque rendu puis
      // recréées sur le composant sélectionné (jamais accumulées).
      document.querySelectorAll('.pv-resize-handle').forEach((h) => h.remove());
      if (model.selectedId) {
        const selEl = canvasEl.querySelector('[data-pv-id="' + model.selectedId + '"]');
        if (selEl) {
          selEl.classList.add('selected');
          selEl.setAttribute('data-selected-label', canonicalize(model.selectedLabel || model.selectedId));
          // É21 — poignées de resize : uniquement sur le composant sélectionné
          ['e', 's', 'se'].forEach((dir) => {
            const handle = document.createElement('div');
            handle.className = 'pv-resize-handle pv-rh-' + dir;
            handle.dataset.dir = dir;
            selEl.appendChild(handle);
          });
        }
      }

      // LOT 06 — AUTO-SCROLL doux : uniquement si le focus est réellement hors
      // de la zone visible ; 'nearest' = déplacement minimal, jamais forcé.
      const focusEl = model.focusId ? el('canvas').querySelector('[data-pv-id="' + model.focusId + '"]') : null;
      if (focusEl) {
        const wrap = focusEl.closest('.canvas-wrap');
        const fr = focusEl.getBoundingClientRect();
        const wr = wrap ? wrap.getBoundingClientRect() : null;
        if (wr && (fr.top < wr.top + 8 || fr.bottom > wr.bottom - 8)) {
          focusEl.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest' });
        }
      }

      el('progressLabel').textContent = model.progressLabel;
      const footer = el('footerStatus');
      // ÉTAPE 11 — statusbar dérivée du state : « ● Building X… » pendant la
      // construction, « ✓ X ready » entre deux composants (dernier stabilisé,
      // dérivé), « ● PREVIEW READY » à la fin. Même model que canvas/tree.
      const focusNode = model.focusId ? model.flat.find((n) => n.id === model.focusId) : null;
      if (model.status === 'error') { footer.textContent = model.statusLabel; footer.className = 'err'; }
      else if (focusNode) { footer.innerHTML = '<span class="dot building" style="display:inline-block;margin-right:8px;"></span>Building ' + canonicalize(focusNode.label) + '...'; footer.className = ''; }
      else if (model.status === 'building' && model.lastCompletedLabel) { footer.innerHTML = '<span style="color:#34d399;margin-right:8px;">✓</span>' + canonicalize(model.lastCompletedLabel) + ' ready'; footer.className = ''; }
      else if (model.status === 'completed') { footer.innerHTML = '<span class="dot completed" style="display:inline-block;margin-right:8px;"></span>PREVIEW READY'; footer.className = ''; }
      else { footer.textContent = model.statusLabel; footer.className = ''; }
      // ÉTAPE 14 — la sélection vit dans une ZONE SECONDAIRE : le statut de
      // construction (et PREVIEW READY) garde toujours la priorité.
      el('selectionStatus').textContent = model.selectedLabel ? 'Selected: ' + canonicalize(model.selectedLabel) : '';
      // ÉTAPE 15 — INSPECTOR : construit depuis le state et la sélection du
      // modèle (buildInspector, pur). Se met à jour avec le build : sélectionner
      // un composant en construction montre son statut évoluer en direct.
      renderInspector(buildInspector(state, model.selectedId ?? null));
    }

    function canonicalize(text) { return String(text).replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    /* ===== ÉTAPE 15/16 — INSPECTOR (descriptif + édition du LABEL) =====
       Les données viennent EXCLUSIVEMENT de buildInspector(state, selectedId)
       — donc du PreviewBuildState — jamais du DOM du canvas. Le HTML réel IA
       est affiché tel quel (échappé pour l'affichage), jamais transformé.
       É16 : le LABEL est l'unique champ éditable — bouton Apply → commande
       PURE updateComponentLabel() → NOUVEAU state → renderCurrent(). Aucun
       autre champ éditable, aucune écriture directe du DOM du canvas. */
    function renderInspector(inspector) {
      const body = el('inspectorBody');
      // La saisie en cours survit aux re-rendus (un build actif régénère le
      // panneau à chaque événement) : valeur + focus préservés.
      const prevInput = body.querySelector('#inspLabelInput');
      const typing = document.activeElement === prevInput ? prevInput.value : null;
      if (!inspector) {
        body.innerHTML = '<div class="insp-empty">Aucune sélection.<br>Cliquez sur un composant du preview<br>pour voir ses propriétés.</div>';
        return;
      }
      const row = (key, val) => '<div class="insp-row"><span class="insp-key">' + key + '</span><span class="insp-val">' + val + '</span></div>';
      // É24 — LINK : édition du href du lien réel cliqué (valeur d'attribut
      // échappée ; schémas dangereux refusés par la commande).
      if (linkCtx && linkCtx.componentId === inspector.id) {
        const prevLink = body.querySelector('#inspLinkInput');
        const keepLink = document.activeElement === prevLink ? prevLink.value : null;
        body.innerHTML = '<div class="insp-card">'
          + '<div class="insp-head"><div class="insp-title">' + canonicalize(inspector.label) + '</div><div class="insp-sub">lien réel IA — href</div></div>'
          + '<div class="insp-rows">' + row('Href actuel', canonicalize(linkCtx.href.length > 60 ? linkCtx.href.slice(0, 60) + '…' : linkCtx.href)) + '</div>'
          + '<div class="insp-editrow"><input id="inspLinkInput" maxlength="600" value="' + canonicalize(linkCtx.href) + '"><button id="inspLinkApply">APPLY</button><span id="inspLinkMsg"></span></div>'
          // É35 — édition IA du lien : consigne libre → outil set_link_href →
          // commande PURE updateLinkHref (la valeur ne quitte jamais l attribut).
          + '<div class="insp-editrow insp-ai"><input id="inspAiLinkInput" maxlength="300" placeholder="Décris la modification IA…"><button id="inspAiLink" title="Modifier ce lien avec l IA">✨ IA</button><span id="inspAiLinkMsg"></span></div>'
          + '</div>';
        if (keepLink !== null) {
          const linkInput = body.querySelector('#inspLinkInput');
          if (linkInput) { linkInput.value = keepLink; linkInput.focus(); linkInput.setSelectionRange(linkInput.value.length, linkInput.value.length); }
        }
        return;
      }
      // É23 — IMAGE : édition du src de l'image réelle cliquée (valeur
      // d'attribut échappée — jamais interprétée comme HTML).
      if (imageCtx && imageCtx.componentId === inspector.id) {
        const prevImg = body.querySelector('#inspImageInput');
        const keepImg = document.activeElement === prevImg ? prevImg.value : null;
        body.innerHTML = '<div class="insp-card">'
          + '<div class="insp-head"><div class="insp-title">' + canonicalize(inspector.label) + '</div><div class="insp-sub">image réelle IA — src</div></div>'
          + '<div class="insp-rows">' + row('Src actuel', canonicalize(imageCtx.src.length > 60 ? imageCtx.src.slice(0, 60) + '…' : imageCtx.src)) + '</div>'
          + '<div class="insp-editrow"><input id="inspImageInput" maxlength="600" value="' + canonicalize(imageCtx.src) + '"><button id="inspImageApply">APPLY</button><span id="inspImageMsg"></span></div>'
          // É35 — édition IA de l image : consigne libre → outil set_image_src
          // → commande PURE updateImageSource (valeur d attribut échappée).
          + '<div class="insp-editrow insp-ai"><input id="inspAiImageInput" maxlength="300" placeholder="Décris la modification IA…"><button id="inspAiImage" title="Modifier cette image avec l IA">✨ IA</button><span id="inspAiImageMsg"></span></div>'
          + '</div>';
        if (keepImg !== null) {
          const imgInput = body.querySelector('#inspImageInput');
          if (imgInput) { imgInput.value = keepImg; imgInput.focus(); imgInput.setSelectionRange(imgInput.value.length, imgInput.value.length); }
        }
        return;
      }
      // É22 — CONTENT : édition du TEXTE de l'élément réel IA cliqué (élément
      // textuel uniquement). La valeur est échappée dans l'attribut — jamais
      // injectée comme HTML — et survit aux re-rendus comme le champ Label.
      if (textCtx && textCtx.componentId === inspector.id) {
        const prevContent = body.querySelector('#inspContentInput');
        const keepContent = document.activeElement === prevContent ? prevContent.value : null;
        body.innerHTML = '<div class="insp-card">'
          + '<div class="insp-head"><div class="insp-title">' + canonicalize(inspector.label) + '</div><div class="insp-sub">contenu réel IA — texte</div></div>'
          + '<div class="insp-rows">' + row('Élément texte', canonicalize(textCtx.text.slice(0, 60)) + (textCtx.text.length > 60 ? '…' : '')) + '</div>'
          + '<div class="insp-editrow"><input id="inspContentInput" maxlength="400" value="' + canonicalize(textCtx.text) + '"><button id="inspContentApply">APPLY</button><span id="inspContentMsg"></span></div>'
          // É35 — édition IA du texte : consigne libre → outil set_text →
          // commande PURE updateTextContent (texte échappé, jamais du HTML).
          + '<div class="insp-editrow insp-ai"><input id="inspAiTextInput" maxlength="300" placeholder="Décris la modification IA…"><button id="inspAiText" title="Modifier ce texte avec l IA">✨ IA</button><span id="inspAiTextMsg"></span></div>'
          + '</div>';
        if (keepContent !== null) {
          const contentInput = body.querySelector('#inspContentInput');
          if (contentInput) { contentInput.value = keepContent; contentInput.focus(); contentInput.setSelectionRange(contentInput.value.length, contentInput.value.length); }
        }
        return;
      }
      const rows = [
        row('Label', '<input id="inspLabelInput" maxlength="80" value="' + canonicalize(inspector.label) + '">'),
        row('Type', canonicalize(inspector.type)),
        row('ID', canonicalize(inspector.id)),
        row('Parent', inspector.parentId ? canonicalize(inspector.parentId) : '—'),
        row('Status', '<span class="insp-status ' + inspector.status + '">' + canonicalize(inspector.status) + '</span>'),
        row('Étape', canonicalize(inspector.stage)),
        row('Enfants', inspector.children.length ? inspector.children.map(canonicalize).join(', ') : '—'),
        row('Dimensions', inspector.size ? Math.round(inspector.size.width) + ' × ' + Math.round(inspector.size.height) + ' px' : '—')
      ];
      // É16 — Apply : l'unique action d'édition du label (label uniquement)
      rows.splice(1, 0, '<div class="insp-editrow"><button id="inspApplyLabel" title="Appliquer le label au composant sélectionné">APPLY</button><span id="inspLabelMsg"></span></div>');
      // É17 — APPEARANCE : sélecteur du variant de présentation (boutons
      // compacts, variant courant surligné). Présentation seule — le contenu
      // et le HTML réel IA ne sont jamais touchés.
      const currentVariant = inspector.variant || 'default';
      rows.splice(2, 0, '<div class="insp-editrow insp-appear"><span class="insp-key">Appearance</span>'
        + PRESENTATION_VARIANTS.map((v) => '<button class="insp-variant' + (v === currentVariant ? ' active' : '') + '" data-variant="' + v + '" title="Variant ' + v + '">' + v + '</button>').join('')
        + '</div>');
      // É18 — STRUCTURE : position dérivée du state (jamais du DOM) + contrôles
      // Move to / Position / APPLY. Cibles : tout composant SAUF soi-même et
      // ses descendants (cycles impossibles par construction).
      const siblings = [...state.components.values()]
        .filter((x) => (x.parentId ?? null) === (inspector.parentId ?? null))
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
      const position = siblings.findIndex((x) => x.id === inspector.id) + 1;
      const isDescendantOf = (id) => {
        let cur = state.components.get(id);
        while (cur) {
          if (cur.id === inspector.id) return true;
          cur = cur.parentId !== undefined ? state.components.get(cur.parentId) : undefined;
        }
        return false;
      };
      const targets = [...state.components.values()]
        .filter((x) => x.id !== inspector.id && !isDescendantOf(x.id))
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
      const targetOptions = '<option value="">racine</option>'
        + targets.map((t) => '<option value="' + canonicalize(t.id) + '"' + (t.id === inspector.parentId ? ' selected' : '') + '>' + canonicalize(t.label || t.id) + '</option>').join('');
      const posCount = (inspector.parentId ? siblings.filter((x) => x.id !== inspector.id).length : siblings.length) + 1;
      const indexOptions = Array.from({ length: posCount }, (_, i) => '<option value="' + (i + 1) + '"' + (i + 1 === Math.min(position, posCount) ? ' selected' : '') + '>position ' + (i + 1) + '</option>').join('');
      rows.splice(3, 0, '<div class="insp-rows">'
        + row('Parent', inspector.parentId ? canonicalize((state.components.get(inspector.parentId) || {}).label || inspector.parentId) : 'racine')
        + row('Position', position + ' / ' + siblings.length)
        + '</div>'
        + '<div class="insp-editrow insp-structure"><span class="insp-key">Structure</span>'
        + '<select id="inspMoveTarget">' + targetOptions + '</select>'
        + '<select id="inspMoveIndex">' + indexOptions + '</select>'
        + '<button id="inspMoveApply" title="Déplacer le composant sélectionné">APPLY</button>'
        + '<span id="inspMoveMsg"></span></div>');
      // É36 — ÉDITION IA PAR COMPOSANT : l'IA reçoit l'inventaire des
      // éléments éditables (textes/images/liens avec leurs paths) et
      // enchaîne plusieurs appels d'outils, appliqués par les commandes
      // PURES. Uniquement si le composant porte du HTML réel IA.
      const comp = state.components.get(inspector.id);
      if (comp && comp.metadata && typeof comp.metadata.html === 'string' && comp.metadata.html.length > 0) {
        rows.splice(4, 0, '<div class="insp-editrow insp-ai"><input id="inspAiCompInput" maxlength="300" placeholder="Ex : réécris les textes de ce composant…">'
          + '<button id="inspAiComp" title="Modifier ce composant avec l IA (plusieurs éléments possibles)">✨ IA composant</button>'
          + '<span id="inspAiCompMsg"></span></div>');
      }
      const metaKeys = Object.keys(inspector.metadata || {}).filter((k) => k !== 'html');
      const metaRows = metaKeys.map((k) => {
        const v = inspector.metadata[k];
        const text = (v !== null && typeof v === 'object') ? JSON.stringify(v) : String(v);
        return row(canonicalize(k), canonicalize(text));
      });
      body.innerHTML = '<div class="insp-card">'
        + '<div class="insp-head"><div class="insp-title">' + canonicalize(inspector.label) + '</div><div class="insp-sub">' + canonicalize(inspector.type) + '</div></div>'
        + '<div class="insp-rows">' + rows.join('') + (inspector.hasRealHtml ? row('HTML réel IA', '<span class="insp-real">✓ présent</span>') : '') + '</div>'
        + (metaRows.length ? '<div class="insp-rows">' + metaRows.join('') + '</div>' : '')
        + (inspector.hasRealHtml ? '<details class="insp-details"><summary>Contenu réel IA — lecture seule</summary><pre>' + canonicalize(inspector.metadata.html) + '</pre></details>' : '')
        + '</div>';
      if (typing !== null) {
        const input = body.querySelector('#inspLabelInput');
        if (input) {
          input.value = typing;
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }
      }
    }

    // É16/É17/É18 — les chemins d'application (label, variant, structure)
    // passent par les commandes PURES de editing.ts : UI → commande →
    // NOUVEAU state → renderCurrent(). Le canvas se met à jour PAR LE
    // PIPELINE (label via contentChanged, variant via attribut, structure
    // via adoption/réordonnancement), jamais en direct.
    // É18 — le choix de « Move to » recalcule les positions disponibles.
    el('inspectorBody').addEventListener('change', (e) => {
      if (e.target.id !== 'inspMoveTarget' || !selectedComponentId) return;
      const target = e.target.value === '' ? null : e.target.value;
      const idx = el('inspMoveIndex');
      const count = [...state.components.values()]
        .filter((x) => x.id !== selectedComponentId && (x.parentId ?? null) === target)
        .length + 1;
      idx.innerHTML = Array.from({ length: count }, (_, i) => '<option value="' + (i + 1) + '">position ' + (i + 1) + '</option>').join('');
    });
    // É38 — PERSISTANCE DES ÉDITIONS : l'HTML réel d'un composant correspond
    // à une SECTION du index.html serveur (bloc data-section). Après chaque
    // édition appliquée (APPLY manuel ou IA), la section est renvoyée au
    // serveur : remplacement du bloc + RÉVISION réversible. Fire-and-forget :
    // l'édition locale reste valide même si la sauvegarde échoue (signalé
    // dans la ligne de statut, jamais de blocage ni de perte silencieuse).
    async function persistSection(componentId) {
      if (!currentProjectId || !componentId) return;
      const comp = state.components.get(componentId);
      const html = comp && comp.metadata ? comp.metadata.html : null;
      if (typeof html !== 'string' || html.length === 0) return;
      try {
        const res = await fetch('/api/v1/projects/' + currentProjectId + '/files/section/' + encodeURIComponent(componentId), {
          method: 'PUT',
          headers: H,
          body: JSON.stringify({ html: html })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          if (v2Status) v2Status.textContent = '⚠ Édition non sauvegardée côté serveur (HTTP ' + res.status + ')';
        } else if (data && data.applied === false) {
          if (v2Status) v2Status.textContent = '⚠ Section non trouvée dans le HTML serveur (' + componentId + ')';
        } else {
          // succès : on efface tout avertissement stale d'un échec antérieur
          if (v2Status && v2Status.textContent.indexOf('⚠') === 0) v2Status.textContent = 'Édition sauvegardée côté serveur ✓';
        }
      } catch (err) {
        if (v2Status) v2Status.textContent = '⚠ Édition non sauvegardée côté serveur (' + (err instanceof Error ? err.message : String(err)) + ')';
      }
    }

    // É37 — VALIDATION D'IMAGE RÉELLE : une URL proposée par l'IA est testée
    // (new Image + timeout) AVANT application. Si elle ne charge pas, la
    // boucle renvoie l'erreur au modèle qui propose une AUTRE URL — finies
    // les images cassées générées par l'IA.
    function validateImageUrl(url) {
      return new Promise((resolve) => {
        const img = new Image();
        const timer = setTimeout(() => { img.src = ''; resolve('délai dépassé'); }, 5000);
        img.onload = () => { clearTimeout(timer); resolve(null); };
        img.onerror = () => { clearTimeout(timer); resolve('image introuvable'); };
        img.src = url;
      });
    }

    // E43 — PRÉVISUALISATION DES ÉDITIONS IA : quand la case est cochée, les
    // boucles composant/page tournent en mode diffféré (les appels validés
    // sont collectés, RIEN n'est appliqué ni persisté) ; le récapitulatif
    // lisible est affiché et l'utilisateur confirme ou refuse. La confirmation
    // rejoue les appels via la MÊME commande pure (l'état n'a pas bougé) —
    // undo et persistance suivent le chemin normal E42/E38.
    function aiPreviewEnabled() {
      const c = el('chkAiPreview');
      return c ? c.checked : false;
    }
    let pendingAiDiff = null;
    function showAiDiffPanel(title, groups, pending) {
      // E44 — groupes par section : chaque groupe a sa case (cochée par
      // défaut) ; APPLIQUER ne rejoue que les groupes cochés.
      el('aiDiffTitle').textContent = title;
      el('aiDiffList').innerHTML = groups.map((g) =>
        '<div class="ai-diff-group" data-diff-section="' + canonicalize(g.section) + '" style="margin-bottom:6px;">'
        + '<label style="display:flex; gap:6px; align-items:center; color:#c4b5fd;"><input type="checkbox" data-section-check="' + canonicalize(g.section) + '" checked> <b>' + canonicalize(g.section) + '</b> — ' + g.lines.length + ' modification(s)</label>'
        + g.lines.map((l) => '<div style="padding:2px 0 2px 20px; border-bottom:1px solid #1a2238;">' + l + '</div>').join('')
        + '</div>'
      ).join('');
      pendingAiDiff = pending;
      el('aiDiffPanel').classList.remove('hidden');
    }
    el('aiDiffPanel').addEventListener('click', async (e) => {
      const action = e.target.getAttribute && e.target.getAttribute('data-action');
      if (!action || !pendingAiDiff) return;
      el('aiDiffPanel').classList.add('hidden');
      const pending = pendingAiDiff;
      pendingAiDiff = null;
      if (action === 'reject') {
        if (v2Status) v2Status.textContent = 'Éditions IA refusées — rien n a été appliqué.';
        return;
      }
      const checked = Array.from(el('aiDiffList').querySelectorAll('[data-section-check]:checked'))
        .map((c) => c.getAttribute('data-section-check'));
      if (checked.length === 0) {
        if (v2Status) v2Status.textContent = 'Aucune section cochée — rien n a été appliqué.';
        return;
      }
      await pending.onConfirm(checked);
    });

    // É35 — ÉDITION IA PAR OUTILS : le modèle répond EXCLUSIVEMENT via un
    // appel d'outil structuré (set_text / set_image_src / set_link_href)
    // relayé par le proxy (la clé API reste côté serveur). La valeur produite
    // est appliquée par la COMMANDE PURE correspondante — même canal qu'un
    // APPLY manuel, jamais injectée comme HTML, jamais écrite en direct.
    let aiEditBusy = false;
    async function startAiEdit(kind, ctx, inputId, msgEl) {
      if (!ctx || aiEditBusy || !msgEl) return;
      const input = el(inputId);
      const instruction = input ? input.value.trim() : '';
      if (!instruction) { msgEl.textContent = 'Décris d abord la modification.'; return; }
      aiEditBusy = true;
      msgEl.textContent = 'IA en cours…';
      const currentValue = kind === 'text' ? ctx.text : kind === 'image' ? ctx.src : ctx.href;
      let outcome;
      try {
        outcome = await runAiEditLoop({
          // fetch natif JAMAIS passé nu : débindé par le passage d'argument
          // (this ≠ window → « Illegal invocation » dans le navigateur).
          fetchImpl: (url, init) => fetch(url, init),
          url: '/api/v1/ai/chat/completions',
          request: { kind: kind, instruction: instruction, currentValue: currentValue },
          headers: H,
          validateImageUrl: validateImageUrl
        });
      } finally {
        aiEditBusy = false;
      }
      if (!outcome.ok) {
        msgEl.textContent = outcome.reason === 'no-tool-call' ? 'IA: réponse sans outil (réessaie)'
          : outcome.reason === 'invalid-args' ? 'IA: arguments invalides (réessaie)'
          : outcome.reason === 'image-inaccessible' ? 'IA: image inaccessible même après relance (réessaie)'
          : outcome.reason === 'empty-instruction' ? 'Consigne vide'
          : 'IA indisponible (' + (outcome.detail || outcome.reason) + ')';
        return;
      }
      const prevAiHtml = previousHtmlOf(ctx.componentId); // E42 — capturé avant application
      const result = kind === 'text' ? updateTextContent(state, ctx.componentId, ctx.path, outcome.value)
        : kind === 'image' ? updateImageSource(state, ctx.componentId, ctx.path, outcome.value)
        : updateLinkHref(state, ctx.componentId, ctx.path, outcome.value);
      if (!result.applied) {
        msgEl.textContent = 'Modification refusée: ' + result.reason;
        return;
      }
      pushUndoBatch('Édition IA', prevAiHtml ? [{ componentId: ctx.componentId, html: prevAiHtml }] : []);
      state = result.state;
      dirtyReal.add(ctx.componentId);
      const persistedAiId = ctx.componentId; // É38 — capturé avant reset
      if (kind === 'text') textCtx = null;
      else if (kind === 'image') imageCtx = null;
      else linkCtx = null;
      renderCurrent();
      persistSection(persistedAiId);
    }

    // É36 — ÉDITION IA PAR COMPOSANT : l'inventaire des éléments éditables
    // est construit depuis metadata.html (mêmes conventions de path que le
    // parseur des commandes), envoyé au modèle, et chaque tool_call est
    // appliqué via la COMMANDE PURE correspondante. Les modifications déjà
    // appliquées restent en place en cas d'échec partiel (honnête).
    let aiCompEditBusy = false;
    async function startAiComponentEdit() {
      const msgEl = el('inspAiCompMsg');
      if (!selectedComponentId || aiCompEditBusy || !msgEl) return;
      const comp = state.components.get(selectedComponentId);
      const html = comp && comp.metadata ? comp.metadata.html : null;
      if (typeof html !== 'string' || html.length === 0) { msgEl.textContent = 'Aucun contenu réel IA sur ce composant.'; return; }
      const input = el('inspAiCompInput');
      const instruction = input ? input.value.trim() : '';
      if (!instruction) { msgEl.textContent = 'Décris d abord la modification.'; return; }
      const inventory = inventoryEditableElements(html);
      if (inventory.length === 0) { msgEl.textContent = 'Aucun élément éditable trouvé dans ce composant.'; return; }
      aiCompEditBusy = true;
      msgEl.textContent = 'IA en cours…';
      const componentId = selectedComponentId;
      const undoSnapshots = []; // E42 — un lot unique pour tout le lot IA
      // E43 — le callback d'application est partagé : boucle (mode live) ET
      // confirmation de la prévisualisation rejouent la MÊME commande pure.
      const applyCall = (call) => {
        const value = call.args.text ?? call.args.src ?? call.args.href;
        const path = call.args.path;
        const prevHtml = previousHtmlOf(componentId); // E42 — avant application
        const result = call.name === 'set_text' ? updateTextContent(state, componentId, path, String(value))
          : call.name === 'set_image_src' ? updateImageSource(state, componentId, path, String(value))
          : updateLinkHref(state, componentId, path, String(value));
        if (!result.applied) return 'ERREUR: modification refusée (' + (result.reason || 'inconnue') + ')';
        if (prevHtml !== null) undoSnapshots.push({ componentId: componentId, html: prevHtml });
        state = result.state;
        dirtyReal.add(componentId);
        return 'OK';
      };
      let outcome;
      try {
        outcome = await runAiComponentEditLoop({
          // fetch natif JAMAIS passé nu (débindé → Illegal invocation).
          fetchImpl: (url, init) => fetch(url, init),
          url: '/api/v1/ai/chat/completions',
          instruction: instruction,
          inventory: inventory,
          headers: H,
          validateImageUrl: validateImageUrl,
          deferApply: aiPreviewEnabled(),
          apply: applyCall
        });
      } finally {
        aiCompEditBusy = false;
      }
      if (outcome.ok && aiPreviewEnabled() && outcome.proposedCalls.length > 0) {
        // E43 — prévisualisation : rien n'a été appliqué ni persisté.
        const oldLookup = new Map(inventory.map((e2) => [JSON.stringify(e2.path), e2.value]));
        const lines = outcome.proposedCalls.map((c) => {
          const old = oldLookup.get(JSON.stringify(c.args.path));
          const value = String(c.args.text ?? c.args.src ?? c.args.href);
          return '<b>' + canonicalize(c.name) + '</b> ' + JSON.stringify(c.args.path) + ' : '
            + (old !== undefined ? '« ' + canonicalize(String(old).slice(0, 60)) + ' »' : '(nouveau)') + ' → « ' + canonicalize(value.slice(0, 60)) + ' »';
        });
        // E44 — un seul groupe (le composant) ; onConfirm applique SEULEMENT
        // les groupes cochés.
        showAiDiffPanel('Édition IA du composant « ' + canonicalize(componentId) + ' » — ' + lines.length + ' modification(s) proposée(s)',
          [{ section: componentId, lines }],
          {
            onConfirm: async (checkedSections) => {
              const wanted = new Set(checkedSections);
              const calls = outcome.proposedCalls.filter(() => wanted.has(componentId));
              let applied = 0;
              for (const c of calls) {
                if ((await applyCall(c)) === 'OK') applied += 1;
              }
              renderCurrent();
              if (applied > 0) pushUndoBatch('Édition IA du composant', undoSnapshots);
              if (applied > 0) await persistSection(componentId);
              if (msgEl) msgEl.textContent = applied + ' modification(s) appliquée(s) après prévisualisation';
            }
          });
        return;
      }
      if (outcome.ok && outcome.appliedCount > 0) pushUndoBatch('Édition IA du composant', undoSnapshots);
      renderCurrent();
      const msgEl2 = el('inspAiCompMsg');
      if (outcome.ok && outcome.appliedCount > 0) persistSection(componentId); // É38 — une révision par lot d'éditions
      if (!msgEl2) return;
      if (!outcome.ok) {
        msgEl2.textContent = 'IA indisponible (' + (outcome.detail || outcome.reason) + ')';
        return;
      }
      msgEl2.textContent = 'IA : ' + outcome.appliedCount + ' modification(s) appliquée(s)'
        + (outcome.toolErrors.length > 0 ? ' — ' + outcome.toolErrors.length + ' refus(s)' : '')
        + (outcome.limitReached ? ' — borne d appels atteinte' : '');
    }

    el('inspectorBody').addEventListener('click', (e) => {
      // É24 — APPLY du href lien : UI → updateLinkHref() → nouveau state →
      // renderCurrent() (canal dirtyReal). Schémas dangereux refusés par la
      // commande (javascript:, variantes encodées/espacées) — jamais exécutés.
      if (e.target.id === 'inspLinkApply') {
        const msgL = el('inspLinkMsg');
        if (!linkCtx) return;
        const linkInput = el('inspLinkInput');
        const prevLinkHtml = previousHtmlOf(linkCtx.componentId); // E42 — capturé avant application
        const resultLink = updateLinkHref(state, linkCtx.componentId, linkCtx.path, linkInput.value);
        if (!resultLink.applied) {
          if (msgL) msgL.textContent = resultLink.reason === 'empty-href' ? 'Href vide refusé'
            : resultLink.reason === 'unsafe-href' ? 'Schéma interdit (javascript:, data:…)'
            : resultLink.reason === 'not-link' ? 'Cible non lien'
            : resultLink.reason === 'invalid-path' ? 'Cible introuvable'
            : resultLink.reason === 'missing-content' ? 'Aucun contenu réel'
            : 'Href déjà identique';
          return;
        }
        pushUndoBatch('Édition du lien', prevLinkHtml ? [{ componentId: linkCtx.componentId, html: prevLinkHtml }] : []);
        state = resultLink.state;
        dirtyReal.add(linkCtx.componentId);
        const persistedLinkId = linkCtx.componentId; // É38 — capturé avant reset
        linkCtx = null;
        renderCurrent();
        persistSection(persistedLinkId);
        return;
      }
      // É23 — APPLY du src image : UI → updateImageSource() → nouveau state
      // → renderCurrent() (canal dirtyReal). La valeur reste une VALEUR
      // D'ATTRIBUT échappée — jamais interprétée comme HTML.
      if (e.target.id === 'inspImageApply') {
        const msgI = el('inspImageMsg');
        if (!imageCtx) return;
        const imgInput = el('inspImageInput');
        const prevImgHtml = previousHtmlOf(imageCtx.componentId); // E42 — capturé avant application
        const resultImg = updateImageSource(state, imageCtx.componentId, imageCtx.path, imgInput.value);
        if (!resultImg.applied) {
          if (msgI) msgI.textContent = resultImg.reason === 'empty-src' ? 'Src vide refusé'
            : resultImg.reason === 'not-image' ? 'Cible non image'
            : resultImg.reason === 'invalid-path' ? 'Cible introuvable'
            : resultImg.reason === 'missing-content' ? 'Aucun contenu réel'
            : 'Src déjà identique';
          return;
        }
        pushUndoBatch('Édition de l image', prevImgHtml ? [{ componentId: imageCtx.componentId, html: prevImgHtml }] : []);
        state = resultImg.state;
        dirtyReal.add(imageCtx.componentId);
        const persistedImageId = imageCtx.componentId; // É38 — capturé avant reset
        imageCtx = null;
        renderCurrent();
        persistSection(persistedImageId);
        return;
      }
      // É22 — APPLY du texte réel : UI → updateTextContent() → nouveau state
      // → renderCurrent() (le canal dirtyReal rafraîchit le contenu du nœud).
      // Le texte est échappé dans la commande — jamais injecté comme HTML.
      if (e.target.id === 'inspContentApply') {
        const msgC = el('inspContentMsg');
        if (!textCtx) return;
        const contentInput = el('inspContentInput');
        const prevTextHtml = previousHtmlOf(textCtx.componentId); // E42 — capturé avant application
        const resultText = updateTextContent(state, textCtx.componentId, textCtx.path, contentInput.value);
        if (!resultText.applied) {
          if (msgC) msgC.textContent = resultText.reason === 'empty-text' ? 'Texte vide refusé'
            : resultText.reason === 'not-textual' ? 'Cible non textuelle'
            : resultText.reason === 'invalid-path' ? 'Cible introuvable'
            : resultText.reason === 'missing-content' ? 'Aucun contenu réel'
            : 'Texte déjà identique';
          return;
        }
        pushUndoBatch('Édition du texte', prevTextHtml ? [{ componentId: textCtx.componentId, html: prevTextHtml }] : []);
        state = resultText.state;
        dirtyReal.add(textCtx.componentId);
        const persistedTextId = textCtx.componentId; // É38 — capturé avant reset
        textCtx = null;
        renderCurrent();
        persistSection(persistedTextId);
        return;
      }
      // É35 — boutons ✨ IA (texte / image / lien) : consigne → boucle
      // d'outils → commande PURE. Le contexte de clic est relu À CHAQUE
      // appel (les re-rendus recréent le DOM mais les ctx sont conservés).
      if (e.target.id === 'inspAiText') { startAiEdit('text', textCtx, 'inspAiTextInput', el('inspAiTextMsg')); return; }
      if (e.target.id === 'inspAiImage') { startAiEdit('image', imageCtx, 'inspAiImageInput', el('inspAiImageMsg')); return; }
      if (e.target.id === 'inspAiLink') { startAiEdit('link', linkCtx, 'inspAiLinkInput', el('inspAiLinkMsg')); return; }
      // É36 — édition IA multi-éléments du composant sélectionné
      if (e.target.id === 'inspAiComp') { startAiComponentEdit(); return; }
      // É18 — déplacement structurel (moveComponent)
      if (e.target.id === 'inspMoveApply') {
        const msg = el('inspMoveMsg');
        if (!selectedComponentId) return;
        const targetVal = el('inspMoveTarget').value;
        const targetParent = targetVal === '' ? null : targetVal;
        const idx = parseInt(el('inspMoveIndex').value, 10) - 1;
        const result = moveComponent(state, selectedComponentId, targetParent, idx);
        if (!result.applied) {
          if (msg) msg.textContent = result.reason === 'cycle' ? 'Cycle refusé'
            : result.reason === 'unknown-parent' ? 'Parent introuvable'
            : result.reason === 'unknown-component' ? 'Composant introuvable'
            : result.reason === 'invalid-index' ? 'Position invalide'
            : 'Structure déjà identique';
          return;
        }
        state = result.state;
        renderCurrent();
        return;
      }
      // É17 — sélecteur de variant de présentation
      const variantBtn = e.target.closest('.insp-variant');
      if (variantBtn) {
        if (!selectedComponentId) return;
        const result = updateComponentVariant(state, selectedComponentId, variantBtn.dataset.variant);
        const msg = el('inspLabelMsg');
        if (!result.applied) {
          if (msg) msg.textContent = result.reason === 'invalid-variant' ? 'Variant invalide' : '';
          return;
        }
        state = result.state;
        renderCurrent();
        return;
      }
      if (e.target.id !== 'inspApplyLabel') return;
      const msg = el('inspLabelMsg');
      if (!selectedComponentId || msg === null) return;
      const input = el('inspLabelInput');
      const result = updateComponentLabel(state, selectedComponentId, input.value);
      if (!result.applied) {
        msg.textContent = result.reason === 'empty-label' ? 'Label vide refusé'
          : result.reason === 'unknown-component' ? 'Composant introuvable'
          : 'Label déjà identique';
        return;
      }
      state = result.state; // le nouvel état devient la vérité rendue
      renderCurrent();
    });

    /* ---------- Pipeline : EVENT → ENGINE → STATE → RENDERER → CANVAS ---------- */
    function consume(event) {
      state = applyBuildEvent(state, event);
      renderCurrent();
    }

    /* ===== ÉTAPE 14 — SÉLECTION INTERACTIVE (état d'interaction UI) =====
       selectedComponentId n'appartient JAMAIS à PreviewBuildState : c'est un
       état UI de la page, dérivé d'UN seul mécanisme — resolvePreviewTarget()
       (fondation É13). Un seul écouteur sur document : DOM → id → highlight.
       Aucun index, position, texte ou classe CSS pour identifier ; la
       sélection ne touche qu'aux classes/attributs + overlay (jamais de
       rebuild canvas — politique É11 conservée). */
    let selectedComponentId = null;

    function renderCurrent() {
      render(renderPreview(state, { selectedId: selectedComponentId }));
    }

    /* ===== E46 — FILET ANTI-IMAGES CASSÉES (canvas) =====
       Les sites générés contiennent parfois des URL d'images mortes (l'IA
       hallucine). Le Studio avait vibeFixImages ; le Builder applique la
       même politique : TOUTE image en échec dans le HTML réel est remplacée
       par un placeholder déterministe élégant (dégradé + image de secours
       fiable), une seule fois par image (garde data-imgfallback — jamais de
       boucle). L'attribut alt est conservé pour l'accessibilité. */
    let imgFallbackSeed = 0;
    el('canvas').addEventListener('error', (e) => {
      const img = e.target;
      if (!img || img.tagName !== 'IMG' || img.dataset.imgfallback) return;
      img.dataset.imgfallback = '1';
      imgFallbackSeed += 1;
      const label = (img.alt || 'image').replace(/[^a-zA-Z0-9]/g, '-').slice(0, 30) + '-' + imgFallbackSeed;
      img.style.background = 'linear-gradient(135deg,#1e293b,#0f172a)';
      img.style.minHeight = img.style.minHeight || '180px';
      img.style.objectFit = img.style.objectFit || 'cover';
      img.src = 'https://picsum.photos/seed/' + encodeURIComponent(label) + '/800/520';
    }, true);

    document.addEventListener('click', (e) => {
      // Le sélecteur de viewport est du chrome d'affichage : changer de
      // viewport conserve la sélection (l'identité ne change jamais).
      // É16 — interagir avec l'édition du label (saisie / Apply) ne
      // désélectionne pas : le clic fait partie du flux d'édition.
      if (e.target.closest('.insp-editrow')) return;
      // É20 — un drag qui vient de se terminer émet un click résiduel :
      // il ne doit pas désélectionner le composant fraîchement déplacé.
      if (Date.now() < suppressNextClickUntil) return;
      selectedComponentId = resolvePreviewTarget(e.target);
      // É22 — cible TEXTUELLE réelle : élément du realHtml sans enfant
      // élément et avec du texte (les conteneurs ne donnent jamais de champ
      // texte). Le chemin est dérivé du CONTENU (index d'éléments jusqu'au
      // .pvz-real), jamais d'une position DOM globale.
      // É23 — cible IMAGE réelle : une <img> du realHtml ouvre la section
      // Image (src courant). Les deux contextes s'excluent mutuellement.
      // É24 — un lien du contenu réel ne doit JAMAIS naviguer : le clic
      // reste un clic de SÉLECTION du Preview.
      if (e.target.closest && e.target.closest('.pvz-real a')) e.preventDefault();
      textCtx = null;
      imageCtx = null;
      linkCtx = null;
      const realRoot = e.target.closest ? e.target.closest('.pvz-real') : null;
      const hostNode = e.target.closest ? e.target.closest('[data-pv-id]') : null;
      if (selectedComponentId && realRoot && hostNode && hostNode.contains(e.target)) {
        const path = [];
        let cur = e.target;
        while (cur && cur !== realRoot) {
          const p = cur.parentElement;
          if (!p) { path.length = 0; break; }
          path.unshift(Array.prototype.indexOf.call(p.children, cur));
          cur = p;
        }
        const anchorAncestor = e.target.closest ? e.target.closest('a') : null;
        if (e.target.tagName === 'IMG') {
          if (path.length > 0) imageCtx = { componentId: hostNode.dataset.pvId, path: path, src: e.target.getAttribute('src') || '' };
        } else if (anchorAncestor && realRoot.contains(anchorAncestor)) {
          // É24 — clic sur un lien (ou son texte) : le LIEN est la cible.
          let cur2 = anchorAncestor;
          const anchorPath = [];
          while (cur2 && cur2 !== realRoot) {
            const p2 = cur2.parentElement;
            if (!p2) { anchorPath.length = 0; break; }
            anchorPath.unshift(Array.prototype.indexOf.call(p2.children, cur2));
            cur2 = p2;
          }
          if (anchorPath.length > 0) linkCtx = { componentId: hostNode.dataset.pvId, path: anchorPath, href: anchorAncestor.getAttribute('href') || '' };
        } else if (e.target.children && e.target.children.length === 0
          && e.target.textContent && e.target.textContent.trim().length > 0) {
          if (path.length > 0) textCtx = { componentId: hostNode.dataset.pvId, path: path, text: e.target.textContent.trim() };
        }
      }
      renderCurrent();
    });

    /* ===== ÉTAPE 20 — DRAG & DROP RÉEL (pointer events, fondation É19) =====
       pointerdown → pointermove → pointerup UNIQUEMENT (aucun événement
       HTML5). La source du drag est résolue par resolvePreviewTarget().
       Pendant le drag : indicateur de dépose dérivé de resolveDropTarget()
       + computeDropTarget() — AUCUN déplacement DOM, AUCUNE mutation du
       state. Au pointerup : intent → computeDropTarget → applyDragIntent
       (délégation moveComponent, unique source de vérité) → nouveau state
       → renderCurrent(). L'indicateur disparaît toujours, succès ou refus. */
    const MIN_DRAG_PX = 6;
    let dragCtx = null;
    let suppressNextClickUntil = 0; // É25 — le drapeau EXPIRE : un pointerup sans click natif ne doit pas avaler le clic suivant
    // É22 — contexte d'édition texte : composant + chemin dans le HTML réel
    // + texte capturé au clic. État d'interaction UI, jamais du state.
    let textCtx = null;
    // É23 — contexte d'édition image : composant + chemin + src courant.
    let imageCtx = null;
    // É24 — contexte d'édition lien : composant + chemin + href courant.
    let linkCtx = null;

    el('canvas').addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const componentId = resolvePreviewTarget(e.target);
      if (!componentId) return;
      dragCtx = { componentId: componentId, startX: e.clientX, startY: e.clientY, active: false };
    });

    document.addEventListener('pointermove', (e) => {
      if (!dragCtx) return;
      if (!dragCtx.active) {
        if (Math.hypot(e.clientX - dragCtx.startX, e.clientY - dragCtx.startY) < MIN_DRAG_PX) return;
        dragCtx.active = true;
        document.body.classList.add('pv-dragging');
      }
      updateDropIndicator(e.clientX, e.clientY, dragCtx.componentId);
    });

    document.addEventListener('pointerup', (e) => {
      if (!dragCtx) return;
      const wasActive = dragCtx.active;
      const draggedId = dragCtx.componentId;
      dragCtx = null;
      hideDropIndicator();
      document.body.classList.remove('pv-dragging');
      if (!wasActive) return; // pointerup sans mouvement : simple clic
      suppressNextClickUntil = Date.now() + 400;
      // pointerup → intention → compute → apply (délégation moveComponent)
      const intent = resolveDropTarget(document.elementFromPoint(e.clientX, e.clientY), { x: e.clientX, y: e.clientY }, draggedId);
      if (!intent) return; // hors preview → refus propre
      const result = applyDragIntent(state, intent);
      if (result.applied) {
        state = result.state; // SEUL changement du state : au pointerup validé
        renderCurrent();
      }
    });

    // É27 — PONT STUDIO → BUILDER (additif) : le chat du Studio transmet
    // l'intention de génération ; le Builder reste MAÎTRE de son pipeline —
    // il déclenche son PROPRE flux (v2Prompt + btnReal, même endpoint SSE).
    // Origine vérifiée ; tout autre message est ignoré. Aucune écriture
    // externe dans ce document (le Studio ne fait que poster).
    // SOURCE UNIQUE — le Builder suit le projet ACTIF du Studio (plus
    // projects[0] aveugle : c'est ce qui affichait un vieux projet pendant
    // que l'onglet ouvrait le bon).
    let builderProjectId = null;
    window.addEventListener('message', (ev) => {
      if (ev.origin !== location.origin) return;
      const d = ev.data || {};
      if (d.source !== 'vibecode-studio') return;
      if (typeof d.projectId === 'string' && d.projectId) builderProjectId = d.projectId;
      if (d.command === 'sync-project') { syncProjectContent(); return; }
      // RELAI (plus de 2e génération) : le flux du chat est rejoué dans le
      // moteur (démarrage paresseux au 1er événement moteur, jamais sur une
      // génération manuelle en cours). Le bouton GÉNÉRER manuel garde SON flux.
      if (d.command === 'builder-event' && d.event && typeof d.event === 'object') {
        if (realSource) return;
        try {
          const norm = normalizeGenerationEvent(d.event);
          if (!norm || norm.events.length === 0) return;
          if (state.status !== 'building') {
            state = createPreviewBuildState();
            consume({ kind: 'BUILD_STARTED', stage: 'structure', timestamp: Date.now() });
          }
          for (const e of norm.events) consume(e);
        } catch (e) { /* frame malformée : le flux continue */ }
        return;
      }
      if (d.command !== 'start-builder-generation') return;
      const promptInput = document.getElementById('v2Prompt');
      if (!promptInput || typeof d.prompt !== 'string' || !d.prompt.trim()) return;
      promptInput.value = d.prompt;
      // Affichage seul : la GÉNÉRATION vient du relai (pas de 2e flux).
      if (v2Status) v2Status.textContent = 'Génération reçue du chat — construction en direct…';
    });
    // Recharge le projet suivi depuis le serveur — jamais pendant une
    // génération réelle en cours (le flux en livrera le contenu).
    async function syncProjectContent() {
      if (realSource) return;
      await resumeSession(builderProjectId || undefined);
    }

    document.addEventListener('pointercancel', () => {
      dragCtx = null;
      hideDropIndicator();
      document.body.classList.remove('pv-dragging');
    });

    function ensureDropIndicator() {
      let ind = document.getElementById('dropIndicator');
      if (!ind) {
        ind = document.createElement('div');
        ind.id = 'dropIndicator';
        el('canvas').appendChild(ind);
      }
      return ind;
    }

    function hideDropIndicator() {
      const ind = document.getElementById('dropIndicator');
      if (ind) ind.style.display = 'none';
    }

    function updateDropIndicator(x, y, componentId) {
      const indicator = ensureDropIndicator();
      const intent = resolveDropTarget(document.elementFromPoint(x, y), { x: x, y: y }, componentId);
      const hostEl = intent ? document.querySelector('[data-pv-id="' + intent.hoveredId + '"]') : null;
      if (!intent || !hostEl) { indicator.style.display = 'none'; return; }
      const target = computeDropTarget(state, intent);
      indicator.className = target ? '' : 'forbidden'; // cible refusée → rouge
      const crect = el('canvas').getBoundingClientRect();
      const r = hostEl.getBoundingClientRect();
      const vertical = (r.bottom - r.top) >= (r.right - r.left);
      indicator.style.display = 'block';
      if (intent.edge === 'inside') {
        indicator.className += ' ring';
        indicator.style.top = (r.top - crect.top) + 'px';
        indicator.style.left = (r.left - crect.left) + 'px';
        indicator.style.width = r.width + 'px';
        indicator.style.height = r.height + 'px';
      } else if (vertical) {
        indicator.className += ' bar-h';
        indicator.style.top = (intent.edge === 'before' ? r.top - crect.top - 2 : r.bottom - crect.top + 1) + 'px';
        indicator.style.left = (r.left - crect.left) + 'px';
        indicator.style.width = r.width + 'px';
        indicator.style.height = '3px';
      } else {
        indicator.className += ' bar-v';
        indicator.style.left = (intent.edge === 'before' ? r.left - crect.left - 2 : r.right - crect.left + 1) + 'px';
        indicator.style.top = (r.top - crect.top) + 'px';
        indicator.style.height = r.height + 'px';
        indicator.style.width = '3px';
      }
    }

    /* ===== ÉTAPE 21 — RESIZE INTERACTIF (pointer events, poignées) =====
       Poignées e/s/se affichées UNIQUEMENT sur le composant sélectionné.
       Écouteur en CAPTURE + stopPropagation : le pointerdown d'une poignée
       n'atteint JAMAIS le DnD É20. Pendant le resize : aperçu visuel LOCAL
       (style inline du nœud) — aucune mutation du state, aucun déplacement
       DOM. Au pointerup : resizeComponent() → nouveau state →
       renderCurrent(). pointercancel : nettoyage + restauration du state. */
    let resizeCtx = null;
    // É22 — composants dont le HTML réel a été édité : canal de
    // rafraîchissement du contenu (livre de rendu page, pas état métier).
    const dirtyReal = new Set();

    document.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest ? e.target.closest('.pv-resize-handle') : null;
      if (!handle) return;
      e.stopPropagation();
      e.preventDefault();
      const componentId = resolvePreviewTarget(handle);
      if (!componentId) return;
      const nodeEl = el('canvas').querySelector('[data-pv-id="' + componentId + '"]');
      if (!nodeEl) return;
      const rect = nodeEl.getBoundingClientRect();
      resizeCtx = {
        componentId: componentId,
        mode: handle.dataset.dir,
        startX: e.clientX,
        startY: e.clientY,
        baseW: rect.width,
        baseH: rect.height,
        nodeEl: nodeEl
      };
      document.body.classList.add('pv-resizing');
    }, true);

    document.addEventListener('pointermove', (e) => {
      if (!resizeCtx) return;
      // Aperçu visuel LOCAL : style inline du nœud — le state reste intact.
      const clamped = (v, min, max) => Math.min(max, Math.max(min, v));
      const w = clamped(Math.round(resizeCtx.baseW + (resizeCtx.mode !== 's' ? e.clientX - resizeCtx.startX : 0)), RESIZE_BOUNDS.minWidth, RESIZE_BOUNDS.maxWidth);
      const h = clamped(Math.round(resizeCtx.baseH + (resizeCtx.mode !== 'e' ? e.clientY - resizeCtx.startY : 0)), RESIZE_BOUNDS.minHeight, RESIZE_BOUNDS.maxHeight);
      resizeCtx.previewW = w;
      resizeCtx.previewH = h;
      resizeCtx.nodeEl.style.width = w + 'px';
      resizeCtx.nodeEl.style.height = h + 'px';
    });

    document.addEventListener('pointerup', (e) => {
      if (!resizeCtx) return;
      const ctx = resizeCtx;
      resizeCtx = null;
      document.body.classList.remove('pv-resizing');
      const clamped = (v, min, max) => Math.min(max, Math.max(min, v));
      const w = clamped(Math.round(ctx.baseW + (ctx.mode !== 's' ? e.clientX - ctx.startX : 0)), RESIZE_BOUNDS.minWidth, RESIZE_BOUNDS.maxWidth);
      const h = clamped(Math.round(ctx.baseH + (ctx.mode !== 'e' ? e.clientY - ctx.startY : 0)), RESIZE_BOUNDS.minHeight, RESIZE_BOUNDS.maxHeight);
      const result = resizeComponent(state, ctx.componentId, w, h);
      if (result.applied) state = result.state; // SEUL changement : au pointerup
      renderCurrent(); // applique la taille du state OU restaure l'ancienne
    });

    document.addEventListener('pointercancel', () => {
      if (!resizeCtx) return;
      resizeCtx = null;
      document.body.classList.remove('pv-resizing');
      renderCurrent(); // restaure les dimensions du state
    });

    // ÉTAPE 08 — DEUX SOURCES interchangeables, le moteur ne voit que des
    // PreviewBuildEvents (BuildEventSource, spec §problème 2) :
    //   - MockBuildEventSource    : scénario démo (par défaut)
    //   - SSEBuildEventSource     : transport SSE simulé → adapter → moteur
    // La bascule se fait par le bouton ; aucune logique du moteur ne change.
    let activeSource = null;

    function startWith(source) {
      if (timer) { clearInterval(timer); timer = null; }
      if (activeSource) { activeSource.stop(); activeSource = null; }
      state = createPreviewBuildState();
      lastFocusId = null;
      selectedComponentId = null; // É14 — nouvelle construction : sélection à blanc
      btnStart.disabled = true;
      activeSource = source.subscribe(
        (event) => consume(event),
        () => { btnStart.disabled = false; }
      );
    }

    // ÉTAPE 09 — VRAI FLUX derrière le flag centralisé PREVIEW_BUILDER_V2.
    // Le flag est résolu UNE fois (query ?v2 > localStorage > OFF) et le
    // panneau Real AI Generation n'apparaît qu'en ON — jamais d'activation
    // implicite. Le chemin mock/SSE simulée reste disponible pour la démo.
    const v2Flag = resolvePreviewBuilderV2({ search: location.search, storageGet: (k) => localStorage.getItem(k) });
    // SOURCE UNIQUE — le Builder annonce son chargement au Studio (intégré
    // uniquement) : le Studio répond avec le projet ACTIF. Sans ça, un
    // rechargement affiche projects[0] au lieu du projet actif.
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ source: 'vibecode-builder', command: 'builder-ready' }, location.origin);
      }
    } catch (e) { /* hors iframe : rien à annoncer */ }
    const v2Panel = document.getElementById('v2Panel');
    const v2Status = document.getElementById('v2Status');
    if (v2Flag === 'on' && v2Panel) {
      v2Panel.classList.remove('hidden');
      resumeSession(); // E41 — reprise de session (site existant → canvas)
    }

    // E42 — PILE D'ANNULATION PAR LOTS : chaque action utilisateur (APPLY
    // manuel, édition IA mono-élément, lot IA composant/page) pousse UN lot
    // des HTML antérieurs des composants touchés. L'annulation restitue le
    // HTML antérieur via la commande PURE restoreComponentHtml, puis
    // resynchronise le serveur (persistSection — une révision « annulation »).
    const editUndoStack = [];
    function pushUndoBatch(label, snapshots) {
      if (snapshots.length > 0) editUndoStack.push({ label: label, snapshots: snapshots });
    }
    // Capture du HTML antérieur : à appeler AVANT l'application, pendant que
    // `state` référence encore l'état d'avant l'édition.
    function previousHtmlOf(componentId) {
      const comp = state.components.get(componentId);
      const html = comp && comp.metadata ? comp.metadata.html : null;
      return typeof html === 'string' ? html : null;
    }
    async function undoLastEdit() {
      if (historyBusy) return;
      const batch = editUndoStack.pop();
      if (!batch) { if (v2Status) v2Status.textContent = 'Rien à annuler.'; return; }
      const restored = [];
      for (const snap of batch.snapshots) {
        const result = restoreComponentHtml(state, snap.componentId, snap.html);
        if (result.applied) {
          state = result.state;
          dirtyReal.add(snap.componentId);
          restored.push(snap.componentId);
        }
      }
      renderCurrent();
      for (const componentId of restored) {
        await persistSection(componentId);
      }
      if (v2Status) v2Status.textContent = '↩ Annulé : ' + batch.label + ' (' + restored.length + ' section(s) resynchronisée(s))';
    }

    // E41 — RECONSTRUCTION DU CANVAS depuis un index.html serveur : utilisée
    // par la restauration d'historique (E40) ET par la reprise de session
    // (boot). Séquence obligatoire RESET → STARTED → CREATED/READY →
    // COMPLETED (le moteur ignore les composants hors statut 'building').
    function rebuildCanvasFromHtml(content) {
      consume({ kind: 'BUILD_RESET', timestamp: Date.now() });
      consume({ kind: 'BUILD_STARTED', stage: 'content', timestamp: Date.now() });
      const sections = extractSections(content);
      sections.forEach((s) => {
        consume({ kind: 'COMPONENT_CREATED', component: { id: s.name, type: s.name, label: s.name }, timestamp: Date.now() });
        consume({ kind: 'COMPONENT_READY', componentId: s.name, metadata: { html: s.html }, timestamp: Date.now() });
      });
      consume({ kind: 'BUILD_COMPLETED', timestamp: Date.now() });
      return sections.length;
    }

    // E41 — REPRISE DE SESSION : au chargement (mode v2), le site existant du
    // premier projet serveur est rechargé dans le canvas — un rafraîchissement
    // ne perd plus le site (les éditions, elles, sont déjà persistées É38).
    // Silencieux en mode démo/offline ; n'écrase JAMAIS un build en cours.
    // SOURCE UNIQUE : avec un projectId explicite (sync du Studio), on
    // recharge CE projet même si le canvas n'est pas vide — c'est un ordre,
    // pas une devinette (le bail anti-écrasement ne vaut que pour le boot).
    async function resumeSession(explicitProjectId) {
      try {
        let proj = null;
        if (typeof explicitProjectId === 'string' && explicitProjectId) {
          const pres = await fetch('/api/v1/projects', { headers: H });
          const pdata = await pres.json();
          proj = (pdata.projects || pdata).find((p) => p && p.id === explicitProjectId) || null;
          if (!proj) return;
        } else {
          const pres = await fetch('/api/v1/projects', { headers: H });
          const pdata = await pres.json();
          proj = (pdata.projects || pdata)[0];
          if (!proj) return;
        }
        currentProjectId = proj.id;
        // P3 — si le projet est au format react-vite : recharger le BUNDLE
        const st = await fetch('/api/v1/projects/' + proj.id + '/app/status', { headers: H });
        if (st.ok) {
          const stData = await st.json();
          if (stData.format === 'react-vite' && stData.hasBundle) {
            appSource = { projectId: proj.id };
            showAppBundle(proj.id, 'resume');
            if (v2Status) v2Status.textContent = 'App React rechargée (' + (stData.files || []).length + ' fichiers) — ✨ IA pour la modifier.';
            return;
          }
        }
        const fres = await fetch('/api/v1/projects/' + proj.id + '/files/content?path=index.html', { headers: H });
        if (!fres.ok) return;
        const fdata = await fres.json();
        const content = fdata && fdata.file ? fdata.file.content : null;
        if (typeof content !== 'string' || content.length === 0) return;
        // Ordre explicite du Studio : on recharge même si le canvas affiche
        // déjà autre chose (c'est exactement le bug panneau≠onglet).
        const explicit = typeof explicitProjectId === 'string' && !!explicitProjectId;
        if (state.components.size > 0 && !explicit) return;
        const sectionCount = rebuildCanvasFromHtml(content);
        if (sectionCount > 0 && v2Status) {
          v2Status.textContent = 'Site existant rechargé (' + sectionCount + ' section(s)) — édite-le, ou 🕘 HISTORIQUE pour une version antérieure.';
        }
      } catch {
        // pas de serveur / mode démo : démarrage à blanc, comme avant
      }
    }

    let realSource = null;
    // É38 — le projet serveur utilisé par la dernière génération réelle :
    // clé de la persistance des éditions (mock/démo → null → pas de PUT).
    let currentProjectId = null;

    // LOT 06/08 — le bouton MOCK reste le chemin de démonstration par défaut
    btnStart.addEventListener('click', () => {
      const events = scriptToEvents(demoBuildScript());
      startWith(new MockBuildEventSource({ events, intervalMs: 300 }));
    });

    // PV-03 — garde anti-réentrance : deux démarrages concurrents (double
    // listener, double-clic nerveux) créaient 2 sessions + 2 flux SSE facturés
    // qui écrivaient dans le même état. Le 2e démarrage pendant la phase
    // d'amorçage est ignoré ; un nouveau clic APRÈS reste possible (restart).
    let realGenerationStarting = false;
    async function startRealGeneration() {
      if (realGenerationStarting) return;
      realGenerationStarting = true;
      try {
      const promptInput = document.getElementById('v2Prompt');
      const message = promptInput ? promptInput.value.trim() : '';
      if (!message) { if (v2Status) v2Status.textContent = 'Décris d’abord l’interface à générer.'; return; }
      // 1. Projet serveur : celui SUIVI (ordre du Studio), sinon premier.
      const pres = await fetch('/api/v1/projects', { headers: H });
      const pdata = await pres.json();
      const list = (pdata.projects || pdata);
      const proj = (builderProjectId && list.find((p) => p && p.id === builderProjectId)) || list[0];
      if (!proj) { if (v2Status) v2Status.textContent = 'Aucun projet serveur.'; return; }
      currentProjectId = proj.id;
      // 2. Session de conversation réelle
      const sres = await fetch('/api/v1/projects/' + proj.id + '/conversation/sessions', { method: 'POST', headers: H });
      const sdata = await sres.json();
      const sid = sdata.session.sessionId;
      if (v2Status) v2Status.textContent = 'sessionId: ' + sid;
      // 3. Flux SSE RÉEL — le MÊME endpoint que le Studio, consommé par V2.
      // ÉTAPE 11 — le HANDLE (avec stop) est stocké, pas l'instance : sans
      // cela, le deuxième GÉNÉRER plantait en silence (realSource.stop is
      // not a function) et le canvas restait sur l'ancien état.
      exitAppBundle();
      if (realSource) realSource.stop();
      state = createPreviewBuildState();
      lastFocusId = null;
      selectedComponentId = null;
      renderCurrent();
      realSource = new SSEBuildEventSource({
        url: '/api/v1/projects/' + proj.id + '/conversation/sessions/' + sid + '/stream',
        body: { message, isModification: false, planFirst: false },
        headers: H
      }).subscribe(
        (event) => consume(event),
        (m) => {
          if (v2Status) v2Status.textContent = 'Erreur: ' + m;
          // PV-05 — le texte seul laissait le moteur en « building » (canvas
          // fantôme) : on pousse l'échec DANS l'état pour le débloquer.
          try {
            state = applyBuildEvent(state, { kind: 'BUILD_FAILED', error: String(m || 'erreur inconnue'), timestamp: Date.now() });
            renderCurrent();
          } catch (e) { /* état déjà terminal : le texte suffit */ }
        }
      );
      } finally {
        realGenerationStarting = false;
      }
    }

    document.getElementById('btnReal').addEventListener('click', () => { startRealGeneration(); });

    /* ===== P1/P2 — GÉNÉRATION D'UN VRAI PROJET REACT (standard premium) =====
       L'IA écrit un projet Vite+React+TS+Tailwind multi-fichiers côté serveur
       (tool-calling), le serveur le CONSTRUIT (build < 1 s) et le canvas
       embarque le BUNDLE exécutable — scripts, imports, styles : tout vit.
       Progression en SSE (fichiers créés, build, auto-réparation). */
    let appSource = null;
    function showAppBundle(projectId, buildId) {
      // P5-bis — le bundle occupe 100 % du panneau : le canvas HTML est
      // MASQUÉ (plus de cadre ni de placeholder « construction… ») et
      // l'iframe vit dans .canvas-wrap, hors du pipeline de rendu — un
      // renderCurrent ne peut plus la détruire.
      document.documentElement.classList.add('app-mode');
      const wrap = document.querySelector('.canvas-wrap');
      const canvas = el('canvas');
      canvas.style.display = 'none';
      const prev = wrap.querySelector('#appBundleFrame');
      if (prev) prev.remove();
      const frame = document.createElement('iframe');
      frame.id = 'appBundleFrame';
      frame.setAttribute('sandbox', 'allow-scripts allow-modals allow-forms allow-popups');
      frame.src = '/preview-bundle/' + encodeURIComponent(projectId) + '/?v=' + encodeURIComponent(buildId);
      frame.style.cssText = 'width:100%;height:100vh;border:0;background:#0b0f1a;display:block;';
      wrap.appendChild(frame);
    }

    // Sortie du mode bundle : le canvas HTML redevient visible (RESET,
    // génération HTML, etc.).
    function exitAppBundle() {
      document.documentElement.classList.remove('app-mode');
      const wrap = document.querySelector('.canvas-wrap');
      const frame = wrap && wrap.querySelector('#appBundleFrame');
      if (frame) frame.remove();
      const canvas = el('canvas');
      if (canvas) canvas.style.display = '';
    }

    async function startAppGeneration() {
      const promptInput = document.getElementById('v2Prompt');
      const message = promptInput ? promptInput.value.trim() : '';
      if (!message) { if (v2Status) v2Status.textContent = "Décris d'abord l'application à générer."; return; }
      const pres = await fetch('/api/v1/projects', { headers: H });
      const pdata = await pres.json();
      const proj = (pdata.projects || pdata)[0];
      if (!proj) { if (v2Status) v2Status.textContent = 'Aucun projet serveur.'; return; }
      currentProjectId = proj.id;
      if (v2Status) v2Status.textContent = 'Génération du projet React en cours…';
      if (realSource) realSource.stop();
      state = createPreviewBuildState();
      renderCurrent();
      const res = await fetch('/api/v1/projects/' + proj.id + '/app/generate', {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ prompt: message })
      });
      if (!res.ok || !res.body) { if (v2Status) v2Status.textContent = 'HTTP ' + res.status; return; }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let done = false;
      while (!done) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const line = raw.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          let ev;
          try { ev = JSON.parse(line.slice(6)); } catch { continue; }
          if (ev.type === 'file') { if (v2Status) v2Status.textContent = 'Fichier créé : ' + ev.path; }
          else if (ev.type === 'generation-done') { if (v2Status) v2Status.textContent = 'Projet écrit — build en cours…'; }
          else if (ev.type === 'build-ok') { if (v2Status) v2Status.textContent = 'Build réussi (' + ev.durationMs + ' ms)'; }
          else if (ev.type === 'repair') { if (v2Status) v2Status.textContent = 'Auto-réparation du build (tour ' + ev.round + ')…'; }
          else if (ev.type === 'build-error') { if (v2Status) v2Status.textContent = 'Build en échec — correction automatique…'; }
          else if (ev.type === 'done') {
            done = true;
            if (ev.ok) {
              appSource = { projectId: proj.id };
              showAppBundle(proj.id, ev.buildId);
              if (v2Status) v2Status.textContent = 'App React générée et exécutée (' + ev.durationMs + ' ms, ' + (ev.files || []).length + ' fichiers).';
            } else if (v2Status) {
              v2Status.textContent = 'La génération a échoué après auto-réparation — réessaie.';
            }
          } else if (ev.type === 'error') {
            done = true;
            if (v2Status) v2Status.textContent = 'Erreur : ' + (ev.error || 'inconnue');
          }
        }
      }
    }
    const btnAppReal = document.getElementById('btnAppReal');
    if (btnAppReal) btnAppReal.addEventListener('click', () => { startAppGeneration(); });

    // É39 — ÉDITION IA PAR PAGE : l'inventaire de TOUS les composants à HTML
    // réel (section = id du composant) est envoyé au modèle, qui enchaîne
    // des set_text / set_image_src / set_link_href avec section+path. Chaque
    // appel passe par la COMMANDE PURE du composant visé ; les sections
    // touchées sont ensuite persistées SÉQUENTIELLEMENT (deux PUT parallèles
    // sur le même index.html s'écraseraient l'un l'autre) — une révision par
    // section (É38).
    let aiPageEditBusy = false;
    async function startAiPageEdit() {
      const statusEl = v2Status;
      const input = el('pageAiInput');
      const instruction = input ? input.value.trim() : '';
      if (aiPageEditBusy) return;
      if (!instruction) { if (statusEl) statusEl.textContent = 'Décris d abord la modification.'; return; }
      const inventory = [];
      state.components.forEach((comp) => {
        const compHtml = comp.metadata ? comp.metadata.html : null;
        if (typeof compHtml !== 'string' || compHtml.length === 0) return;
        inventoryEditableElements(compHtml, 40).forEach((e2) => inventory.push({ section: comp.id, path: e2.path, kind: e2.kind, tag: e2.tag, value: e2.value }));
      });
      if (inventory.length === 0) { if (statusEl) statusEl.textContent = 'Aucun élément éditable : génère d abord un site.'; return; }
      aiPageEditBusy = true;
      if (statusEl) statusEl.textContent = 'IA page en cours… (' + inventory.length + ' éléments inventoriés)';
      const undoPageSnapshots = []; // E42 — un lot unique pour toute l'action page
      // E43 — callback partagé : boucle (live) ET confirmation rejouent la
      // MÊME commande pure.
      const applyCall = (call) => {
        const sectionId = String(call.args.section);
        const path = call.args.path;
        const value = String(call.args.text ?? call.args.src ?? call.args.href);
        const prevSectionHtml = previousHtmlOf(sectionId); // E42 — avant application
        const result = call.name === 'set_text' ? updateTextContent(state, sectionId, path, value)
          : call.name === 'set_image_src' ? updateImageSource(state, sectionId, path, value)
          : updateLinkHref(state, sectionId, path, value);
        if (!result.applied) return 'ERREUR: modification refusée (' + (result.reason || 'inconnue') + ') — vérifie section et path de l inventaire';
        if (prevSectionHtml !== null) undoPageSnapshots.push({ componentId: sectionId, html: prevSectionHtml });
        state = result.state;
        dirtyReal.add(sectionId);
        return 'OK';
      };
      let outcome;
      try {
        outcome = await runAiPageEditLoop({
          // fetch natif JAMAIS passé nu (débindé → Illegal invocation).
          fetchImpl: (url, init) => fetch(url, init),
          url: '/api/v1/ai/chat/completions',
          instruction: instruction,
          inventory: inventory,
          headers: H,
          validateImageUrl: validateImageUrl,
          deferApply: aiPreviewEnabled(),
          apply: applyCall
        });
      } finally {
        aiPageEditBusy = false;
      }
      if (outcome.ok && aiPreviewEnabled() && outcome.proposedCalls.length > 0) {
        // E43 — prévisualisation : rien n'a été appliqué ni persisté.
        const oldLookup = new Map(inventory.map((e2) => [e2.section + ':' + JSON.stringify(e2.path), e2.value]));
        // E44 — regroupement PAR SECTION (une case à cocher par groupe).
        const groupOrder = [];
        const groupsBySection = new Map();
        for (const c of outcome.proposedCalls) {
          const section = String(c.args.section);
          if (!groupsBySection.has(section)) { groupsBySection.set(section, { section: section, calls: [], lines: [] }); groupOrder.push(section); }
          const group = groupsBySection.get(section);
          group.calls.push(c);
          const old = oldLookup.get(section + ':' + JSON.stringify(c.args.path));
          const value = String(c.args.text ?? c.args.src ?? c.args.href);
          group.lines.push('<b>' + canonicalize(c.name) + '</b> ' + JSON.stringify(c.args.path) + ' : '
            + (old !== undefined ? '« ' + canonicalize(String(old).slice(0, 60)) + ' »' : '(nouveau)') + ' → « ' + canonicalize(value.slice(0, 60)) + ' »');
        }
        const groups = groupOrder.map((sec) => groupsBySection.get(sec));
        showAiDiffPanel('Édition IA de la page — ' + outcome.proposedCalls.length + ' modification(s) dans ' + groups.length + ' section(s)', groups, {
          onConfirm: async (checkedSections) => {
            const wanted = new Set(checkedSections);
            const calls = outcome.proposedCalls.filter((c) => wanted.has(String(c.args.section)));
            let applied = 0;
            for (const c of calls) {
              if ((await applyCall(c)) === 'OK') applied += 1;
            }
            renderCurrent();
            if (applied > 0) pushUndoBatch('Édition IA de la page', undoPageSnapshots);
            const touched = [...new Set(undoPageSnapshots.map((s2) => s2.componentId))];
            for (const sectionId of touched) {
              await persistSection(sectionId);
            }
            if (statusEl) statusEl.textContent = 'IA page : ' + applied + ' modification(s) appliquée(s) dans ' + touched.length + ' section(s) après prévisualisation';
          }
        });
        return;
      }
      if (outcome.ok && outcome.appliedCount > 0) pushUndoBatch('Édition IA de la page', undoPageSnapshots);
      renderCurrent();
      if (!outcome.ok) {
        if (statusEl) statusEl.textContent = 'IA page indisponible (' + (outcome.detail || outcome.reason) + ')';
        return;
      }
      for (const sectionId of outcome.touchedSections) {
        await persistSection(sectionId);
      }
      if (statusEl) statusEl.textContent = 'IA page : ' + outcome.appliedCount + ' modification(s) dans ' + outcome.touchedSections.length + ' section(s)'
        + (outcome.toolErrors.length > 0 ? ' — ' + outcome.toolErrors.length + ' refus(s)' : '')
        + (outcome.limitReached ? ' — borne atteinte' : '');
      if (input) input.value = '';
    }
    document.getElementById('btnPageAi').addEventListener('click', () => {
      // P3 — projet React généré → édition par FICHIERS ; sinon flux HTML
      if (appSource) startAppEdit();
      else startAiPageEdit();
    });

    /* ===== P3 — ÉDITION IA PAR FICHIERS (projet React) =====
       Propositions DIFFÉRÉES par l'IA (edit_file/create_file validés, rien
       d'écrit) → diff groupé par fichier avec cases (E44) → confirmation →
       /app/apply-edits (révision multi-fichiers + rebuild) → nouveau bundle. */
    let aiAppEditBusy = false;
    async function startAppEdit() {
      const statusEl = v2Status;
      const input = el('pageAiInput');
      const instruction = input ? input.value.trim() : '';
      if (aiAppEditBusy) return;
      if (!instruction) { if (statusEl) statusEl.textContent = 'Décris d abord la modification.'; return; }
      const projectId = appSource.projectId;
      aiAppEditBusy = true;
      if (statusEl) statusEl.textContent = 'IA (projet React) en cours…';
      let outcome = null;
      try {
        const res = await fetch('/api/v1/projects/' + projectId + '/app/edit', {
          method: 'POST', headers: H, body: JSON.stringify({ instruction: instruction })
        });
        if (!res.ok || !res.body) { if (statusEl) statusEl.textContent = 'HTTP ' + res.status; return; }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const raw = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const line = raw.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            let ev;
            try { ev = JSON.parse(line.slice(6)); } catch { continue; }
            if (ev.type === 'proposals') { outcome = ev; }
            else if (ev.type === 'error') { outcome = { error: ev.error }; }
          }
        }
      } finally {
        aiAppEditBusy = false;
      }
      if (!outcome || outcome.error) {
        if (statusEl) statusEl.textContent = 'IA indisponible (' + (outcome && outcome.error ? outcome.error : 'réponse vide') + ')';
        return;
      }
      const edits = outcome.edits || [];
      if (edits.length === 0) { if (statusEl) statusEl.textContent = 'Aucune modification nécessaire.'; return; }
      // Diff groupé PAR FICHIER avec cases (E44)
      const groupOrder = [];
      const byFile = new Map();
      for (const ed of edits) {
        if (!byFile.has(ed.path)) { byFile.set(ed.path, { section: ed.path, calls: [], lines: [] }); groupOrder.push(ed.path); }
        const g = byFile.get(ed.path);
        g.calls.push(ed);
        g.lines.push('<b>' + (ed.action === 'create' ? 'création' : 'modification') + '</b> : ' + canonicalize(ed.summary || ''));
      }
      const groups = groupOrder.map((sec) => byFile.get(sec));
      showAiDiffPanel('Édition IA du projet — ' + edits.length + ' modification(s) dans ' + groups.length + ' fichier(s)', groups, {
        onConfirm: async (checkedFiles) => {
          const wanted = new Set(checkedFiles);
          const selected = edits.filter((ed) => wanted.has(ed.path));
          if (selected.length === 0) { if (statusEl) statusEl.textContent = 'Aucun fichier coché — rien appliqué.'; return; }
          if (statusEl) statusEl.textContent = 'Application de ' + selected.length + ' modification(s) + build…';
          const res = await fetch('/api/v1/projects/' + projectId + '/app/apply-edits', {
            method: 'POST', headers: H, body: JSON.stringify({ edits: selected })
          });
          if (!res.ok || !res.body) { if (statusEl) statusEl.textContent = 'HTTP ' + res.status; return; }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            let idx;
            while ((idx = buffer.indexOf('\n\n')) >= 0) {
              const raw = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              const line = raw.split('\n').find((l) => l.startsWith('data: '));
              if (!line) continue;
              let ev;
              try { ev = JSON.parse(line.slice(6)); } catch { continue; }
              if (ev.type === 'build-ok') { if (statusEl) statusEl.textContent = 'Build réussi (' + ev.durationMs + ' ms)'; }
              else if (ev.type === 'done') {
                if (ev.ok) showAppBundle(projectId, ev.buildId);
                if (statusEl) statusEl.textContent = ev.ok
                  ? ev.applied + ' modification(s) appliquée(s) — app reconstruite.'
                  : 'Le build échoue après application — réessaie ou annule via 🕘 HISTORIQUE.';
              }
            }
          }
        }
      });
    }

    // E40 — HISTORIQUE DES RÉVISIONS : les 8 dernières versions (générations
    // + éditions Builder), avec restauration en un clic. Le rollback serveur
    // réécrit le index.html réel (correction E40) ; le canvas local est
    // reconstruit depuis le HTML restauré (un composant par data-section).
    let revisionsCache = [];
    let historyBusy = false;
    async function loadHistory() {
      const panel = el('historyPanel');
      const list = el('historyList');
      if (!panel || !list) return;
      if (!currentProjectId) { v2Status.textContent = 'Historique indisponible en mode démo (aucun projet serveur).'; return; }
      if (historyBusy) return;
      historyBusy = true;
      list.textContent = 'Chargement…';
      try {
        const res = await fetch('/api/v1/projects/' + currentProjectId + '/revisions', { headers: H });
        const data = await res.json();
        revisionsCache = (data.revisions || []).slice(-8).reverse();
        if (revisionsCache.length === 0) { list.textContent = 'Aucune révision.'; return; }
        list.innerHTML = revisionsCache.map((r) => {
          const time = String(r.createdAt).slice(11, 19);
          const label = '#' + r.revisionNumber + ' · ' + time + ' · ' + canonicalize(String(r.message).slice(0, 70));
          return '<div class="hist-row" style="display:flex; gap:6px; align-items:center; padding:3px 0; border-bottom:1px solid #1a2238;">'
            + '<span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="' + canonicalize(String(r.message)) + '">' + label + '</span>'
            + '<button data-restore="' + canonicalize(r.id) + '" style="background:#1d4ed8; padding:2px 8px; font-size:10px;">RESTAURER</button>'
            + '</div>';
        }).join('');
      } catch (err) {
        list.textContent = 'Impossible de charger l historique (' + (err instanceof Error ? err.message : String(err)) + ')';
      } finally {
        historyBusy = false;
      }
    }

    async function restoreRevision(revId) {
      const target = revisionsCache.find((r) => r.id === revId);
      const artifact = target && target.files ? target.files['index.html'] : null;
      const content = artifact ? (typeof artifact === 'string' ? artifact : artifact.content) : null;
      if (!target || typeof content !== 'string' || content.length === 0) {
        v2Status.textContent = '⚠ Contenu de la révision indisponible.';
        return;
      }
      v2Status.textContent = 'Restauration de la révision #' + target.revisionNumber + '…';
      const res = await fetch('/api/v1/projects/' + currentProjectId + '/revisions/' + encodeURIComponent(revId) + '/rollback', {
        method: 'POST',
        headers: H
      });
      if (!res.ok) { v2Status.textContent = '⚠ Rollback échoué (HTTP ' + res.status + ')'; return; }
      // Reconstruction du canvas local depuis le HTML restauré — par
      // consume(), le pipeline UNIQUE des événements (helper partagé E41).
      const sectionCount = rebuildCanvasFromHtml(content);
      v2Status.textContent = 'Restauré : révision #' + target.revisionNumber + ' (' + sectionCount + ' section(s), index.html réécrit côté serveur)';
      loadHistory();
    }

    document.getElementById('btnHistory').addEventListener('click', () => {
      const panel = el('historyPanel');
      if (!panel) return;
      if (panel.classList.contains('hidden')) { panel.classList.remove('hidden'); loadHistory(); }
      else panel.classList.add('hidden');
    });
    // E42 — annulation : bouton + raccourci Ctrl+Z (hors champs de saisie,
    // où Ctrl+Z reste l'undo natif du navigateur).
    document.getElementById('btnUndo').addEventListener('click', () => { undoLastEdit(); });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        e.preventDefault();
        undoLastEdit();
      }
    });
    el('historyList').addEventListener('click', (e) => {
      const revId = e.target.getAttribute && e.target.getAttribute('data-restore');
      if (revId) restoreRevision(revId);
    });
    document.getElementById('btnStopReal').addEventListener('click', () => {
      if (realSource) { realSource.stop(); realSource = null; }
      if (v2Status) v2Status.textContent = '⏹ Flux réel interrompu (les composants construits restent affichés)';
    });


    // SSE simulée : le transport produit du TEXTE SSE brut (avec bruit) —
    // l'adaptateur parse/valide/normalise, le moteur ne sait rien du SSE.
    btnSse.addEventListener('click', () => {
      const chunks = demoSseChunks();
      let i = 0;
      const encoder = new TextEncoder();
      const fakeStream = {
        getReader: () => ({
          read: async () => (i < chunks.length ? { done: false, value: encoder.encode(chunks[i++]) } : { done: true, value: undefined })
        })
      };
      startWith(new SSEBuildEventSource({ url: 'sse://demo', fetchImpl: function () { return Promise.resolve({ ok: true, body: fakeStream }); } }));
    });

    btnReset.addEventListener('click', () => {
      exitAppBundle();
      if (timer) { clearInterval(timer); timer = null; btnStart.disabled = false; }
      if (activeSource) { activeSource.stop(); activeSource = null; }
      selectedComponentId = null;
      consume({ kind: 'BUILD_RESET', timestamp: Date.now() });
    });

    // ÉTAPE 07 — VIEWPORTS : mode d'affichage pur (classList sur le canvas).
    // Aucun re-render, aucun état modifié, la construction continue telle quelle.
    document.querySelectorAll('.vp-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.vp-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const canvas = el('canvas');
        canvas.classList.remove('vp-desktop', 'vp-tablet', 'vp-mobile');
        canvas.classList.add('vp-' + btn.dataset.vp);
      });
    });

    renderCurrent();