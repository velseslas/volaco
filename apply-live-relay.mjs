#!/usr/bin/env node
/**
 * apply-live-relay.mjs — UNE seule génération, relayée en direct vers la preview.
 *
 * Avant : un message lançait 3 générations (le chat + 2 dans la preview) : coût et temps
 * triplés, et la preview montrait une autre création que le résultat sauvegardé.
 * Après : le chat est la seule source. Il relaie ses événements à la preview :
 *   - CRÉATION     : blocs construits comme avant + éléments affichés un par un
 *                    À MESURE que l'IA les écrit ;
 *   - MODIFICATION : la preview se recale sur la page sauvegardée à la fin ;
 *   - QUESTION     : la preview ne bouge pas.
 *
 * Usage (à la racine du projet, là où se trouve le dossier apps/) :
 *   node apply-live-relay.mjs            applique (sauvegardes automatiques)
 *   node apply-live-relay.mjs --check    vérifie seulement, n'écrit rien
 *   node apply-live-relay.mjs --revert   restaure les sauvegardes
 * Pas de build : recharge simplement le Studio avec Ctrl+F5.
 */
import fs from 'node:fs';
import path from 'node:path';

const STUDIO = path.resolve('apps/studio/index.html');
const BUILDER = path.resolve('apps/studio/preview-builder-app.js');
const BAK_DIR = path.resolve('.relay-backup');
const bakOf = (p) => path.join(BAK_DIR, path.basename(p) + '.bak');
const MARK = 'VIBE_LIVE_RELAY';
const mode = process.argv[2] || '';

function fail(msg) { console.error('✗ ' + msg); process.exit(1); }
function read(p) { const raw = fs.readFileSync(p, 'utf8'); return { crlf: raw.includes('\r\n'), src: raw.replace(/\r\n/g, '\n') }; }
function write(p, o) { fs.writeFileSync(p, o.crlf ? o.src.replace(/\n/g, '\r\n') : o.src, 'utf8'); }
function count(s, a) { return s.split(a).length - 1; }

for (const p of [STUDIO, BUILDER]) {
  if (!fs.existsSync(p)) fail('Fichier introuvable : ' + p + ' (lance la commande à la racine du projet).');
}

if (mode === '--revert') {
  let n = 0;
  for (const p of [STUDIO, BUILDER]) {
    if (fs.existsSync(bakOf(p))) { fs.copyFileSync(bakOf(p), p); n++; console.log('✓ restauré : ' + path.relative(process.cwd(), p)); }
  }
  if (!n) fail('Aucune sauvegarde à restaurer.');
  process.exit(0);
}

const studio = read(STUDIO);
const builder = read(BUILDER);
if (builder.src.includes(MARK)) fail('Le relais en direct est déjà appliqué. Rien n\'a été changé.');

