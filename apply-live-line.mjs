#!/usr/bin/env node
/**
 * apply-live-line.mjs (v5) — ligne de progression unique + synthèse de fin.
 *
 * Ce que ça change :
 *  - Studio : une seule ligne vivante ; un clic déplie un récapitulatif propre (fichier
 *    et sections modifiés) ; l'ancien fil brut est masqué ; synthèse de fin + suggestions.
 *  - Si la v2 est déjà appliquée, le script ne remplace que le bloc du Studio (mise à jour).
 *  - Serveur : la synthèse (2-3 phrases) et les 3 suggestions sont rédigées par l'IA
 *    à partir des faits réels, dans une frame « closing » envoyée après « done »
 *    (repli automatique sur les textes actuels si l'appel échoue).
 *
 * Usage (à la racine du projet, là où se trouve le dossier apps/) :
 *   node apply-live-line.mjs            applique (sauvegardes automatiques)
 *   node apply-live-line.mjs --check    vérifie seulement, n'écrit rien
 *   node apply-live-line.mjs --revert   restaure les sauvegardes
 * Puis : npm run build  et relancer le serveur.
 */
import fs from 'node:fs';
import path from 'node:path';

const STUDIO = path.resolve('apps/studio/index.html');
const CONV = path.resolve('apps/api/src/routes/conversation.ts');
const TEST = path.resolve('apps/api/tests/closing-synthesis.test.ts');
const BAK_DIR = path.resolve('.live-line-backup');
const bakOf = (p) => path.join(BAK_DIR, path.basename(p) + '.bak');
const mode = process.argv[2] || '';

function fail(msg) { console.error('✗ ' + msg); process.exit(1); }
function read(p) { const raw = fs.readFileSync(p, 'utf8'); return { crlf: raw.includes('\r\n'), src: raw.replace(/\r\n/g, '\n') }; }
function write(p, o) { fs.writeFileSync(p, o.crlf ? o.src.replace(/\n/g, '\r\n') : o.src, 'utf8'); }
function count(s, a) { return s.split(a).length - 1; }

for (const p of [STUDIO, CONV]) {
  if (!fs.existsSync(p)) fail('Fichier introuvable : ' + p + ' (lance la commande à la racine du projet).');
}

if (mode === '--revert') {
  let n = 0;
  for (const p of [STUDIO, CONV]) {
    if (fs.existsSync(bakOf(p))) { fs.copyFileSync(bakOf(p), p); n++; console.log('✓ restauré : ' + path.relative(process.cwd(), p)); }
  }
  if (fs.existsSync(TEST) && fs.readFileSync(TEST, 'utf8').includes('CLOTURE-LLM')) { fs.unlinkSync(TEST); console.log('✓ test retiré : ' + path.relative(process.cwd(), TEST)); }
  if (!n) fail('Aucune sauvegarde à restaurer.');
  process.exit(0);
}

const studio = read(STUDIO);
const conv = read(CONV);

const hasV5 = studio.src.includes('VIBE_LIVE_LINE v5');
const hasOld = /VIBE_LIVE_LINE v[2-4]/.test(studio.src);
if (hasV5) fail('La version 5 est déjà appliquée. Rien n\'a été changé.');
if (!hasOld && studio.src.includes('VIBE_LIVE_LINE')) fail('L\'ancienne version (v1) est appliquée : restaure d\'abord ton index.html d\'origine (sauvegarde de la v1 : apps/studio/index.html.bak-live-line), puis relance ce script.');

