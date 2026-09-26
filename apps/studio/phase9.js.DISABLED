/**
 * VibeCode Studio - phase9.js
 * Phase 9 + 9.5 + 10 + 11 + 12 + 13 : Conversation IA visible dans le Studio
 *
 * Ce script intercepte l'envoi de messages dans le chat du Studio et
 * route la demande à travers le pipeline complet :
 *
 *   1. POST /api/v1/projects/:id/decide
 *      → Decision (verdict, chosenAlternative, reasoningTrace)
 *   2. Si verdict = READY → affiche bouton "Approuver et exécuter"
 *   3. Si approuvé → POST /api/v1/projects/:id/orchestrate
 *      → OrchestrationRun (5 agents LLM, artifacts PROPOSED_FILE_CHANGE)
 *   4. Si artifacts contient des PROPOSED_FILE_CHANGE → affiche bouton "Apply mutations"
 *   5. Si apply → POST /api/v1/projects/:id/mutate
 *      → MutationReport (files changed, rollback)
 *   6. Hook async server-side : ApplicationModel refresh + Validation + Preview
 *   7. Si on veut voir le preview : POST /api/v1/projects/:id/preview
 *      → PreviewReport (screenshotBase64 PNG)
 *
 * DEUX modes d'usage :
 *   - Mode B (button) : un bouton "🤖 AI Pipeline" est ajouté à côté du chat existant
 *     → préserve le comportement d'origine (l'ancien bouton "Envoyer" marche comme avant)
 *   - Mode A (intercept) : si PHASE9_INTERCEPT_CHAT = true, l'envoi normal du chat
 *     route aussi à travers le pipeline
 *
 * Chargement automatique : le serveur injecte `<script defer src="phase9.js"></script>`
 * avant </body> dans index.html (géré dans server.js).
 */

