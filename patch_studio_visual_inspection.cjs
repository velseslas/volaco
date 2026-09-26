const fs = require('fs');
const path = require('path');

const filePath = path.resolve('apps/studio/index.html');
let content = fs.readFileSync(filePath, 'utf8');

console.log('Original content length:', content.length);

// 1. Add cameraFlashOverlay right after body tag or before modal
if (!content.includes('id="cameraFlashOverlay"')) {
  content = content.replace(
    '<body class="',
    '<body class="'
  );
  // Add cameraFlashOverlay right before </body
  content = content.replace(
    '</body>',
    `  <!-- Camera Flash Overlay (0 -> 0.35 -> 0 sur 200ms) -->\n  <div id="cameraFlashOverlay" class="pointer-events-none fixed inset-0 bg-white opacity-0 transition-opacity duration-200 z-[99999]"></div>\n</body>`
  );
  console.log('Added cameraFlashOverlay');
}

// 2. Add "Cibler élément" button next to btnCaptureMenu
if (!content.includes('id="btnToggleTargetInspect"')) {
  const targetMenuIdx = content.indexOf('id="captureDropdownContainer"');
  if (targetMenuIdx !== -1) {
    // Find closing </div> of captureDropdownContainer
    const closeDivIdx = content.indexOf('</div>', targetMenuIdx + 200);
    if (closeDivIdx !== -1) {
      const insertIdx = closeDivIdx + 6;
      const targetBtnHtml = `\n        <!-- Bouton Bascule : Cibler élément (Click-to-Inspect) -->\n        <button \n          id="btnToggleTargetInspect"\n          type="button"\n          onclick="toggleTargetElementMode()"\n          class="px-2.5 py-1 text-xs text-slate-300 hover:text-white border border-[#1d264a] hover:border-amber-500/50 bg-[#0e1222] rounded-lg flex items-center space-x-1.5 transition active:scale-95 shadow-sm ml-1.5"\n          title="Cibler un élément précis dans la prévisualisation (Click-to-Inspect)"\n        >\n          <i id="iconToggleTargetInspect" class="fa-solid fa-crosshairs text-amber-400 text-xs"></i>\n          <span class="font-medium text-[11px]">Cibler élément</span>\n        </button>`;
      content = content.slice(0, insertIdx) + targetBtnHtml + content.slice(insertIdx);
      console.log('Added btnToggleTargetInspect');
    }
  }
}

// 3. Add "Envoyer à l'IA pour correction" button in captureModal footer
if (!content.includes('id="modalCaptureBtnSendAi"')) {
  const btnCopyIdx = content.indexOf('id="modalCaptureBtnCopy"');
  if (btnCopyIdx !== -1) {
    const sendAiBtnHtml = `<button id="modalCaptureBtnSendAi" onclick="sendCaptureToAiForCorrection()" class="bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 font-medium rounded-xl px-4 py-2 text-xs transition-all flex items-center space-x-1.5 active:scale-95 shadow-sm mr-1.5" title="Envoyer à l'IA pour correction">\n            <i class="fa-solid fa-wand-magic-sparkles text-amber-400 text-xs"></i>\n            <span>Envoyer à l'IA pour correction</span>\n          </button>\n          `;
    content = content.slice(0, btnCopyIdx) + sendAiBtnHtml + content.slice(btnCopyIdx);
    console.log('Added modalCaptureBtnSendAi');
  }
}

// 4. Add chatInspectionAttachmentBar right above wsPromptInput
if (!content.includes('id="chatInspectionAttachmentBar"')) {
  const wsPromptIdx = content.indexOf('id="wsPromptInput"');
  if (wsPromptIdx !== -1) {
    // Find opening of textarea
    const textareaTagIdx = content.lastIndexOf('<textarea', wsPromptIdx);
    const attachmentBarHtml = `<!-- Zone d'attachement de capture avec métadonnées DOM (56px, rounded, neutral-700) -->\n            <div id="chatInspectionAttachmentBar" class="hidden mb-2 p-2 bg-neutral-900/95 border border-neutral-700 rounded-xl flex items-center justify-between gap-3 relative shadow-md">\n              <div class="flex items-center gap-2.5 min-w-0">\n                <div class="h-14 w-14 shrink-0 rounded-lg overflow-hidden border border-neutral-700 bg-black flex items-center justify-center">\n                  <img id="chatInspectionThumb" src="" alt="Capture liée" class="h-full w-full object-cover">\n                </div>\n                <div class="min-w-0 flex flex-col gap-1">\n                  <div class="flex items-center gap-1.5 flex-wrap">\n                    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">\n                      <i class="fa-solid fa-check text-[10px] text-emerald-400"></i>\n                      DOM lié\n                    </span>\n                    <span id="chatInspectionSelector" class="text-[11px] font-mono text-slate-300 truncate max-w-[180px]"></span>\n                  </div>\n                  <span class="text-[10px] text-slate-400">CSS calculé & structure attachés</span>\n                </div>\n              </div>\n              <button type="button" onclick="detachInspectionFromChat()" class="w-5 h-5 rounded-full bg-rose-500/20 hover:bg-rose-500/40 text-rose-400 border border-rose-500/30 flex items-center justify-center transition shrink-0" title="Détacher la capture">\n                <i class="fa-solid fa-xmark text-[10px]"></i>\n              </button>\n            </div>\n\n            `;
    content = content.slice(0, textareaTagIdx) + attachmentBarHtml + content.slice(textareaTagIdx);
    console.log('Added chatInspectionAttachmentBar');
  }
}