const BLOCK = String.raw`    /* ===== VIBE_LIVE_LINE v5 : ligne de progression unique + détails repliables + clôture + chat épuré + texte de l'IA =====
     * - Une seule ligne vivante (point qui pulse, texte qui brille, barre fine),
     *   alimentée par les mêmes activités que le fil détaillé.
     * - Un clic sur la ligne déplie un récapitulatif PROPRE (fichier + sections modifiées,
     sans doublons). L'ancien fil brut / accordéon technique reste masqué.
     * - À la fin : synthèse de quelques phrases + suggestions (événement « closing »).
     * Retour à l'ancien affichage :
     *   localStorage.setItem('vibe_live_line', '0') puis recharger.
     * Voir le fil détaillé pour déboguer :
     *   localStorage.setItem('vibe_live_line_details', '1') puis recharger. */
    function liveLineEnabled() {
      try { return localStorage.getItem('vibe_live_line') !== '0'; } catch (e) { return true; }
    }
    function liveLineDetailsMode() {
      try { return localStorage.getItem('vibe_live_line_details') === '1'; } catch (e) { return false; }
    }

    function vibeInjectLiveStyle() {
      if (document.getElementById('vibe-live-style')) return;
      const st = document.createElement('style');
      st.id = 'vibe-live-style';
      st.textContent = [
        '.vl-host:not(.vl-details) .build-trace-accordion{display:none}',
        '.vl-host:not(.vl-details):not(:has(.vl-card.vl-fail)) > div:first-child[class*="justify-between"]{display:none}',
        '.vl-host:not(.vl-details):has(.vl-card.vl-work) [id$="-status"],.vl-host:not(.vl-details):has(.vl-card.vl-done) [id$="-status"]{display:none}',
        '.vl-card{position:relative;overflow:hidden;border:0;background:rgba(255,255,255,.04);border-radius:12px;padding:9px 12px;margin:6px 0}',
        '.vl-row{display:flex;align-items:center;gap:10px;width:100%}',
        '.vl-dot{flex:none;width:9px;height:9px;border-radius:50%;background:#a78bfa;animation:vl-pulse 1.4s infinite}',
        '.vl-done .vl-dot{background:#4ade80;animation:none}',
        '.vl-fail .vl-dot{background:#fb7185;animation:none}',
        '.vl-wait .vl-dot{background:#fbbf24;animation:none}',
        '@keyframes vl-pulse{0%{box-shadow:0 0 0 0 rgba(167,139,250,.55)}70%{box-shadow:0 0 0 8px rgba(167,139,250,0)}100%{box-shadow:0 0 0 0 rgba(167,139,250,0)}}',
        '.vl-txt{flex:1;min-width:0;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.vl-txt b{font-weight:600}',
        '.vl-card:not(.vl-work) .vl-d{opacity:.75}',
        '.vl-swap{animation:vl-swap .3s ease both}',
        '@keyframes vl-swap{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}',
        '.vl-work .vl-shim{background:linear-gradient(90deg,rgba(148,163,184,.95) 0%,rgba(148,163,184,.95) 35%,#a78bfa 50%,rgba(148,163,184,.95) 65%,rgba(148,163,184,.95) 100%);background-size:220% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent;animation:vl-shim 2s linear infinite}',
        '@keyframes vl-shim{from{background-position:120% 0}to{background-position:-120% 0}}',
        '.vl-work::after{content:"";position:absolute;left:0;bottom:0;height:2px;width:35%;background:linear-gradient(90deg,transparent,#a78bfa,transparent);animation:vl-sweep 1.6s ease-in-out infinite}',
        '@keyframes vl-sweep{from{transform:translateX(-100%)}to{transform:translateX(300%)}}',
        '.vl-meta{flex:none;font-size:11px;opacity:.65;font-variant-numeric:tabular-nums}',
        '.vl-row{cursor:pointer;background:none;border:0;color:inherit;font:inherit;padding:0;text-align:left}',
        '.vl-chev{flex:none;opacity:.6;font-size:10px;transition:transform .2s}',
        '.vl-open .vl-chev{transform:rotate(180deg)}',
        '.vl-panel{display:none;margin-top:10px;padding-top:10px;border-top:1px solid rgba(148,163,184,.22);font-size:12px}',
        '.vl-open .vl-panel{display:block}',
        '.vl-file{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:600;margin-bottom:6px}',
        '.vl-file span{font-family:inherit;font-weight:400;opacity:.7}',
        '.vl-secs{list-style:none;margin:0;padding:0}',
        '.vl-secs li{display:flex;gap:8px;align-items:baseline;padding:3px 0}',
        '.vl-secs i{font-style:normal;width:12px;flex:none;color:#4ade80}',
        '.vl-secs li.vl-run i{color:#a78bfa}',
        '.vl-secs li.vl-bad i{color:#fb7185}',
        '.vl-sn{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
        '.vl-sa{opacity:.7}',
        '.vl-sd{margin-left:auto;font-variant-numeric:tabular-nums;opacity:.85}',
        '.vl-add{color:#4ade80}.vl-rem{color:#fb7185}',
        '.vl-links{display:flex;gap:14px;margin-top:8px}',
        '.vl-link{background:none;border:0;color:#c4b5fd;cursor:pointer;text-decoration:underline;font:inherit;padding:0}',
        '.vl-say{font-size:13px;line-height:1.65;color:#e2e8f0;margin:4px 0 8px;white-space:pre-wrap}',
        '.vl-closing-txt{font-size:13px;line-height:1.65;margin-top:12px;color:#cbd5e1}',
        '.vl-chips{display:flex;flex-direction:column;gap:2px;margin-top:10px}',
        '.vl-chip{display:flex;align-items:center;gap:10px;width:100%;background:none;border:0;text-align:left;color:#c4b5fd;font:inherit;font-size:13px;padding:7px 8px;border-radius:8px;cursor:pointer;transition:background .15s,color .15s}',
        '.vl-chip::before{content:"↳";color:#7c6bd6}',
        '.vl-chip:hover{background:rgba(167,139,250,.11);color:#ede9fe}',
        '@media (prefers-reduced-motion:reduce){.vl-dot,.vl-swap,.vl-work::after{animation:none}.vl-work .vl-shim{animation:none;background:none;color:inherit;-webkit-text-fill-color:currentColor}}'
      ].join('\n');
      document.head.appendChild(st);
    }

    /** Synthèse de fin (quelques phrases) + suggestions cliquables. */
    function vibeRenderClosing(host, ev) {
      if (!host || !ev) return;
      vibeInjectLiveStyle();
      const old = host.querySelector('.vl-closing');
      if (old) old.remove();
      const box = document.createElement('div');
      box.className = 'vl-closing';
      if (ev.closingMessage) {
        const p = document.createElement('div');
        p.className = 'vl-closing-txt';
        p.textContent = String(ev.closingMessage);
        box.appendChild(p);
      }
      const sugg = Array.isArray(ev.suggestions) ? ev.suggestions.filter(function (s) { return typeof s === 'string' && s.trim(); }) : [];
      if (sugg.length) {
        const row = document.createElement('div');
        row.className = 'vl-chips';
        sugg.slice(0, 3).forEach(function (s) {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'vl-chip';
          chip.textContent = s;
          chip.addEventListener('click', function () {
            const input = document.getElementById('wsPromptInput');
            if (input) { input.value = s; input.focus(); }
            try { handleWorkspacePromptSubmit({ preventDefault: function () {} }); } catch (e) { /* envoi manuel possible */ }
          });
          row.appendChild(chip);
        });
        box.appendChild(row);
      }
      host.appendChild(box);
    }

    function createLiveLine(container, feedRoot) {
      vibeInjectLiveStyle();
      const detailsMode = liveLineDetailsMode();
      const host = container.parentNode;
      if (!host) return null;
      host.classList.add('vl-host');
      if (detailsMode) host.classList.add('vl-details');

      const el = document.createElement('div');
      el.setAttribute('role', 'status');
      const row = document.createElement('button'); row.type = 'button'; row.className = 'vl-row';
      row.style.cssText = 'display:flex;align-items:center;gap:10px;width:100%';
      row.setAttribute('aria-expanded', 'false');
      row.setAttribute('aria-label', 'Afficher le détail des modifications');
      const dot = document.createElement('span'); dot.className = 'vl-dot';
      const txt = document.createElement('span'); txt.className = 'vl-txt';
      const meta = document.createElement('span'); meta.className = 'vl-meta';
      const chev = document.createElement('span'); chev.className = 'vl-chev'; chev.textContent = '\u25BE';
      row.appendChild(dot); row.appendChild(txt); row.appendChild(meta); row.appendChild(chev);
      el.appendChild(row);
      const panel = document.createElement('div'); panel.className = 'vl-panel';
      el.appendChild(panel);

      let isOpen = false;
      let state = 'vl-work';
      function paint() { el.className = 'vl-card ' + state + (isOpen ? ' vl-open' : ''); }
      paint();
      row.addEventListener('click', function () {
        isOpen = !isOpen;
        row.setAttribute('aria-expanded', String(isOpen));
        paint();
      });
      host.insertBefore(el, container);
      if (!detailsMode) feedRoot.classList.add('hidden');

      const STEP_ACTIONS = { read: 1, create: 1, modify: 1, delete: 1, validate: 1, repair: 1, retry: 1 };
      const seenKeys = new Set();
      const files = new Set();
      const secs_ = new Map();
      let fileName = 'index.html';
      let t0 = 0, steps = 0, added = 0, removed = 0, score = null, finished = false, timer = null;

      function verbOf(action) {
        const map = (typeof ACTIVITY_VERBS !== 'undefined') ? ACTIVITY_VERBS : {};
        return map[action] || action || 'Travail';
      }
      function secs() { return Math.max(1, Math.round((Date.now() - t0) / 1000)); }
      function say(verb, detail) {
        txt.textContent = '';
        const shim = document.createElement('span'); shim.className = 'vl-shim';
        const b = document.createElement('b'); b.textContent = verb;
        shim.appendChild(b);
        if (detail) {
          const d = document.createElement('span'); d.className = 'vl-d'; d.textContent = ' ' + detail;
          shim.appendChild(d);
        }
        txt.appendChild(shim);
        txt.classList.remove('vl-swap');
        void txt.offsetWidth;
        txt.classList.add('vl-swap');
      }
      function tickMeta() {
        if (!el.isConnected) { clearInterval(timer); return; }
        if (finished || !t0) return;
        meta.textContent = (steps ? steps + ' étape' + (steps > 1 ? 's' : '') + ' · ' : '') + secs() + ' s';
      }
      function summary() {
        const parts = [];
        if (steps) parts.push(steps + ' étape' + (steps > 1 ? 's' : ''));
        if (files.size) parts.push(files.size + ' section' + (files.size > 1 ? 's' : ''));
        if (added || removed) parts.push('+' + added + ' \u2212' + removed + ' lignes');
        if (score !== null) parts.push('Gate ' + score + '/100');
        parts.push(secs() + ' s');
        return parts.join(' · ');
      }
      function finish(action, a) {
        finished = true;
        clearInterval(timer);
        meta.textContent = '';
        if (action === 'complete') { state = 'vl-done'; say('Terminé', summary()); }
        else if (action === 'fail') { state = 'vl-fail'; say('Échec', String(a.error || a.title || '').slice(0, 120)); }
        else { state = ''; say('Annulé', summary()); }
        renderPanel();
        paint();
      }
      /** Texte écrit par l'IA (phrase d'ouverture ou réponse à une question), rendu visible
       *  hors de l'accordéon technique. Gelé dès que la première section démarre. */
      let sayEl = null, sayText = '', sayFrozen = false;
      function sayIntro(text) {
        if (text === null) { sayFrozen = true; return; }
        if (sayFrozen) return;
        sayText += String(text);
        const clean = sayText.trim();
        if (!clean) return;
        if (!sayEl) {
          sayEl = document.createElement('div');
          sayEl.className = 'vl-say vl-swap';
          host.insertBefore(sayEl, el);
        }
        sayEl.textContent = clean;
      }

      const ACT_LABEL = { modify: 'modifiée', create: 'créée', delete: 'supprimée' };
      function renderPanel() {
        panel.textContent = '';
        if (!secs_.size && score === null) return;
        const head = document.createElement('div'); head.className = 'vl-file';
        head.textContent = fileName + ' ';
        const sub = document.createElement('span');
        sub.textContent = '· ' + secs_.size + ' section' + (secs_.size > 1 ? 's' : '') + (added || removed ? ' · +' + added + ' \u2212' + removed : '');
        head.appendChild(sub);
        panel.appendChild(head);
        const ul = document.createElement('ul'); ul.className = 'vl-secs';
        secs_.forEach(function (s, name) {
          const li = document.createElement('li');
          li.className = s.status === 'running' ? 'vl-run' : (s.status === 'failed' ? 'vl-bad' : '');
          const ic = document.createElement('i'); ic.textContent = s.status === 'running' ? '\u25CF' : (s.status === 'failed' ? '\u2717' : '\u2713');
          const sn = document.createElement('span'); sn.className = 'vl-sn'; sn.textContent = name;
          const sa = document.createElement('span'); sa.className = 'vl-sa';
          sa.textContent = s.status === 'failed' ? 'non appliquée' : (s.status === 'running' ? 'en cours…' : (ACT_LABEL[s.action] || s.action));
          li.appendChild(ic); li.appendChild(sn); li.appendChild(sa);
          if (s.added || s.removed) {
            const sd = document.createElement('span'); sd.className = 'vl-sd';
            const ad = document.createElement('span'); ad.className = 'vl-add'; ad.textContent = '+' + (s.added || 0);
            const rm = document.createElement('span'); rm.className = 'vl-rem'; rm.textContent = ' \u2212' + (s.removed || 0);
            sd.appendChild(ad); sd.appendChild(rm); li.appendChild(sd);
          }
          ul.appendChild(li);
        });
        if (score !== null) {
          const li = document.createElement('li');
          const ic = document.createElement('i'); ic.textContent = '\u2713';
          const sn = document.createElement('span'); sn.textContent = 'Vérification du rendu';
          const sd = document.createElement('span'); sd.className = 'vl-sd'; sd.textContent = 'Gate ' + score + '/100';
          li.appendChild(ic); li.appendChild(sn); li.appendChild(sd); ul.appendChild(li);
        }
        panel.appendChild(ul);
        const links = document.createElement('div'); links.className = 'vl-links';
        function link(label, fn) {
          const bt = document.createElement('button'); bt.type = 'button'; bt.className = 'vl-link'; bt.textContent = label;
          bt.addEventListener('click', function (ev) { ev.stopPropagation(); try { fn(); } catch (e) { /* indisponible */ } });
          links.appendChild(bt);
        }
        if (typeof requestWorkspaceSubTab === 'function' && typeof selectCodeFile === 'function') {
          link("Ouvrir l'éditeur", function () { requestWorkspaceSubTab('code'); selectCodeFile(fileName); });
        }
        if (typeof openTextDiffModal === 'function') {
          link('Voir le diff', function () { openTextDiffModal(window._preGenerationHtml || '', (typeof currentAppHtml !== 'undefined' ? currentAppHtml : '') || ''); });
        }
        if (links.childNodes.length) panel.appendChild(links);
      }
      function detailOf(a, verb) {
        let where = a.file ? String(a.file) : ((a.action !== 'phase' && a.action !== 'plan' && a.title) ? String(a.title) : '');
        if (where.toLowerCase().indexOf(verb.toLowerCase()) === 0) {
          where = where.slice(verb.length).replace(/^[\s:\u2013-]+/, '');
        }
        return where;
      }

      function update(list) {
        for (const a of (list || [])) {
          if (!a || !a.id || finished) continue;
          const key = a.id + ':' + a.status;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          if (!t0) { t0 = Date.now(); timer = setInterval(tickMeta, 1000); }
          const act = a.action, status = a.status;

          if (act === 'read' && a.file && /\.[a-z0-9]+$/i.test(String(a.file))) fileName = String(a.file);
          if (act === 'diff') {
            const nm = a.file ? String(a.file) : '';
            if (a.metadata) {
              added += Number(a.metadata.addedLines) || 0;
              removed += Number(a.metadata.removedLines) || 0;
            }
            if (nm) {
              const cur = secs_.get(nm) || { action: 'modify', status: 'done', added: 0, removed: 0 };
              if (a.metadata) { cur.added = Number(a.metadata.addedLines) || 0; cur.removed = Number(a.metadata.removedLines) || 0; }
              if (status === 'FAILED') cur.status = 'failed';
              secs_.set(nm, cur);
            }
            continue;
          }
          if (a.file && (act === 'modify' || act === 'create' || act === 'delete')) {
            const nm2 = String(a.file);
            const cur2 = secs_.get(nm2) || { action: act, status: 'running', added: 0, removed: 0 };
            cur2.action = act;
            if (status === 'RUNNING') cur2.status = 'running';
            else if (status === 'COMPLETED') cur2.status = (cur2.status === 'failed') ? 'failed' : 'done';
            else if (status === 'FAILED') cur2.status = 'failed';
            secs_.set(nm2, cur2);
          }
          if (act === 'validate' && a.metadata && typeof a.metadata.score === 'number') score = a.metadata.score;
          if (act === 'complete' || act === 'fail' || act === 'cancel') { finish(act, a); continue; }

          const verb = verbOf(act);
          if (status === 'WAITING_USER') {
            state = 'vl-wait'; paint(); say(verb, detailOf(a, verb) || 'confirmation requise');
            continue;
          }
          if (act === 'phase' || act === 'plan' || act === 'summary') continue;

          if (status === 'RUNNING') {
            state = 'vl-work'; paint(); say(verb, detailOf(a, verb));
          } else if (status === 'FAILED') {
            say(verb, detailOf(a, verb) || String(a.error || '').slice(0, 80));
          } else if (status === 'COMPLETED' && STEP_ACTIONS[act]) {
            steps++;
            if (a.file && (act === 'modify' || act === 'create' || act === 'delete')) files.add(String(a.file));
          }
        }
        renderPanel();
        tickMeta();
      }

      /** Fin pilotée par le flux (le serveur n'envoie pas « Terminé » en direct). */
      function finishFromStream(type, ev) {
        if (finished) return;
        if (type === 'done') {
          if (ev && ev.updated === false && !secs_.size && score === null) { finished = true; clearInterval(timer); el.style.display = 'none'; return; }
          if (!t0) t0 = Date.now();
          finish('complete', {});
        } else if (type === 'error') {
          if (!t0) t0 = Date.now();
          finish('fail', { error: (ev && (ev.message || ev.error)) || 'Une erreur est survenue' });
        } else if (type === 'cancelled') {
          if (!t0) t0 = Date.now();
          finish('cancel', {});
        }
      }

      return { update: update, finishFromStream: finishFromStream, sayIntro: sayIntro };
    }

`;
const HEAD_BLOCK = String.raw`<script id="vibe-chat-epure-flag">try{if(localStorage.getItem('vibe_live_line')==='0')document.documentElement.classList.add('vl-off')}catch(e){}</script>
<style id="vibe-chat-epure">
/* VIBE_CHAT_EPURE — conversation épurée (désactivable : localStorage vibe_live_line = 0) */
html:not(.vl-off) #chatPanel{border-color:rgba(148,163,184,.14)!important}
html:not(.vl-off) #wsChatHistory{padding:20px 18px!important}
html:not(.vl-off) #wsChatHistory>*+*{margin-top:22px!important}
html:not(.vl-off) #wsChatHistory>div[class*="border-l-2"]{border:0!important;width:fit-content;max-width:86%;margin-left:auto!important;padding:9px 13px!important;background:rgba(167,139,250,.13);border-radius:16px 16px 4px 16px;color:#f1f5f9}
html:not(.vl-off) #chatPanel form[onsubmit*="handleWorkspacePromptSubmit"]{background:rgba(255,255,255,.03)!important;border-color:rgba(148,163,184,.2)!important;border-radius:16px!important}
html:not(.vl-off) #chatPanel form[onsubmit*="handleWorkspacePromptSubmit"]:focus-within{border-color:#a78bfa!important}
html:not(.vl-off) #chatPanel form[onsubmit*="handleWorkspacePromptSubmit"] textarea{font-size:13px!important}
html:not(.vl-off) #chatPanel form[onsubmit*="handleWorkspacePromptSubmit"] div[class*="text-[9px]"]{opacity:0;font-size:10.5px!important;transition:opacity .2s}
html:not(.vl-off) #chatPanel form[onsubmit*="handleWorkspacePromptSubmit"]:focus-within div[class*="text-[9px]"]{opacity:1}
html:not(.vl-off) #chatPanel form button:has(>i.fa-sparkles),html:not(.vl-off) #chatPanel form button:has(>i.fa-microphone){display:none}
html:not(.vl-off) #chatPanel form #btnInspectorWand i{color:#94a3b8!important}
html:not(.vl-off) #chatPanel form button[type="submit"]{background:#a78bfa!important;box-shadow:none!important;width:30px!important;height:30px!important}
html:not(.vl-off) #chatPanel form button[type="submit"]:hover{background:#c4b5fd!important}
</style>
`;
const TS_HELPER = String.raw`/**
 * CLOTURE-LLM — synthèse de fin rédigée (2 à 3 phrases) + suggestions
 * contextuelles. Un seul appel court, émis APRÈS la frame « done » (le preview
 * n'attend pas). Toute erreur (timeout, JSON invalide, fournisseur absent)
 * retourne null : le texte déterministe reste alors affiché.
 */
export interface ClosingFacts {
  request: string;
  mode: 'create' | 'modify';
  sections: Array<{ name: string; mode: string }>;
  gateScore: number | null;
  findings: string[];
}

const CLOSING_SYSTEM_PROMPT =
  "Tu es le Lead Engineer IA de VibeCode Studio. Tu viens de terminer un travail sur le site de l'utilisateur et tu lui parles en français, avec un ton chaleureux et concret.\n" +
  'Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte autour : {"summary": "...", "suggestions": ["...", "...", "..."]}\n' +
  "- summary : 2 à 3 phrases. Dis ce que tu as fait et ce que ça change pour le site. Si les constats de qualité révèlent un vrai point faible, signale-le honnêtement en une phrase. N'écris AUCUN chiffre (sections, lignes, score) : ils sont déjà affichés ailleurs.\n" +
  "- suggestions : exactement 3 actions courtes (3 à 7 mots), à l'impératif, spécifiques à CE site et à CETTE demande, que tu peux exécuter immédiatement. Aucun doublon avec ce qui vient d'être fait.";

export function buildClosingUserPrompt(facts: ClosingFacts): string {
  const lines: string[] = [];
  lines.push("Demande de l'utilisateur : « " + facts.request.replace(/\s+/g, ' ').trim().slice(0, 400) + ' »');
  lines.push('Travail effectué : ' + (facts.mode === 'modify' ? "modification d'un site existant" : "création d'un nouveau site"));
  if (facts.sections.length) {
    lines.push('Sections touchées : ' + facts.sections.map((s) => s.name + ' (' + s.mode + ')').join(', '));
  }
  if (facts.gateScore !== null) lines.push('Contrôle qualité du rendu : ' + facts.gateScore + '/100');
  if (facts.findings.length) lines.push('Constats : ' + facts.findings.join(' ; '));
  return lines.join('\n');
}

export function parseClosingJson(raw: string): { summary: string; suggestions: string[] } | null {
  if (typeof raw !== 'string') return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const rec = data as Record<string, unknown>;
  const summary = typeof rec['summary'] === 'string' ? (rec['summary'] as string).replace(/\s+/g, ' ').trim() : '';
  if (summary.length < 20 || summary.length > 700) return null;
  const seen = new Set<string>();
  const suggestions: string[] = [];
  const rawList = rec['suggestions'];
  if (Array.isArray(rawList)) {
    for (const item of rawList) {
      if (typeof item !== 'string') continue;
      const s = item.replace(/\s+/g, ' ').trim();
      if (s.length < 3 || s.length > 70 || seen.has(s.toLowerCase())) continue;
      seen.add(s.toLowerCase());
      suggestions.push(s);
      if (suggestions.length === 3) break;
    }
  }
  return { summary, suggestions };
}

export async function generateClosing(
  ask: (systemPrompt: string, userPrompt: string) => Promise<string>,
  facts: ClosingFacts,
  timeoutMs = 8000
): Promise<{ summary: string; suggestions: string[] } | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([
      ask(CLOSING_SYSTEM_PROMPT, buildClosingUserPrompt(facts)),
      new Promise<string>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('closing timeout')), timeoutMs);
      })
    ]);
    return parseClosingJson(raw);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

`;
const TS_FLOW = String.raw`
      // CLOTURE-LLM — synthèse rédigée + suggestions contextuelles, en frame
      // séparée après « done » (repli : textes déterministes ci-dessus).
      if (!clientGone && !cancelFlag.cancelled) {
        let closingText = closingMessage;
        let closingChips = quickSuggestions;
        const llmClosing = await generateClosing(
          (closingSystem, closingUser) => adapter.generate(
            {
              tenantId: context.tenantId,
              projectId,
              prompt: closingUser,
              systemPrompt: closingSystem,
              temperature: 0.4,
              maxTokens: 400,
              timeoutMs: 8000,
              requestId
            },
            aiProviderRegistry.getTenantCredentials(context.tenantId, adapter.descriptor.providerId)
          ).then((r) => r.text),
          {
            request: body.message || '',
            mode: isModificationMode ? 'modify' : 'create',
            sections: serverSections.map((s) => ({ name: s.name, mode: s.mode })),
            gateScore: gateResult ? gateResult.score : null,
            findings: gateResult ? gateResult.findings.slice(0, 3).map((f) => f.title) : []
          }
        );
        if (llmClosing) {
          closingText = llmClosing.summary;
          if (llmClosing.suggestions.length >= 2) closingChips = llmClosing.suggestions;
        }
        emit({
          type: 'closing',
          closingMessage: closingText,
          suggestions: closingChips,
          source: llmClosing ? 'llm' : 'fallback'
        });
      }
`;
const TEST_SRC = String.raw`/**
 * CLOTURE-LLM — synthèse de fin rédigée + suggestions contextuelles.
 *
 * 1. parseClosingJson : JSON valide, JSON entouré de texte, JSON invalide,
 *    résumé trop court, suggestions dédoublonnées et bornées à 3.
 * 2. generateClosing : succès, erreur du fournisseur, timeout → null.
 * 3. Flux /stream de bout en bout (Mistral simulé) : la frame « closing »
 *    arrive APRÈS « done » ; avec JSON valide → source « llm » ; sinon
 *    repli déterministe → source « fallback ».
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { parseClosingJson, generateClosing, buildClosingUserPrompt } from '../src/routes/conversation.js';

process.env.MISTRAL_API_KEY = 'test-key-closing';

const FENCE = String.fromCharCode(96).repeat(3);
const FACTS = { request: 'Passe le bouton en bleu', mode: 'modify' as const, sections: [{ name: 'hero', mode: 'modify' }], gateScore: 88, findings: ['Contraste faible sur le titre'] };

describe('CLOTURE-LLM — parseClosingJson', () => {
  it('accepte un JSON valide', () => {
    const r = parseClosingJson('{"summary":"Le bouton principal est maintenant bleu et cohérent avec ta palette.","suggestions":["Ajouter un effet au survol","Changer la police du titre","Améliorer le mobile"]}');
    assert.ok(r);
    assert.equal(r!.suggestions.length, 3);
  });
  it('accepte un JSON entouré de texte ou de clôtures', () => {
    const r = parseClosingJson('Voici :\n' + FENCE + 'json\n{"summary":"Ton site a maintenant une section avis clients claire.","suggestions":["Ajouter une FAQ","Ajouter un formulaire"]}\n' + FENCE);
    assert.ok(r);
    assert.equal(r!.suggestions.length, 2);
  });
  it('refuse un JSON invalide, un résumé trop court ou absent', () => {
    assert.equal(parseClosingJson('pas du json'), null);
    assert.equal(parseClosingJson('{"summary":"ok","suggestions":[]}'), null);
    assert.equal(parseClosingJson('{"suggestions":["a b c"]}'), null);
    assert.equal(parseClosingJson('{"summary":42}'), null);
  });
  it('dédoublonne, ignore les valeurs invalides et borne à 3', () => {
    const r = parseClosingJson('{"summary":"Une synthèse suffisamment longue pour être acceptée.","suggestions":["Ajouter une FAQ","ajouter une faq",42,"x","Changer la palette","Ajouter un blog","Une quatrième idée"]}');
    assert.deepEqual(r!.suggestions, ['Ajouter une FAQ', 'Changer la palette', 'Ajouter un blog']);
  });
});

describe('CLOTURE-LLM — generateClosing', () => {
  it('retourne la synthèse quand le fournisseur répond', async () => {
    const r = await generateClosing(async () => '{"summary":"Le bouton est bleu et le reste de la page est intact.","suggestions":["Ajouter un survol","Changer le pied de page"]}', FACTS);
    assert.ok(r);
  });
  it('retourne null si le fournisseur échoue', async () => {
    assert.equal(await generateClosing(async () => { throw new Error('HTTP 500'); }, FACTS), null);
  });
  it('retourne null au timeout (sans bloquer)', async () => {
    const t0 = Date.now();
    const r = await generateClosing(() => new Promise<string>(() => { /* ne répond jamais */ }), FACTS, 50);
    assert.equal(r, null);
    assert.ok(Date.now() - t0 < 1000);
  });
  it('le prompt contient les faits réels (demande, sections, constats)', () => {
    const p = buildClosingUserPrompt(FACTS);
    assert.match(p, /bouton en bleu/);
    assert.match(p, /hero \(modify\)/);
    assert.match(p, /Contraste faible/);
  });
});

describe('CLOTURE-LLM — flux /stream de bout en bout', () => {
  let server: Server;
  let baseUrl: string;
  let closingJson = '';
  const realFetch = globalThis.fetch;
  const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'closing-t1', 'x-user-role': 'OWNER' };
  const SSE = 'data: {"choices":[{"delta":{"content":"<SECTION name=\\"hero\\" mode=\\"create\\"><h1>Salut</h1></SECTION>"}}]}\n\n' + 'data: [DONE]\n\n';

  before(async () => {
    globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
      let wantsStream = true;
      try { wantsStream = JSON.parse(String(init?.body ?? '{}')).stream === true; } catch { /* défaut : flux */ }
      if (wantsStream) return new Response(SSE, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: closingJson } }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => { server.listen(0, () => { baseUrl = 'http://127.0.0.1:' + (server.address() as AddressInfo).port; resolve(); }); });
  });
  after(async () => {
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
  });

  async function run(message: string): Promise<{ types: string[]; closing: Record<string, unknown> | null; done: Record<string, unknown> | null }> {
    const p = await realFetch(baseUrl + '/api/v1/projects', { method: 'POST', headers: H, body: JSON.stringify({ name: 'closing' }) });
    const pj = (await p.json()) as { project: { id: string } };
    const s = await realFetch(baseUrl + '/api/v1/projects/' + pj.project.id + '/conversation/sessions', { method: 'POST', headers: H, body: '{}' });
    const sj = (await s.json()) as { session: { sessionId: string } };
    const res = await realFetch(baseUrl + '/api/v1/projects/' + pj.project.id + '/conversation/sessions/' + sj.session.sessionId + '/stream', { method: 'POST', headers: { ...H, Accept: 'text/event-stream' }, body: JSON.stringify({ message }) });
    const out = { types: [] as string[], closing: null as Record<string, unknown> | null, done: null as Record<string, unknown> | null };
    const text = await res.text();
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      try {
        const ev = JSON.parse(line.slice(5).trim()) as { type: string };
        out.types.push(ev.type);
        if (ev.type === 'closing') out.closing = ev as unknown as Record<string, unknown>;
        if (ev.type === 'done') out.done = ev as unknown as Record<string, unknown>;
      } catch { /* ignore */ }
    }
    return out;
  }

  it('JSON valide → closing source « llm », émise après done', async () => {
    closingJson = '{"summary":"J\'ai posé un en-tête de bienvenue clair, il donne le ton dès l\'arrivée sur la page.","suggestions":["Ajouter un bouton principal","Choisir une palette chaude","Ajouter une section avis"]}';
    const out = await run('Crée une page de bienvenue');
    assert.ok(out.done && out.closing, 'done et closing reçus');
    assert.equal(out.done!['closingPending'], true);
    assert.ok(out.types.indexOf('closing') > out.types.indexOf('done'), 'closing après done');
    assert.equal(out.closing!['source'], 'llm');
    assert.match(String(out.closing!['closingMessage']), /en-tête de bienvenue/);
    assert.deepEqual(out.closing!['suggestions'], ['Ajouter un bouton principal', 'Choisir une palette chaude', 'Ajouter une section avis']);
  });

  it('réponse invalide du fournisseur → closing source « fallback » (textes déterministes)', async () => {
    closingJson = 'désolé, pas de JSON ici';
    const out = await run('Crée une page de bienvenue');
    assert.ok(out.closing);
    assert.equal(out.closing!['source'], 'fallback');
    assert.match(String(out.closing!['closingMessage']), /C'est en place/);
    assert.equal((out.closing!['suggestions'] as string[]).length, 3);
  });
});
`;

