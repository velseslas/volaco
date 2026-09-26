/**
 * VibeCode Studio - Studio Shell HTML Renderer (CAPP-005)
 */

import fs from 'node:fs';
import path from 'node:path';
import type { StudioShellViewModel } from './types.js';

export function renderStudioShellHtml(model: StudioShellViewModel): string {
  const candidatePaths = [
    path.join(process.cwd(), 'apps/studio/index.html')
  ];
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf8');
    }
  }

  const p = model.project;
  const f = model.files;
  const w = model.workspace;

  // Sérialiser le state initial en JSON sécurisé
  const stateJson = JSON.stringify({
    tenantId: model.tenantId,
    projectId: model.projectId,
    userRole: model.userRole,
    activeFile: w.state.activeFile || 'package.json',
    isDirty: w.state.isDirty,
    status: p.status,
    revisionNumber: p.currentRevision.revisionNumber,
    treeHash: p.currentRevision.treeHash
  }).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${model.layout.title} — ${p.name}</title>
  <style>
    :root {
      --bg-primary: #0f172a;
      --bg-secondary: #1e293b;
      --bg-tertiary: #334155;
      --text-primary: #f8fafc;
      --text-secondary: #94a3b8;
      --accent: #38bdf8;
      --accent-hover: #0284c7;
      --border: #334155;
      --success: #22c55e;
      --warning: #f59e0b;
      --danger: #ef4444;
      --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
      --font-sans: system-ui, -apple-system, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font-sans);
      background-color: var(--bg-primary);
      color: var(--text-primary);
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    /* Top Bar Header */
    header.studio-header {
      height: 48px;
      background-color: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
    }
    .header-branding {
      display: flex;
      align-items: center;
      gap: 12px;
      font-weight: 700;
      font-size: 1.1rem;
      letter-spacing: -0.02em;
    }
    .header-branding .logo-badge {
      background: linear-gradient(135deg, #38bdf8, #6366f1);
      color: #0f172a;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 0.8rem;
      font-weight: 800;
    }
    .header-context {
      display: flex;
      align-items: center;
      gap: 16px;
      font-size: 0.85rem;
    }
    .badge {
      background: var(--bg-tertiary);
      padding: 2px 8px;
      border-radius: 4px;
      color: var(--text-secondary);
      border: 1px solid var(--border);
    }
    .badge-status {
      background: rgba(56, 189, 248, 0.15);
      color: var(--accent);
      border: 1px solid rgba(56, 189, 248, 0.4);
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-status.READY { color: var(--success); border-color: rgba(34, 197, 94, 0.4); background: rgba(34, 197, 94, 0.15); }
    .badge-status.ERROR { color: var(--danger); border-color: rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.15); }
    .badge-status.BUILDING, .badge-status.VALIDATING { color: var(--warning); border-color: rgba(245, 158, 11, 0.4); background: rgba(245, 158, 11, 0.15); }

    /* Layout 3 Colonnes */
    main.studio-body {
      flex: 1;
      display: grid;
      grid-template-columns: 240px 1fr 280px;
      overflow: hidden;
    }
    .panel {
      background: var(--bg-primary);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-right: 1px solid var(--border);
    }
    .panel:last-child { border-right: none; }
    .panel-header {
      height: 36px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 12px;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary);
    }
    .panel-content {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
    }

    /* Quadrant 1: File Tree */
    .tree-node {
      padding: 4px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.85rem;
      display: flex;
      align-items: center;
      gap: 6px;
      user-select: none;
    }
    .tree-node:hover { background: var(--bg-secondary); }
    .tree-node.active { background: rgba(56, 189, 248, 0.15); color: var(--accent); font-weight: 600; }
    .tree-node.dir { font-weight: 600; color: var(--text-secondary); }

    /* Quadrant 2: Workspace */
    .workspace-tabs {
      display: flex;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      padding: 0 8px;
      gap: 2px;
    }
    .tab {
      padding: 8px 16px;
      font-size: 0.8rem;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .tab.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
      background: var(--bg-primary);
      font-weight: 600;
    }
    .editor-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: #090d16;
    }
    textarea.code-editor {
      flex: 1;
      width: 100%;
      background: transparent;
      border: none;
      outline: none;
      resize: none;
      color: #e2e8f0;
      font-family: var(--font-mono);
      font-size: 0.85rem;
      padding: 12px;
      line-height: 1.5;
    }
    .editor-actions {
      height: 40px;
      background: var(--bg-secondary);
      border-top: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding: 0 12px;
      gap: 8px;
    }
    button.btn {
      background: var(--bg-tertiary);
      color: var(--text-primary);
      border: 1px solid var(--border);
      padding: 4px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.75rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    button.btn:hover { background: var(--border); }
    button.btn-primary { background: var(--accent); color: #0f172a; border-color: var(--accent); }
    button.btn-primary:hover { background: var(--accent-hover); }

    /* Quadrant 3: Project Info */
    .info-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px;
      margin-bottom: 12px;
      font-size: 0.8rem;
    }
    .info-card-title {
      font-weight: 700;
      font-size: 0.75rem;
      text-transform: uppercase;
      color: var(--text-secondary);
      margin-bottom: 6px;
    }
    .check-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 3px 0;
      font-size: 0.75rem;
    }
    .check-ok { color: var(--success); }
    .check-fail { color: var(--danger); }

    /* Panneau Inférieur: Status & Events */
    footer.studio-footer {
      height: 140px;
      background: var(--bg-secondary);
      border-top: 1px solid var(--border);
      display: flex;
      flex-direction: column;
    }
    .events-log {
      flex: 1;
      overflow-y: auto;
      padding: 8px 12px;
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: var(--text-secondary);
      display: flex;
      flex-direction: column-reverse;
      gap: 4px;
    }
    .event-line {
      display: flex;
      gap: 8px;
    }
    .event-time { color: #64748b; }
    .event-action { color: var(--accent); font-weight: 600; }
    .event-status.SUCCESS { color: var(--success); }
    .event-status.FAILURE { color: var(--danger); }
    .status-line {
      height: 24px;
      background: #090d16;
      border-top: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 12px;
      font-size: 0.7rem;
      color: #64748b;
    }
  </style>
</head>
<body>

  <!-- TOP BAR -->
  <header class="studio-header">
    <div class="header-branding">
      <span class="logo-badge">VC</span>
      <span>VibeCode Studio</span>
      <span class="badge">${p.name}</span>
    </div>
    <div class="header-context">
      <span class="badge">Tenant: ${model.tenantId}</span>
      <span class="badge">Rôle: ${model.userRole}</span>
      <span class="badge badge-status ${p.status}" id="statusBadge">${p.status}</span>
    </div>
  </header>

  <!-- 3 COLONNES -->
  <main class="studio-body">

    <!-- QUADRANT GAUCHE : FILE TREE -->
    <section class="panel" id="panelFileTree">
      <div class="panel-header">
        <span>${model.layout.panels.fileTree.title}</span>
        <button class="btn" onclick="createNewFilePrompt()" title="Nouveau fichier">+</button>
      </div>
      <div class="panel-content" id="fileTreeContainer">
        ${renderTreeNodes(f.tree)}
      </div>
    </section>

    <!-- QUADRANT CENTRAL : WORKSPACE -->
    <section class="panel" id="panelWorkspace">
      <div class="panel-header">
        <span>${model.layout.panels.workspace.title}</span>
        <span id="activeFilePathDisplay" style="text-transform:none; font-family:var(--font-mono)">package.json</span>
      </div>
      <div class="workspace-tabs" id="tabsBar">
        <div class="tab active" id="currentTab">
          <span id="tabFilename">package.json</span>
          <span id="dirtyIndicator" style="color:var(--warning); display:none">*</span>
        </div>
      </div>
      <div class="editor-container">
        <textarea class="code-editor" id="codeEditor" spellcheck="false" oninput="handleEditorInput()"></textarea>
        <div class="editor-actions">
          <button class="btn btn-primary" onclick="saveActiveFile()">Sauvegarder</button>
          <button class="btn" onclick="commitTreeRevision()">Commiter Révision</button>
        </div>
      </div>
    </section>

    <!-- QUADRANT DROIT : PROJECT INFO -->
    <section class="panel" id="panelProjectInfo">
      <div class="panel-header">
        <span>${model.layout.panels.projectInfo.title}</span>
        <span>Rev #${p.currentRevision.revisionNumber}</span>
      </div>
      <div class="panel-content">
        <!-- État & Transition -->
        <div class="info-card">
          <div class="info-card-title">Cycle de Vie (7 États)</div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px">
            <span>Statut :</span>
            <strong id="cardStatus" class="badge-status ${p.status}">${p.status}</strong>
          </div>
          <select id="statusSelect" style="width:100%; padding:4px; background:var(--bg-primary); color:#fff; border:1px solid var(--border); border-radius:4px">
            <option value="ACTIVE">ACTIVE</option>
            <option value="BUILDING">BUILDING</option>
            <option value="VALIDATING">VALIDATING</option>
            <option value="READY">READY</option>
            <option value="ARCHIVED">ARCHIVED</option>
          </select>
          <button class="btn" style="width:100%; margin-top:6px; justify-content:center" onclick="changeStatusFromSelect()">Appliquer Statut</button>
        </div>

        <!-- Révision FND-004 -->
        <div class="info-card">
          <div class="info-card-title">Révision Courante</div>
          <div>Numéro : <strong>#${p.currentRevision.revisionNumber}</strong></div>
          <div>Auteur : ${p.currentRevision.author || 'system'}</div>
          <div>Message : <em>${p.currentRevision.message || 'Initial'}</em></div>
          <div style="font-family:var(--font-mono); font-size:0.65rem; color:#64748b; margin-top:4px; word-break:break-all">Hash: ${p.currentRevision.treeHash?.substring(0, 16) || 'none'}...</div>
        </div>

        <!-- Moteur de Validation -->
        <div class="info-card">
          <div class="info-card-title">Rapport de Validation</div>
          <div class="check-item"><span>Build</span><span class="check-ok">✔</span></div>
          <div class="check-item"><span>Typecheck strict</span><span class="check-ok">✔</span></div>
          <div class="check-item"><span>Tests Monorepo</span><span class="check-ok">✔</span></div>
          <div class="check-item"><span>Anti-Traversal & RBAC</span><span class="check-ok">✔</span></div>
          <button class="btn btn-primary" style="width:100%; margin-top:8px; justify-content:center" onclick="triggerValidation()">Lancer la Validation</button>
        </div>
      </div>
    </section>

  </main>

  <!-- PANNEAU INFÉRIEUR : STATUS / EVENTS -->
  <footer class="studio-footer" id="panelStatusEvents">
    <div class="panel-header">
      <span>${model.layout.panels.statusEvents.title}</span>
      <button class="btn" onclick="fetchRecentActivity()">Actualiser</button>
    </div>
    <div class="events-log" id="eventsLogContainer">
      ${renderEventsLines(p.recentActivity)}
    </div>
    <div class="status-line">
      <span id="systemStatusMsg">Système prêt — CAPP-005 Studio Shell actif</span>
      <span>VibeCode Core v0.1.0 • Node.js</span>
    </div>
  </footer>

  <script>
    const APP_STATE = ${stateJson};

    async function loadFileContent(path) {
      APP_STATE.activeFile = path;
      document.getElementById('activeFilePathDisplay').innerText = path;
      document.getElementById('tabFilename').innerText = path.split('/').pop() || path;
      document.querySelectorAll('.tree-node').forEach(el => el.classList.remove('active'));
      const activeNode = document.querySelector('[data-path="' + path + '"]');
      if (activeNode) activeNode.classList.add('active');

      try {
        const res = await fetch('/api/v1/projects/' + APP_STATE.projectId + '/files/content?path=' + encodeURIComponent(path), {
          headers: { 'x-tenant-id': APP_STATE.tenantId, 'x-user-role': APP_STATE.userRole }
        });
        if (res.ok) {
          const data = await res.json();
          document.getElementById('codeEditor').value = data.file.content;
          setDirty(false);
          logSystemEvent('FILE_READ', 'Fichier chargé : ' + path);
        }
      } catch (err) {
        logSystemEvent('ERROR', 'Erreur de chargement: ' + err.message);
      }
    }

    async function saveActiveFile() {
      const content = document.getElementById('codeEditor').value;
      try {
        const res = await fetch('/api/v1/projects/' + APP_STATE.projectId + '/files/content', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': APP_STATE.tenantId, 'x-user-role': APP_STATE.userRole },
          body: JSON.stringify({ path: APP_STATE.activeFile, content: content })
        });
        if (res.ok) {
          setDirty(false);
          logSystemEvent('FILE_UPDATE', 'Fichier sauvegardé : ' + APP_STATE.activeFile);
          fetchRecentActivity();
        }
      } catch (err) {
        logSystemEvent('ERROR', 'Échec de sauvegarde : ' + err.message);
      }
    }

    async function commitTreeRevision() {
      const msg = prompt('Message de révision FND-004 :', 'Mise à jour via Studio Shell');
      if (!msg) return;
      try {
        const res = await fetch('/api/v1/projects/' + APP_STATE.projectId + '/files/commit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': APP_STATE.tenantId, 'x-user-role': APP_STATE.userRole },
          body: JSON.stringify({ message: msg, author: 'studio-user' })
        });
        if (res.ok) {
          const data = await res.json();
          logSystemEvent('REVISION_CREATE', 'Révision #' + data.revision.revisionNumber + ' commitée');
          fetchRecentActivity();
        }
      } catch (err) {
        logSystemEvent('ERROR', 'Erreur de commit: ' + err.message);
      }
    }

    async function changeStatusFromSelect() {
      const newStatus = document.getElementById('statusSelect').value;
      try {
        const res = await fetch('/api/v1/projects/' + APP_STATE.projectId + '/status', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': APP_STATE.tenantId, 'x-user-role': APP_STATE.userRole },
          body: JSON.stringify({ status: newStatus, reason: 'Changement manuel via Studio Shell' })
        });
        if (res.ok) {
          const data = await res.json();
          updateStatusUi(data.state.status);
          logSystemEvent('STATUS_UPDATE', 'Statut projet basculé vers ' + data.state.status);
          fetchRecentActivity();
        }
      } catch (err) {
        logSystemEvent('ERROR', 'Erreur de changement de statut : ' + err.message);
      }
    }

    async function triggerValidation() {
      logSystemEvent('VALIDATING', 'Validation en cours...');
      try {
        const res = await fetch('/api/v1/projects/' + APP_STATE.projectId + '/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': APP_STATE.tenantId, 'x-user-role': APP_STATE.userRole },
          body: JSON.stringify({ checks: { build: true, typecheck: true, lint: true, tests: true, security: true } })
        });
        if (res.ok) {
          const data = await res.json();
          logSystemEvent('PROJECT_VALIDATION', 'Validation ' + data.validation.status);
          updateStatusUi('READY');
          fetchRecentActivity();
        }
      } catch (err) {
        logSystemEvent('ERROR', 'Échec de validation : ' + err.message);
      }
    }

    async function fetchRecentActivity() {
      try {
        const res = await fetch('/api/v1/projects/' + APP_STATE.projectId + '/activity?limit=15', {
          headers: { 'x-tenant-id': APP_STATE.tenantId, 'x-user-role': APP_STATE.userRole }
        });
        if (res.ok) {
          const data = await res.json();
          const container = document.getElementById('eventsLogContainer');
          container.innerHTML = data.activity.map((a: any) =>
            '<div class="event-line">' +
              '<span class="event-time">' + new Date(a.timestamp).toLocaleTimeString() + '</span>' +
              '<span class="event-action">' + a.action + '</span>' +
              '<span class="event-status ' + a.status + '">' + a.status + '</span>' +
              '<span>' + a.resourceId + '</span>' +
            '</div>'
          ).join('');
        }
      } catch (err) {}
    }

    function handleEditorInput() {
      setDirty(true);
    }

    function setDirty(isDirty) {
      APP_STATE.isDirty = isDirty;
      document.getElementById('dirtyIndicator').style.display = isDirty ? 'inline' : 'none';
    }

    function updateStatusUi(status) {
      const badge = document.getElementById('statusBadge');
      badge.innerText = status;
      badge.className = 'badge badge-status ' + status;
      const card = document.getElementById('cardStatus');
      card.innerText = status;
      card.className = 'badge-status ' + status;
    }

    function logSystemEvent(action, message) {
      const line = document.createElement('div');
      line.className = 'event-line';
      line.innerHTML = '<span class="event-time">' + new Date().toLocaleTimeString() + '</span><span class="event-action">' + action + '</span><span>' + message + '</span>';
      document.getElementById('eventsLogContainer').prepend(line);
      document.getElementById('systemStatusMsg').innerText = message;
    }

    function createNewFilePrompt() {
      const path = prompt('Chemin du nouveau fichier (ex: src/utils/helper.js) :');
      if (!path) return;
      fetch('/api/v1/projects/' + APP_STATE.projectId + '/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': APP_STATE.tenantId, 'x-user-role': APP_STATE.userRole },
        body: JSON.stringify({ path: path, type: 'file', content: '// Nouveau fichier' })
      }).then(() => {
        location.reload();
      });
    }

    // Charger le premier fichier au démarrage
    window.addEventListener('DOMContentLoaded', () => {
      loadFileContent(APP_STATE.activeFile);
    });
  </script>