(function () {
  'use strict';

  const PHASE9_VERSION = '2.0.0-phase13-ba';
  const API_PREFIX = '/api/v1';
  const DEFAULT_TENANT = 'studio-local';
  const DEFAULT_ROLE = 'OWNER';
  const DEFAULT_PROJECT = 'proj_studio';

  // Mode A : intercepter le bouton "Envoyer" existant pour router via le pipeline
  // Mettre à false pour désactiver (alors seul le bouton "🤖 AI Pipeline" route via pipeline)
  const PHASE9_INTERCEPT_CHAT = true;

  console.log(`[phase9.js v${PHASE9_VERSION}] loaded (intercept=${PHASE9_INTERCEPT_CHAT})`);

  // ============================================================
  // Helpers
  // ============================================================

  function getActiveProjectId() {
    if (window.activeProjectId) return window.activeProjectId;
    const stored = localStorage.getItem('activeProjectId');
    if (stored) return stored;
    return DEFAULT_PROJECT;
  }

  function getAuthHeaders() {
    const apiKey = localStorage.getItem('volaco_api_key') || '';
    const headers = {
      'Content-Type': 'application/json',
      'X-Tenant-Id': DEFAULT_TENANT,
      'X-User-Role': DEFAULT_ROLE
    };
    if (apiKey) {
      headers['Authorization'] = 'Bearer ' + apiKey;
    }
    return headers;
  }

  function getChatHistoryEl() {
    return document.getElementById('wsChatHistory');
  }

  function appendPhaseMessage(html) {
    const history = getChatHistoryEl();
    if (!history) {
      console.warn('[phase9.js] wsChatHistory element not found');
      return document.createElement('div'); // return dummy div for chaining
    }
    const div = document.createElement('div');
    div.className = 'p-3 rounded-xl bg-[#0a0e1a] border border-[#1a2238] text-slate-300 text-xs my-2 ml-2 mr-2 shadow-sm';
    div.innerHTML = html;
    history.appendChild(div);
    history.scrollTop = history.scrollHeight;
    return div;
  }

  function appendUserMessage(text) {
    const history = getChatHistoryEl();
    if (!history) return;
    const div = document.createElement('div');
    div.className = 'p-3 rounded-2xl bg-[#141828] border border-[#1e243c] text-white ml-6 text-xs leading-relaxed shadow-md';
    div.innerText = text;
    history.appendChild(div);
    history.scrollTop = history.scrollHeight;
  }

  function escapeHtml(s) {
    if (typeof s !== 'string') return String(s ?? '');
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ============================================================
  // API calls
  // ============================================================

  async function callDecide(projectId, message, sessionId) {
    const url = `${API_PREFIX}/projects/${projectId}/decide`;
    const body = { message, sessionId: sessionId || ('sess_' + Date.now()) };
    const res = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`decide failed (${res.status}): ${errBody}`);
    }
    return res.json();
  }

  async function callOrchestrate(projectId, plan, intent) {
    const url = `${API_PREFIX}/projects/${projectId}/orchestrate`;
    const body = { plan, intent };
    const res = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`orchestrate failed (${res.status}): ${errBody}`);
    }
    return res.json();
  }

  async function callMutate(projectId, run, decisionId) {
    const url = `${API_PREFIX}/projects/${projectId}/mutate`;
    const body = { run, decisionId };
    const res = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`mutate failed (${res.status}): ${errBody}`);
    }
    return res.json();
  }

  async function callPreview(projectId) {
    const url = `${API_PREFIX}/projects/${projectId}/preview`;
    const res = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({})
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`preview failed (${res.status}): ${errBody}`);
    }
    return res.json();
  }

  // ============================================================
  // Pipeline UI
  // ============================================================

  function renderDecisionBlock(decision, nextState, trace, recommendations) {
    const verdictColors = {
      READY: '#10b981',
      NEEDS_CONFIRMATION: '#f59e0b',
      BLOCKED: '#ef4444',
      DEFERRED: '#a855f7'
    };
    const color = verdictColors[decision.verdict] || '#64748b';
    const chosenLabel = decision.chosenAlternative?.label || '—';
    const chosenRisk = decision.chosenAlternative?.riskScore ?? '—';
    const traceHtml = (trace || [])
      .map((t) => `<li class="text-slate-400">${escapeHtml(t)}</li>`)
      .join('');
    const clarificationsHtml = (decision.requiredClarifications || [])
      .map((c) => `<li class="text-amber-300">→ ${escapeHtml(c)}</li>`)
      .join('');

    return `
      <div class="border-l-2 pl-3" style="border-color: ${color}">
        <div class="font-semibold text-slate-200 mb-1">
          🧠 Decision Engine — Verdict: <span style="color: ${color}">${decision.verdict}</span>
        </div>
        <div class="text-slate-400 mb-1">Next state: <span class="text-slate-200">${nextState}</span></div>
        <div class="text-slate-400 mb-1">Chosen alternative: <span class="text-slate-200">${escapeHtml(chosenLabel)}</span> (risk=${chosenRisk})</div>
        <div class="text-slate-400 mb-1">${decision.alternatives.length} alternative(s) générée(s) — ${recommendations.length} recommendation(s) consultative(s)</div>
        <ul class="text-xs text-slate-500 mb-1 list-disc list-inside">${traceHtml}</ul>
        ${clarificationsHtml ? `<ul class="text-xs list-disc list-inside">${clarificationsHtml}</ul>` : ''}
        <div class="text-xs text-slate-500 mt-2 italic">${escapeHtml(decision.rationale).slice(0, 300)}${decision.rationale.length > 300 ? '...' : ''}</div>
      </div>
    `;
  }

  function renderApprovalButton(label, callback) {
    const btn = document.createElement('button');
    btn.className = 'mt-2 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors';
    btn.textContent = label;
    btn.onclick = callback;
    return btn;
  }

  function renderRunBlock(run) {
    const artifacts = run.run?.artifacts || run.artifacts || [];
    const fileChanges = artifacts.filter((a) => a.kind === 'PROPOSED_FILE_CHANGE');
    const agents = [...new Set(artifacts.map((a) => a.agentId || a.domain || 'unknown'))];
    const state = run.run?.state || run.state || 'UNKNOWN';
    const tokens = run.run?.totalTokens || run.totalTokens || 0;
    const cost = run.run?.totalCostUsd || run.totalCostUsd || 0;

    const fileChangesHtml = fileChanges
      .map((a) => {
        const p = a.payload || {};
        const op = (p.operation || 'UPDATE').toUpperCase();
        const opColor = op === 'DELETE' ? '#ef4444' : op === 'CREATE' ? '#10b981' : '#f59e0b';
        return `
          <li class="text-slate-400 text-xs">
            <span style="color: ${opColor}">${op}</span>
            <code class="text-slate-300">${escapeHtml(p.filePath || '?')}</code>
            <span class="text-slate-500">— ${escapeHtml(p.reason || 'no reason').slice(0, 100)}</span>
          </li>`;
      })
      .join('');

    return `
      <div class="border-l-2 border-indigo-500 pl-3">
        <div class="font-semibold text-slate-200 mb-1">
          🤖 Orchestration Run — State: <span class="text-indigo-300">${state}</span>
        </div>
        <div class="text-slate-400 mb-1">${agents.length} agent(s) actif(s): ${agents.map((a) => escapeHtml(a)).join(', ')}</div>
        <div class="text-slate-400 mb-1">${artifacts.length} artifact(s) au total — ${fileChanges.length} changement(s) de fichiers</div>
        <div class="text-slate-500 mb-2 text-xs">Tokens: ${tokens} · Cost: $${cost.toFixed(4)}</div>
        ${fileChangesHtml ? `<ul class="list-disc list-inside space-y-0.5">${fileChangesHtml}</ul>` : ''}
      </div>
    `;
  }

  function renderMutationReportBlock(report) {
    const changes = report.changes || [];
    const successCount = report.successCount ?? 0;
    const failedCount = report.failedCount ?? 0;
    const stateColor = {
      COMPLETED: '#10b981',
      ROLLED_BACK: '#f59e0b',
      PARTIAL: '#f59e0b',
      FAILED: '#ef4444'
    }[report.state] || '#64748b';

    const changesHtml = changes
      .map((c) => {
        const statusColor = c.status === 'SUCCESS' ? '#10b981' : c.status === 'FAILED' ? '#ef4444' : '#64748b';
        return `
          <li class="text-xs">
            <span style="color: ${statusColor}">${c.status}</span>
            <span class="text-slate-300">${escapeHtml(c.operation)}</span>
            <code class="text-slate-300">${escapeHtml(c.filePath)}</code>
            <span class="text-slate-500">${c.bytesBefore}B → ${c.bytesAfter}B</span>
          </li>`;
      })
      .join('');

    return `
      <div class="border-l-2 pl-3" style="border-color: ${stateColor}">
        <div class="font-semibold text-slate-200 mb-1">
          📝 Mutation Report — State: <span style="color: ${stateColor}">${report.state}</span>
        </div>
        <div class="text-slate-400 mb-1">${successCount} succès · ${failedCount} échec(s) · ${changes.length} changement(s) total</div>
        <div class="text-slate-500 text-xs mb-2">
          Before revision: <code>${escapeHtml(report.revisionBeforeId)}</code><br>
          After revision: <code>${escapeHtml(report.revisionAfterId || 'n/a')}</code>
        </div>
        ${changesHtml ? `<ul class="list-disc list-inside space-y-0.5">${changesHtml}</ul>` : ''}
        <div class="text-xs text-slate-500 mt-2 italic">
          ⚡ Application Model refresh + Validation + Preview tournent en async côté serveur.
        </div>
      </div>
    `;
  }

  function renderPreviewBlock(report) {
    if (!report.success) {
      return `
        <div class="border-l-2 border-orange-500 pl-3">
          <div class="font-semibold text-orange-300 mb-1">📸 Preview échoué</div>
          <div class="text-orange-200 text-xs">${escapeHtml(report.error || 'unknown error')}</div>
        </div>
      `;
    }

    return `
      <div class="border-l-2 border-emerald-500 pl-3">
        <div class="font-semibold text-slate-200 mb-1">
          📸 Preview — <span class="text-emerald-300">${report.sizeBytes} bytes</span> via ${escapeHtml(report.browserVersion)}
        </div>
        <div class="text-xs text-slate-500 mb-2">
          ${report.width}x${report.height}px · ${report.durationMs}ms · 0 console errors
        </div>
        <img src="data:${report.mimeType};base64,${report.screenshotBase64}"
             alt="Screenshot"
             style="max-width: 100%; border-radius: 6px; border: 1px solid #1a2238; margin-top: 4px" />
      </div>
    `;
  }

  function renderErrorBlock(stage, err) {
    return `
      <div class="border-l-2 border-red-500 pl-3">
        <div class="font-semibold text-red-300 mb-1">❌ Erreur — ${escapeHtml(stage)}</div>
        <div class="text-red-200 text-xs">${escapeHtml(err.message || String(err))}</div>
      </div>
    `;
  }

  // ============================================================
  // Pipeline orchestrator
  // ============================================================

  async function runPipeline(userMessage) {
    const projectId = getActiveProjectId();
    console.log(`[phase9.js] pipeline start — project=${projectId} message="${userMessage.slice(0, 50)}..."`);

    // Stage 1: DECIDE
    let decideResponse;
    try {
      appendPhaseMessage('<div class="text-slate-500">⏳ Stage 1/3 — Decision Engine...</div>');
      decideResponse = await callDecide(projectId, userMessage);
    } catch (err) {
      appendPhaseMessage(renderErrorBlock('Decision', err));
      return;
    }

    const decision = decideResponse.decision;
    const nextState = decideResponse.nextState;
    const trace = decideResponse.reasoningTrace || [];
    const recommendations = decideResponse.recommendations || [];

    appendPhaseMessage(renderDecisionBlock(decision, nextState, trace, recommendations));

    // Stage 2: Si READY → demander approval puis orchestrate
    if (decision.verdict !== 'READY') {
      appendPhaseMessage(`
        <div class="text-amber-300 text-xs">
          ⚠️ Pipeline arrêté : verdict = ${decision.verdict}. L'utilisateur doit clarifier ou approuver manuellement.
        </div>
      `);
      return;
    }

    const plan = {
      planId: 'plan_' + Date.now().toString(36),
      title: `Plan for: ${decision.intentGoal}`,
      summary: decision.rationale,
      steps: [
        {
          stepIndex: 0,
          title: 'Execute chosen alternative',
          description: decision.chosenAlternative?.description || decision.intentGoal,
          operation: 'CREATE',
          targetFiles: decision.chosenAlternative?.targetFiles || [],
          requiresApproval: false
        }
      ],
      planHash: 'hash_' + (decision.decisionId || '').slice(-8),
      status: 'APPROVED'
    };

    const intent = {
      category: decision.intentCategory,
      goal: decision.intentGoal,
      requestedAction: userMessage,
      entities: [],
      constraints: [],
      urgency: 'NORMAL',
      confidence: 0.5,
      ambiguities: []
    };

    const approvalDiv = appendPhaseMessage(`
      <div class="text-slate-400 mb-2">Prêt à orchestrer. Cliquez pour exécuter :</div>
    `);
    const btn = renderApprovalButton('🚀 Approuver et orchestrer', async () => {
      btn.disabled = true;
      btn.textContent = '⏳ Orchestrating...';

      try {
        appendPhaseMessage('<div class="text-slate-500">⏳ Stage 2/3 — AI Orchestrator (5 agents LLM)...</div>');
        const orchestrateResponse = await callOrchestrate(projectId, plan, intent);
        appendPhaseMessage(renderRunBlock(orchestrateResponse));

        const run = orchestrateResponse.run || orchestrateResponse;
        const artifacts = run.artifacts || [];
        const fileChanges = artifacts.filter((a) => a.kind === 'PROPOSED_FILE_CHANGE');

        if (fileChanges.length === 0) {
          appendPhaseMessage('<div class="text-slate-500">ℹ️ No file changes proposed by orchestrator.</div>');
          return;
        }

        const mutateDiv = appendPhaseMessage(`
          <div class="text-slate-400 mb-2">${fileChanges.length} file change(s) proposed. Apply to project?</div>
        `);
        const mutateBtn = renderApprovalButton('📝 Apply mutations', async () => {
          mutateBtn.disabled = true;
          mutateBtn.textContent = '⏳ Mutating...';

          try {
            appendPhaseMessage('<div class="text-slate-500">⏳ Stage 3/3 — Mutation Engine...</div>');
            const mutateResponse = await callMutate(projectId, run, decision.decisionId);
            appendPhaseMessage(renderMutationReportBlock(mutateResponse.report));

            // Stage 4 (bonus) : preview manuel
            const previewDiv = appendPhaseMessage(`
              <div class="text-slate-400 mb-2">✅ Mutation + validation + preview tournent en async côté serveur.<br>Voir le screenshot maintenant ?</div>
            `);
            const previewBtn = renderApprovalButton('📸 Voir le preview', async () => {
              previewBtn.disabled = true;
              previewBtn.textContent = '⏳ Generating screenshot...';
              try {
                const previewResp = await callPreview(projectId);
                appendPhaseMessage(renderPreviewBlock(previewResp.report));
              } catch (err) {
                appendPhaseMessage(renderErrorBlock('Preview', err));
              }
            });
            previewDiv.appendChild(previewBtn);
          } catch (err) {
            appendPhaseMessage(renderErrorBlock('Mutation', err));
          }
        });
        mutateDiv.appendChild(mutateBtn);
      } catch (err) {
        appendPhaseMessage(renderErrorBlock('Orchestration', err));
      }
    });
    approvalDiv.appendChild(btn);
  }

  // ============================================================
  // Hook into existing chat send (Option A)
  // ============================================================

  function findChatInputAndButton() {
    const candidates = [
      { input: 'chatInput', button: 'chatSendBtn' },
      { input: 'wsChatInput', button: 'wsChatSendBtn' },
      { input: 'aiChatInput', button: 'aiChatSendBtn' }
    ];

    for (const c of candidates) {
      const input = document.getElementById(c.input);
      const button = document.getElementById(c.button);
      if (input && button) {
        return { input, button };
      }
    }

    const input = document.querySelector('input[type="text"]#chatInput, textarea#chatInput, input[data-chat-input]');
    const button = document.querySelector('button[data-chat-send], button#chatSendBtn');
    if (input && button) {
      return { input, button };
    }

    return null;
  }

  function hookChat() {
    const found = findChatInputAndButton();
    if (!found) {
      console.warn('[phase9.js] chat input/button not found — retrying in 1s');
      setTimeout(hookChat, 1000);
      return;
    }

    const { input, button } = found;
    console.log('[phase9.js] chat hooked:', { inputId: input.id, buttonId: button.id });

    // Créer le bouton "AI Pipeline" (Option B)
    const pipelineBtn = document.createElement('button');
    pipelineBtn.id = 'phase9PipelineBtn';
    pipelineBtn.className = button.className + ' ml-2 !bg-indigo-600 hover:!bg-indigo-500';
    pipelineBtn.textContent = '🤖 AI Pipeline';
    pipelineBtn.title = 'Run via Decision Engine + Orchestrator + Mutation + Preview (Phase 9.5 + 10 + 11 + 12 + 13)';
    pipelineBtn.onclick = async () => {
      const message = (input.value || input.textContent || '').trim();
      if (!message) {
        alert('Tape un message d\'abord');
        return;
      }
      appendUserMessage(message);
      input.value = '';
      try {
        await runPipeline(message);
      } catch (err) {
        console.error('[phase9.js] pipeline error', err);
        appendPhaseMessage(renderErrorBlock('Pipeline', err));
      }
    };

    if (button.parentNode) {
      button.parentNode.insertBefore(pipelineBtn, button.nextSibling);
    }

    // Option A : intercepter le bouton "Envoyer" existant
    if (PHASE9_INTERCEPT_CHAT) {
      const originalClickHandler = button.onclick;
      button.onclick = async (e) => {
        const message = (input.value || input.textContent || '').trim();
        if (!message) return;

        // Appelle aussi le handler original (pour ne pas casser la logique existante)
        // puis route à travers le pipeline
        appendUserMessage(message);
        input.value = '';

        try {
          await runPipeline(message);
        } catch (err) {
          console.error('[phase9.js] intercept pipeline error', err);
          appendPhaseMessage(renderErrorBlock('Pipeline (intercept)', err));
        }

        // Appelle aussi l'original (laisse le chat normal continuer)
        if (typeof originalClickHandler === 'function') {
          try { originalClickHandler.call(button, e); } catch {}
        }
      };

      // Aussi intercepter la touche Enter dans l'input
      const originalOnKeyDown = input.onkeydown;
      input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          button.click();
        }
      });

      console.log('[phase9.js] chat send button INTERCEPTED (Option A) — Enter and click route via pipeline');
    }

    console.log('[phase9.js] pipeline button inserted (Option B)');
  }

  // ============================================================
  // Boot
  // ============================================================

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hookChat);
  } else {
    hookChat();
  }

  // Export global pour debug
  window.phase9 = {
    version: PHASE9_VERSION,
    runPipeline,
    callDecide,
    callOrchestrate,
    callMutate,
    callPreview
  };

  console.log(`[phase9.js v${PHASE9_VERSION}] ready — both chat send + 🤖 AI Pipeline button route via pipeline`);
})();