function insertHead(src) {
  if (src.includes('id="vibe-chat-epure"')) return src;
  const i = src.indexOf('</head>');
  const bodyAt = src.indexOf('<body');
  if (i < 0 || bodyAt < i) fail('Repère </head> introuvable en début de fichier : RIEN n\'a été modifié.');
  return src.slice(0, i) + HEAD_BLOCK + src.slice(i);
}

// --- Repères Studio -------------------------------------------------------
const S_A1 = '    /**\n     * Fabrique un conteneur ActivityStream dans un message.';
const S_A2 = '      container.appendChild(root);\n      const seen = new Set();';
const S_A3 = '        // Le dernier item running reste visible (scroll léger du conteneur)';
const S_A4 = '(function renderClosingAndChips() {\n                      const host = document.getElementById(msgId);\n                      if (!host) return;';
const S_A5 = '} else if (event.type === \'diff\') {';
const S_A6 = '      return { root, append };';
const S_A7 = 'if (event.activity && activityFeed) activityFeed.append([event.activity]);';
// --- Repères serveur ------------------------------------------------------
const C_B1 = 'export async function handleConversationRoutes(';
const C_B2 = '        closingMessage,\n        suggestions: quickSuggestions,\n';
const C_B3 = '        ...(gateResult ? { gate: gateResult } : {})\n      });\n    } catch (err) {\n      const message = err instanceof Error ? err.message : String(err);';
const OLD_A6 = '      return { root, append, finishLive: live ? live.finishFromStream : null };';
const NEW_A6 = '      return { root, append, finishLive: live ? live.finishFromStream : null, say: live ? live.sayIntro : null };';
const FINISH_HOOK = "if (activityFeed && activityFeed.finishLive && (event.type === 'done' || event.type === 'error' || event.type === 'cancelled')) { try { activityFeed.finishLive(event.type, event); } catch (e) {} }";
const SAY_HOOK = "if (event.type === 'chat' && event.text && !event.scripted && activityFeed && activityFeed.say) { try { activityFeed.say(event.text); } catch (e) {} }\n              if (event.type === 'section_start' && activityFeed && activityFeed.say) { try { activityFeed.say(null); } catch (e) {} }";
// Phrases écrites en dur par le serveur : marquées « scripted » pour ne pas les afficher comme texte de l'IA.
const SCRIPTED = [
  ["emit({ type: 'chat', text: `Je modifie ta page en gardant le reste intact : ${plan.steps.length} étape(s). Je m'y mets tout de suite !` });",
   "emit({ type: 'chat', text: `Je modifie ta page en gardant le reste intact : ${plan.steps.length} étape(s). Je m'y mets tout de suite !`, scripted: true });"],
  ["emit({ type: 'chat', text: `Voici mon plan : ${plan.steps.length} étapes. Je construis ça sous tes yeux, section par section !` });",
   "emit({ type: 'chat', text: `Voici mon plan : ${plan.steps.length} étapes. Je construis ça sous tes yeux, section par section !`, scripted: true });"],
  ["emit({ type: 'chat', text: 'Je vérifie le rendu réel…' });",
   "emit({ type: 'chat', text: 'Je vérifie le rendu réel…', scripted: true });"]
];