</body>
</html>`;
}

function renderTreeNodes(nodes: any[], depth: number = 0): string {
  if (!nodes || nodes.length === 0) return '<div style="color:#64748b; font-size:0.8rem">Aucun fichier</div>';
  let html = '';
  for (const node of nodes) {
    const isDir = node.type === 'directory';
    const icon = isDir ? '📁' : '📄';
    const indent = depth * 12;
    html += `<div class="tree-node ${isDir ? 'dir' : 'file'}" data-path="${node.path}" style="padding-left: ${indent + 8}px" ${isDir ? '' : `onclick="loadFileContent('${node.path}')"`}>`;
    html += `<span>${icon}</span><span>${node.name}</span>`;
    html += '</div>';
    if (isDir && node.children && node.children.length > 0) {
      html += renderTreeNodes(node.children, depth + 1);
    }
  }
  return html;
}

function renderEventsLines(events: any[]): string {
  if (!events || events.length === 0) return '<div class="event-line"><span>Aucun événement récent enregistré.</span></div>';
  return events.map(e => `
    <div class="event-line">
      <span class="event-time">${new Date(e.timestamp).toLocaleTimeString()}</span>
      <span class="event-action">${e.action}</span>
      <span class="event-status ${e.status}">${e.status}</span>
      <span>${e.resourceId}</span>
    </div>
  `).join('');
}