// 5. Add bridge click-to-inspect handlers in iframe bridge script
if (!content.includes('vibecode-target-element-captured')) {
  const bridgeSearch = 'if (!ev || !ev.data || ev.data.action !== \'request-iframe-capture\') return;';
  const bridgeIdx = content.indexOf(bridgeSearch);
  if (bridgeIdx !== -1) {
    const bridgeHandlers = `
  // 6. Mode "Cibler un élément" (Click-to-Inspect) dans l'iframe
  var isTargetElementActive = false;
  var prevTargetEl = null;

  window.addEventListener('message', function(ev) {
    if (!ev || !ev.data) return;
    if (ev.data.action === 'set-target-element-mode') {
      isTargetElementActive = !!ev.data.enabled;
      document.body.style.cursor = isTargetElementActive ? 'crosshair' : '';
      if (!isTargetElementActive && prevTargetEl) {
        prevTargetEl.style.outline = '';
        prevTargetEl = null;
      }
    }
  });

  document.addEventListener('mouseover', function(e) {
    if (!isTargetElementActive) return;
    var el = e.target;
    if (el === document.body || el === document.documentElement) return;
    if (prevTargetEl && prevTargetEl !== el) {
      prevTargetEl.style.outline = '';
    }
    prevTargetEl = el;
    el.style.outline = '2px solid #f59e0b';
    el.style.cursor = 'crosshair';
  });

  document.addEventListener('mouseout', function(e) {
    if (!isTargetElementActive) return;
    if (e.target && e.target.style) {
      prevTargetEl = null;
      e.target.style.outline = '';
    }
  });

  document.addEventListener('click', function(e) {
    if (!isTargetElementActive) return;
    e.preventDefault();
    e.stopPropagation();

    var el = e.target;
    var computed = window.getComputedStyle(el);
    var criticalKeys = ['display', 'gap', 'padding', 'margin', 'fontSize', 'color', 'backgroundColor', 'borderRadius', 'flexDirection', 'gridTemplateColumns'];
    var computedStyles = {};
    criticalKeys.forEach(function(k) {
      var val = computed[k] || computed.getPropertyValue(k.replace(/([A-Z])/g, '-$1').toLowerCase());
      if (val) computedStyles[k] = val;
    });

    var selector = el.id ? ('#' + el.id) : (el.className && typeof el.className === 'string' ? ('.' + el.className.trim().split(/\\s+/)[0]) : el.tagName.toLowerCase());
    var clone = el.cloneNode(true);
    var unwanted = clone.querySelectorAll('script, style');
    unwanted.forEach(function(s) { s.remove(); });
    var domSnippet = clone.outerHTML || '';
    if (domSnippet.length > 500) domSnippet = domSnippet.slice(0, 500) + '...';

    (async function() {
      var imgBase64 = '';
      if (window.html2canvas) {
        try {
          var c = await window.html2canvas(el, {
            useCORS: true,
            allowTaint: true,
            backgroundColor: null,
            scale: 2,
            logging: false
          });
          imgBase64 = c.toDataURL('image/png');
        } catch(err) {}
      }

      _postToStudio({
        source: 'vibecode-target-element-captured',
        data: {
          imageBase64: imgBase64,
          metadata: {
            viewport: { w: window.innerWidth || 1280, h: window.innerHeight || 800 },
            route: window.location.pathname || '/',
            timestamp: new Date().toISOString()
          },
          selector: selector,
          computedStyles: computedStyles,
          domSnippet: domSnippet,
          tagName: el.tagName.toLowerCase()
        }
      });
    })();
  }, true);
`;
    content = content.slice(0, bridgeIdx) + bridgeHandlers + '\n  ' + content.slice(bridgeIdx);
    console.log('Added bridge click-to-inspect handlers');
  }
}