// --- Mise à jour v2/v3/v4 → v5 : bloc du Studio + hooks + drapeaux « scripted » du serveur --
if (hasOld) {
  const m = /    \/\* ===== VIBE_LIVE_LINE v[2-4]/.exec(studio.src);
  const a = m ? m.index : -1;
  const b = studio.src.indexOf(S_A1);
  if (a < 0 || b < 0 || a > b || count(studio.src, S_A1) !== 1) fail('Mise à jour impossible : le bloc précédent n\'a pas été retrouvé tel quel. RIEN n\'a été modifié.');
  let upgraded = studio.src.slice(0, a) + BLOCK + studio.src.slice(b);
  upgraded = insertHead(upgraded);
  if (!upgraded.includes('activityFeed.say(')) {
    if (count(upgraded, OLD_A6) !== 1 || count(upgraded, FINISH_HOOK) !== 1) fail('Mise à jour impossible : les raccords de la version précédente sont introuvables. RIEN n\'a été modifié.');
    upgraded = upgraded.replace(OLD_A6, () => NEW_A6).replace(FINISH_HOOK, () => FINISH_HOOK + '\n              ' + SAY_HOOK);
  }
  let upConv = conv.src;
  let convChanged = false;
  for (const [o, n] of SCRIPTED) {
    if (upConv.includes(n)) continue;
    if (count(upConv, o) !== 1) fail('Mise à jour impossible : phrase serveur introuvable dans conversation.ts. RIEN n\'a été modifié.');
    upConv = upConv.replace(o, () => n);
    convChanged = true;
  }
  if (mode === '--check') { console.log('✓ Mise à jour vers la v5 possible' + (convChanged ? ' (Studio + serveur : npm run build nécessaire).' : ' (Studio uniquement).')); process.exit(0); }
  fs.mkdirSync(BAK_DIR, { recursive: true });
  fs.copyFileSync(STUDIO, path.join(BAK_DIR, 'index.html.prev.bak'));
  studio.src = upgraded;
  write(STUDIO, studio);
  if (convChanged) { fs.copyFileSync(CONV, path.join(BAK_DIR, 'conversation.ts.prev.bak')); conv.src = upConv; write(CONV, conv); }
  console.log('✓ Studio mis à jour (v5) : le texte de l\'IA (ouverture, réponses aux questions) est visible.');
  if (convChanged) {
    console.log('✓ Serveur mis à jour : conversation.ts');
    console.log('  IMPORTANT : lance maintenant  npm run build  puis redémarre le serveur.');
  } else {
    console.log('  Pas de rebuild nécessaire : recharge simplement le Studio avec Ctrl+F5.');
  }
  console.log('  Sauvegardes de la version précédente : .live-line-backup/*.prev.bak');
  process.exit(0);
}