const BLOCK = String.raw`    /* ===== VIBE_LIVE_RELAY v1 : UNE seule génération, relayée en direct =====
     * Le chat (Studio) est la seule source : il relaie ses événements à la preview.
     *  - CRÉATION : les blocs se construisent comme avant (COMPONENT_*), et le texte
     *    brut du modèle est affiché ÉLÉMENT PAR ÉLÉMENT à mesure qu'il est écrit.
     *  - MODIFICATION : la preview se recale sur la page sauvegardée à la fin.
     *  - QUESTION : la preview ne bouge pas.
     * La preview ne lance plus ses propres générations (avant : 3 générations par message).
     * Retour au comportement précédent : node apply-live-relay.mjs --revert */
    const relayState = { begun: false, isMod: false, projectId: null, secName: null, secBuf: '', timer: 0, born: {} };
    const RELAY_TARGETS = 'h1,h2,h3,h4,h5,h6,p,a,button,img,picture,svg,li,input,textarea,select,blockquote,figure,video,table,hr,label';
    const RELAY_ANIM_MS = 460;

    function relayInjectStyle() {
      if (document.getElementById('vibe-relay-style')) return;
      const st = document.createElement('style');
      st.id = 'vibe-relay-style';
      st.textContent = [
        '[data-vibe-live] > div[class*="pvz-"]:not(.pvz-live):not(.pvz-real){display:none}',
        '[data-vibe-live] .pvz-real{animation:none!important}',
        '.pvz-live{display:block;width:100%}',
        '.pvz-live-in{animation:pvzLiveIn ' + RELAY_ANIM_MS + 'ms cubic-bezier(.22,.9,.34,1) both}',
        '@keyframes pvzLiveIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}',
        '@media (prefers-reduced-motion:reduce){.pvz-live-in{animation:none}}'
      ].join('\n');
      document.head.appendChild(st);
    }

    function relayFeed(rawEvent) {
      const r = normalizeGenerationEvent(rawEvent);
      (r.events || []).forEach(function (e) { consume(e); });
    }

    function relayBegin() {
      relayState.begun = true;
      exitAppBundle();
      if (realSource) { realSource.stop(); realSource = null; }
      state = createPreviewBuildState();
      lastFocusId = null;
      selectedComponentId = null;
      if (relayState.projectId) currentProjectId = relayState.projectId;
      renderCurrent();
      relayFeed({ type: 'start' });
    }

    /** HTML en cours d'écriture : jetons reçus entre section_start et section_end
     *  (le serveur retire lui-même les balises SECTION du flux de texte). */
    function relayCurrentPartial() {
      if (!relayState.secName) return null;
      const rest = relayState.secBuf;
      const k = rest.search(/<[a-zA-Z]/);
      if (k < 0) return { name: relayState.secName, html: '' };
      return { name: relayState.secName, html: rest.slice(k).replace(/<[^>]*$/, '') };
    }

    function relayPaintLive() {
      relayState.timer = 0;
      const part = relayCurrentPartial();
      if (!part || !part.html) return;
      const sel = '[data-pv-id="' + ((window.CSS && CSS.escape) ? CSS.escape(part.name) : part.name) + '"][data-pv-status="building"]';
      const node = document.querySelector(sel);
      if (!node) return;
      relayInjectStyle();
      node.setAttribute('data-vibe-live', '1');
      let box = node.querySelector(':scope > .pvz-live');
      if (!box) { box = document.createElement('div'); box.className = 'pvz-live'; node.appendChild(box); }
      const doc = new DOMParser().parseFromString('<body>' + part.html + '</body>', 'text/html');
      doc.querySelectorAll('script,iframe,object,embed').forEach(function (n) { n.remove(); });
      doc.body.querySelectorAll('*').forEach(function (n) {
        Array.from(n.attributes).forEach(function (a) { if (/^on/i.test(a.name)) n.removeAttribute(a.name); });
      });
      const all = Array.from(doc.body.querySelectorAll(RELAY_TARGETS));
      const tops = all.filter(function (e) { return !all.some(function (o) { return o !== e && o.contains(e); }); });
      const born = relayState.born[part.name] || (relayState.born[part.name] = []);
      const now = Date.now();
      tops.forEach(function (e, i) {
        if (born[i] === undefined) born[i] = now;
        const age = now - born[i];
        if (age < RELAY_ANIM_MS) { e.classList.add('pvz-live-in'); e.style.animationDelay = (-age) + 'ms'; }
      });
      box.innerHTML = doc.body.innerHTML;
    }

    function relayToken(ev) {
      const chunk = typeof ev.token === 'string' ? ev.token : '';
      if (!chunk) return;
      if (!relayState.secName) return;
      relayState.secBuf += chunk;
      if (relayState.secBuf.length > 200000) relayState.secBuf = relayState.secBuf.slice(-100000);
      if (!relayState.begun || relayState.isMod || relayState.timer) return;
      relayState.timer = setTimeout(relayPaintLive, 90);
    }

    async function relayReloadSaved() {
      try {
        const pid = relayState.projectId;
        if (!pid) return;
        currentProjectId = pid;
        const fres = await fetch('/api/v1/projects/' + pid + '/files/content?path=index.html', { headers: H });
        if (!fres.ok) return;
        const fdata = await fres.json();
        const content = fdata && fdata.file ? fdata.file.content : null;
        if (typeof content !== 'string' || content.length === 0) return;
        exitAppBundle();
        lastFocusId = null;
        selectedComponentId = null;
        rebuildCanvasFromHtml(content);
      } catch (e) {
        // serveur indisponible : la preview garde son état
      }
    }

    function handleRelayedEvent(d) {
      const ev = d && d.event;
      if (!ev || typeof ev !== 'object') return;
      if (typeof d.projectId === 'string') relayState.projectId = d.projectId;
      switch (ev.type) {
        case 'start':
          relayState.begun = false;
          relayState.isMod = d.isModification === true;
          relayState.secName = null;
          relayState.secBuf = '';
          relayState.born = {};
          return;
        case 'token':
          relayToken(ev);
          return;
        case 'section_start':
          if (relayState.isMod) return;
          if (!relayState.begun) relayBegin();
          relayState.secName = ev.name;
          relayState.secBuf = '';
          relayFeed(ev);
          return;
        case 'section_end':
          if (relayState.isMod || !relayState.begun) return;
          relayState.secName = null;
          relayState.secBuf = '';
          delete relayState.born[ev.name];
          relayFeed(ev);
          return;
        case 'done':
          if (relayState.isMod) { if (ev.updated !== false && ev.awaitingConfirmation !== true) relayReloadSaved(); return; }
          if (relayState.begun) relayFeed(ev);
          return;
        case 'error':
        case 'cancelled':
          if (relayState.begun && !relayState.isMod) relayFeed(ev);
          return;
        default:
          return;
      }
    }

`;