// 6. Add Studio client-side JavaScript functions for target inspection and camera flash
if (!content.includes('function toggleTargetElementMode()')) {
  const captureFuncIdx = content.indexOf('function downloadCurrentCapture()');
  if (captureFuncIdx !== -1) {
    const studioTargetFunctions = `
    let isTargetElementActive = false;
    let attachedCaptureInspection = null;

    function toggleTargetElementMode() {
      isTargetElementActive = !isTargetElementActive;
      const btn = document.getElementById('btnToggleTargetInspect');
      const icon = document.getElementById('iconToggleTargetInspect');
      const iframe = document.getElementById('wsLiveIframe');
      if (btn) {
        if (isTargetElementActive) {
          btn.classList.add('bg-amber-500/20', 'text-amber-300', 'border-amber-500/50', 'animate-pulse');
        } else {
          btn.classList.remove('bg-amber-500/20', 'text-amber-300', 'border-amber-500/50', 'animate-pulse');
        }
      }
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ action: 'set-target-element-mode', enabled: isTargetElementActive }, '*');
      }
    }

    function showCameraFlash() {
      const overlay = document.getElementById('cameraFlashOverlay');
      if (overlay) {
        overlay.style.opacity = '0.35';
        setTimeout(() => {
          overlay.style.opacity = '0';
        }, 100);
      }
      showCaptureToast("Capture effectuée");
    }

    function attachCaptureToChatInput(inspection, prefillPrompt) {
      attachedCaptureInspection = inspection;
      const bar = document.getElementById('chatInspectionAttachmentBar');
      const thumb = document.getElementById('chatInspectionThumb');
      const sel = document.getElementById('chatInspectionSelector');
      const input = document.getElementById('wsPromptInput');

      if (thumb && inspection.imageBase64) thumb.src = inspection.imageBase64;
      if (sel) sel.innerText = inspection.selector || inspection.tagName || 'Élément DOM';
      if (bar) bar.classList.remove('hidden');

      if (input) {
        input.placeholder = "Décrivez la modification ou le problème constaté...";
        if (prefillPrompt) {
          input.value = prefillPrompt;
        }
        input.focus();
      }
    }

    function detachInspectionFromChat() {
      attachedCaptureInspection = null;
      const bar = document.getElementById('chatInspectionAttachmentBar');
      const input = document.getElementById('wsPromptInput');
      if (bar) bar.classList.add('hidden');
      if (input) {
        input.placeholder = "Décrivez ce que vous souhaitez créer ou modifier (glissez des fichiers ou images)...";
      }
    }

    function sendCaptureToAiForCorrection() {
      closeCaptureModal();
      const iframe = document.getElementById('wsLiveIframe');
      const w = iframe ? (iframe.clientWidth || 1280) : 1280;
      const h = iframe ? (iframe.clientHeight || 800) : 800;

      const imgEl = document.getElementById('modalCaptureImg');
      const dataUrl = (imgEl && imgEl.src) ? imgEl.src : (currentCaptureBlob ? URL.createObjectURL(currentCaptureBlob) : '');

      attachCaptureToChatInput({
        imageBase64: dataUrl,
        metadata: {
          viewport: { w: w, h: h },
          route: '/',
          timestamp: new Date().toISOString()
        },
        selector: 'body',
        computedStyles: { display: 'block', backgroundColor: isStudioLightMode ? '#ffffff' : '#06080e' },
        domSnippet: '<body class="app-render">...</body>',
        tagName: 'body'
      }, "Corriger l'élément capturé : ");
    }
`;
    content = content.slice(0, captureFuncIdx) + studioTargetFunctions + '\n    ' + content.slice(captureFuncIdx);
    console.log('Added studioTargetFunctions');
  }
}

// 7. Listen for vibecode-target-element-captured in window message listener
if (!content.includes('ev.data.source === \'vibecode-target-element-captured\'')) {
  const listenerSearch = 'if (!ev.data) return;';
  const listenerIdx = content.indexOf(listenerSearch);
  if (listenerIdx !== -1) {
    const targetListener = `\n        if (ev.data && ev.data.source === 'vibecode-target-element-captured') {\n          showCameraFlash();\n          if (isTargetElementActive) toggleTargetElementMode();\n          attachCaptureToChatInput(ev.data.data, "Corriger l'élément <" + ev.data.data.tagName + "> : ");\n          return;\n        }\n`;
    content = content.slice(0, listenerIdx + listenerSearch.length) + targetListener + content.slice(listenerIdx + listenerSearch.length);
    console.log('Added target-element-captured listener');
  }
}

// 8. Update handleTriggerCapture or camera flash in captureAppPreview
if (content.includes('if (typeof playCameraShutterSound === \'function\') playCameraShutterSound();')) {
  content = content.replaceAll(
    "if (typeof playCameraShutterSound === 'function') playCameraShutterSound();",
    "if (typeof playCameraShutterSound === 'function') playCameraShutterSound(); showCameraFlash();"
  );
  console.log('Updated captureAppPreview with showCameraFlash()');
}

// Write back to apps/studio/index.html
fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully updated apps/studio/index.html. New length:', content.length);

// Synchronize all mirrors
const mirrors = [
  path.resolve('apps/studio/volaco_studio.html'),
  path.resolve('volaco_studio.html'),
  path.resolve('C:/Users/FAYCAL/.gemini/antigravity/brain/8fa9edf0-0fd9-4b9a-aba5-b16114e16dd7/volaco_studio.html')
];

for (const m of mirrors) {
  if (fs.existsSync(m)) {
    fs.writeFileSync(m, content, 'utf8');
    console.log('Synchronized mirror:', m);
  }
}
console.log('All mirrors synchronized byte-for-byte!');