const checks = [['Studio A1', studio.src, S_A1], ['Studio A2', studio.src, S_A2], ['Studio A3', studio.src, S_A3], ['Studio A4', studio.src, S_A4], ['Studio A5', studio.src, S_A5], ['Studio A6', studio.src, S_A6], ['Studio A7', studio.src, S_A7],
                ['Serveur B1', conv.src, C_B1], ['Serveur B2', conv.src, C_B2], ['Serveur B3', conv.src, C_B3],
                ...SCRIPTED.map((p, i) => ['Serveur C' + (i + 1), conv.src, p[0]])];
for (const [name, text, a] of checks) {
  const n = count(text, a);
  if (n !== 1) fail('Repère « ' + name + ' » : ' + n + ' occurrence(s) au lieu d\'une seule. Tes fichiers ne correspondent pas au zip 7 : RIEN n\'a été modifié.');
}
if (fs.existsSync(TEST)) fail('Le fichier ' + path.relative(process.cwd(), TEST) + ' existe déjà : rien n\'a été modifié.');

// --- Studio ---------------------------------------------------------------
let s = studio.src;
s = s.replace(S_A1, () => BLOCK + S_A1);
s = s.replace(S_A2, () =>
  '      container.appendChild(root);\n' +
  '      let live = null;\n' +
  '      try { if (liveLineEnabled()) live = createLiveLine(container, root); } catch (e) { live = null; root.classList.remove(\'hidden\'); }\n' +
  '      const seen = new Set();');
