#!/usr/bin/env node
/**
 * apply-reveal.mjs — construction de la preview ÉLÉMENT PAR ÉLÉMENT (polish).
 *
 * Quand un bloc de la preview passe de « building » à « completed », ses éléments
 * (titres, textes, boutons, images, liens…) apparaissent un par un, avec un léger
 * décalage, au lieu du bloc entier d'un coup. Aucun changement du moteur, du state
 * ni du rendu : un observateur autonome ajouté au Builder, désactivable.
 *
 * Usage (à la racine du projet, là où se trouve le dossier apps/) :
 *   node apply-reveal.mjs            applique (sauvegarde automatique)
 *   node apply-reveal.mjs --check    vérifie seulement, n'écrit rien
 *   node apply-reveal.mjs --revert   restaure la sauvegarde
 * Pas de build : recharge simplement le Studio avec Ctrl+F5.
 */
import fs from 'node:fs';
import path from 'node:path';

const TARGET = path.resolve('apps/studio/preview-builder-app.js');
const BAK_DIR = path.resolve('.reveal-backup');
const BAK = path.join(BAK_DIR, 'preview-builder-app.js.bak');
const MARK = 'VIBE_ELEMENT_REVEAL';
const mode = process.argv[2] || '';

function fail(msg) { console.error('✗ ' + msg); process.exit(1); }
if (!fs.existsSync(TARGET)) fail('Fichier introuvable : ' + TARGET + ' (lance la commande à la racine du projet).');

if (mode === '--revert') {
  if (!fs.existsSync(BAK)) fail('Aucune sauvegarde à restaurer : ' + BAK);
  fs.copyFileSync(BAK, TARGET);
  console.log('✓ preview-builder-app.js restauré depuis la sauvegarde.');
  process.exit(0);
}

const raw = fs.readFileSync(TARGET, 'utf8');
const crlf = raw.includes('\r\n');
let src = raw.replace(/\r\n/g, '\n');

if (src.includes(MARK)) fail('La construction élément par élément est déjà appliquée. Rien n\'a été changé.');

const BLOCK = String.raw`    /* ===== VIBE_ELEMENT_REVEAL v1 : construction élément par élément =====
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

`;
const ANCHOR = '    let state = createPreviewBuildState();\n    let lastFocusId = null;\n    let timer = null;\n';
const n = src.split(ANCHOR).length - 1;
if (n !== 1) fail('Repère introuvable (' + n + ' occurrence(s) au lieu d\'une). Ton preview-builder-app.js ne correspond pas à celui attendu : RIEN n\'a été modifié.');

src = src.replace(ANCHOR, () => ANCHOR + '\n' + BLOCK);

if (mode === '--check') { console.log('✓ Le repère est présent : la construction élément par élément peut être appliquée.'); process.exit(0); }

fs.mkdirSync(BAK_DIR, { recursive: true });
fs.copyFileSync(TARGET, BAK);
fs.writeFileSync(TARGET, crlf ? src.replace(/\n/g, '\r\n') : src, 'utf8');
console.log('✓ Construction élément par élément ajoutée : apps/studio/preview-builder-app.js');
console.log('  Sauvegarde      : .reveal-backup/preview-builder-app.js.bak');
console.log('  Retour arrière  : node apply-reveal.mjs --revert');
console.log('  Désactiver sans rien toucher : localStorage.setItem(\'vibe_reveal\',\'0\') dans la console du navigateur, puis recharger.');
console.log('  Pas de build nécessaire : recharge le Studio avec Ctrl+F5.');