// --- Studio (index.html) ---------------------------------------------------
const S1 = "builderFrame.contentWindow.postMessage({ source: 'vibecode-studio', command: 'start-builder-generation', prompt: String(text || '') }, window.location.origin);";
const S1_NEW = "builderFrame.contentWindow.postMessage({ source: 'vibecode-studio', command: 'start-builder-generation', relay: true, prompt: String(text || '') }, window.location.origin);";
const S2 = 'if (event.activity && activityFeed) activityFeed.append([event.activity]);';
const S2_NEW = S2 + "\n              // VIBE_LIVE_RELAY — le chat relaie ses événements à la preview (une seule génération).\n" +
  "              if (window.__previewMode === 'builder') { try { const bf = document.getElementById('wsLiveIframe'); if (bf && bf.contentWindow) bf.contentWindow.postMessage({ source: 'vibecode-studio', command: 'studio-stream-event', event: event, projectId: serverProjectId, isModification: isModification === true }, window.location.origin); } catch (e) { /* preview indisponible */ } }";

// --- Builder (preview-builder-app.js) --------------------------------------
const B1 = "import { MockBuildEventSource, SSEBuildEventSource } from '/preview-builder/adapter.js';";
const B1_NEW = "import { MockBuildEventSource, SSEBuildEventSource, normalizeGenerationEvent } from '/preview-builder/adapter.js';";
const B2 = "      promptInput.value = d.prompt;\n      realBtn.click();\n    });\n\n    document.addEventListener('pointercancel', () => {\n      dragCtx = null;";
const B2_NEW = "      if (d.relay === true) return; // VIBE_LIVE_RELAY : le chat est la seule source de génération\n" + B2;
const B3 =
  "    window.addEventListener('message', (ev) => {\n" +
  "      if (ev.origin !== location.origin) return;\n" +
  "      const d = ev.data || {};\n" +
  "      if (d.source !== 'vibecode-studio' || d.command !== 'start-builder-generation') return;\n" +
  "      const promptInput = document.getElementById('v2Prompt');\n" +
  "      const realBtn = document.getElementById('btnReal');\n" +
  "      if (!promptInput || !realBtn || typeof d.prompt !== 'string' || !d.prompt.trim()) return;\n" +
  "      promptInput.value = d.prompt;\n" +
  "      realBtn.click();\n" +
  "    });\n" +
  "\n" +
  "    document.addEventListener('pointercancel', () => {\n" +
  "      if (!resizeCtx) return;";
const B3_NEW =
  "    // VIBE_LIVE_RELAY — ce second écouteur lançait une DEUXIÈME génération : il reçoit désormais\n" +
  "    // les événements relayés par le chat (même nombre d'écouteurs qu'avant).\n" +
  "    window.addEventListener('message', (ev) => {\n" +
  "      if (ev.origin !== location.origin) return;\n" +
  "      const d = ev.data || {};\n" +
  "      if (d.source !== 'vibecode-studio' || d.command !== 'studio-stream-event') return;\n" +
  "      handleRelayedEvent(d);\n" +
  "    });\n" +
  "\n" +
  "    document.addEventListener('pointercancel', () => {\n" +
  "      if (!resizeCtx) return;";
const B4 = '    async function startRealGeneration() {';
const REVEAL_OLD = 'if (real) reveal(real);';
const REVEAL_NEW = "if (real && !node.hasAttribute('data-vibe-live')) reveal(real);";

const checks = [['Studio S1', studio.src, S1], ['Studio S2', studio.src, S2],
                ['Builder B1', builder.src, B1], ['Builder B2', builder.src, B2], ['Builder B3', builder.src, B3], ['Builder B4', builder.src, B4]];
for (const [name, text, a] of checks) {
  const n = count(text, a);
  if (n !== 1) fail('Repère « ' + name + ' » : ' + n + ' occurrence(s) au lieu d\'une seule. Tes fichiers ne correspondent pas à ceux attendus : RIEN n\'a été modifié.');
}

let s = studio.src;
s = s.replace(S1, () => S1_NEW);
s = s.replace(S2, () => S2_NEW);
studio.src = s;

let b = builder.src;
b = b.replace(B1, () => B1_NEW);
b = b.replace(B2, () => B2_NEW);
b = b.replace(B3, () => B3_NEW);
b = b.replace(B4, () => BLOCK + B4);
const hadReveal = b.includes('VIBE_ELEMENT_REVEAL') && count(b, REVEAL_OLD) === 1;
if (hadReveal) b = b.replace(REVEAL_OLD, () => REVEAL_NEW);
builder.src = b;

if (mode === '--check') { console.log('✓ Les 6 repères sont présents : le relais en direct peut être appliqué.'); process.exit(0); }

fs.mkdirSync(BAK_DIR, { recursive: true });
fs.copyFileSync(STUDIO, bakOf(STUDIO));
fs.copyFileSync(BUILDER, bakOf(BUILDER));
write(STUDIO, studio);
write(BUILDER, builder);
console.log('✓ Studio modifié  : apps/studio/index.html');
console.log('✓ Preview modifiée : apps/studio/preview-builder-app.js' + (hadReveal ? ' (compatible avec apply-reveal)' : ''));
console.log('  Sauvegardes     : dossier .relay-backup/ (à supprimer quand tout est validé)');
console.log('  Retour arrière  : node apply-live-relay.mjs --revert');
console.log('  Pas de build nécessaire : recharge le Studio avec Ctrl+F5.');