s = s.replace(S_A3, () => '        if (live) { try { live.update(activities); } catch (e) {} }\n' + S_A3);
s = s.replace(S_A4, () => S_A4 + '\n                      if (event.closingPending) return;');
s = s.replace(S_A5, () =>
  '} else if (event.type === \'closing\') {\n' +
  '                vibeRenderClosing(document.getElementById(msgId), event);\n' +
  '              } else if (event.type === \'diff\') {');
s = s.replace(S_A6, () => NEW_A6);
s = s.replace(S_A7, () => S_A7 + '\n              ' + FINISH_HOOK + '\n              ' + SAY_HOOK);
s = insertHead(s);
studio.src = s;

// --- Serveur --------------------------------------------------------------
let c = conv.src;
c = c.replace(C_B1, () => TS_HELPER + C_B1);
c = c.replace(C_B2, () => '        closingPending: true,\n' + C_B2);
c = c.replace(C_B3, () =>
  '        ...(gateResult ? { gate: gateResult } : {})\n      });\n' + TS_FLOW + '    } catch (err) {\n      const message = err instanceof Error ? err.message : String(err);');
for (const [o, n] of SCRIPTED) c = c.replace(o, () => n);
conv.src = c;

if (mode === '--check') { console.log('✓ Les 13 repères sont présents : la modification peut être appliquée.'); process.exit(0); }

fs.mkdirSync(BAK_DIR, { recursive: true });
fs.copyFileSync(STUDIO, bakOf(STUDIO));
fs.copyFileSync(CONV, bakOf(CONV));
write(STUDIO, studio);
write(CONV, conv);
fs.writeFileSync(TEST, TEST_SRC, 'utf8');
console.log('✓ Studio modifié       : apps/studio/index.html');
console.log('✓ Serveur modifié      : apps/api/src/routes/conversation.ts');
console.log('✓ Test ajouté          : apps/api/tests/closing-synthesis.test.ts');
console.log('  Sauvegardes            : dossier .live-line-backup/ (à supprimer quand tout est validé)');
console.log('  Retour arrière         : node apply-live-line.mjs --revert');
console.log('  IMPORTANT : lance maintenant  npm run build  puis redémarre le serveur.');
console.log('  Désactiver côté navigateur : localStorage.setItem(\'vibe_live_line\',\'0\') puis recharger.');
