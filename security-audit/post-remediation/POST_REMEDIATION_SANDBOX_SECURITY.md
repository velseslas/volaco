# AUDIT DU BAC À SABLE ET DE L'ISOLATION PREVIEW
## VOLACO-CORE — FRONTIÈRE DU CLIENT WEB ET CONFINEMENT DU CODE TIERS

**Périmètre :** Interface Studio (`apps/studio/index.html`), Bac à sable Iframe, Communication `postMessage`, Visual Inspector  
**Date d'évaluation :** 11 Septembre 2026  

---

### 1. Modèle de Menace de la Prévisualisation

Dans VibeCode Studio, l'utilisateur ou l'IA génère et modifie du code HTML/CSS/JS exécuté en direct dans le navigateur du développeur.
Le modèle de menace stipule qu'une application générée ou importée peut être **hautement hostile** :
* Tentative de vol de clés d'API ou de jetons d'authentification dans le `localStorage` ou les cookies du Studio parent.
* Tentative de manipulation du DOM du Studio (modification de l'interface, détournement des boutons de sauvegarde).
* Tentative d'exécution de code privilégié via le canal `postMessage`.
* Navigation non sollicitée du document parent vers un site d'hameçonnage.

---

### 2. Évaluation de la Sandbox Iframe (`#wsLiveIframe`)

Dans `apps/studio/index.html:1402`, l'élément de rendu principal est configuré ainsi :
```html
<iframe
  id="wsLiveIframe"
  title="Preview Canvas"
  class="w-full h-full border-0 bg-[#06080e]"
  sandbox="allow-scripts allow-modals allow-forms allow-popups allow-downloads"
></iframe>
```

#### A. Révocation de `allow-same-origin` (SEC-007 — FIXED)
* **Conséquence standard du navigateur :** Sans `allow-same-origin`, le navigateur traite le contenu de l'iframe comme ayant une **origine opaque unique** (`null`).
* **Propriétés de confinement :**
  1. `window.parent.document` lève immédiatement une `DOMException: Blocked a frame with origin "null" from accessing a cross-origin frame`.
  2. `window.parent.localStorage` est strictement inaccessible.
  3. L'iframe dispose d'un espace de stockage isolé éphémère qui n'a aucun lien avec celui de `http://127.0.0.1:3000`.
  4. L'iframe ne peut pas lire ni transmettre les cookies de session du document parent.

#### B. Directives Sandbox Actives
* `allow-scripts` : Requis pour permettre aux applications dynamiques (React, Alpine, Vanilla JS) de fonctionner dans le canevas de test.
* `allow-modals` : Autorise `alert()`, `confirm()`, `prompt()` dans l'application testée.
* `allow-forms` : Autorise la soumission de formulaires internes à l'application.
* `allow-popups` : Autorise l'ouverture de liens externes dans de nouveaux onglets.
* `allow-downloads` : Autorise le téléchargement de fichiers générés côté client.
* **Absence de `allow-top-navigation` :** L'application dans l'iframe ne peut pas rediriger la fenêtre principale du Studio.

---

### 3. Canal de Communication Sécurisé `postMessage`

Le composant de capture des logs de l'application cliente transmet les erreurs et les messages de console vers le panneau d'observabilité du Studio.

Dans `apps/studio/index.html:5360-5390` :
```javascript
window.addEventListener('message', (event) => {
  const iframe = document.getElementById('wsLiveIframe');
  // 1. Contrôle d'identité strict de la source
  if (iframe && event.source !== iframe.contentWindow) {
    return;
  }
  if (!event.data || typeof event.data !== 'object') {
    return;
  }
  // 2. Filtre de protocole
  if (event.data.source !== 'vibecode-preview-runtime') {
    return;
  }
  // 3. Blocage impitoyable de toute commande active
  if (event.data.command || event.data.action || event.data.eval || event.data.execute) {
    console.warn('Action interdite bloquée depuis la preview iframe');
    return;
  }
  // 4. Sanitisation du texte avant injection dans le DOM
  const msg = event.data.message || '';
  addTerminalLogEntry({
    source: 'APP',
    level: level,
    category: 'RUNTIME',
    message: msg
  });
});
```

#### Évaluation de la Robustesse
* **Vérification `event.source` :** Empêche tout script malveillant présent dans une autre fenêtre ou un onglet tiers d'injecter des faux messages.
* **Rejet des charges exécutables :** Toute tentative d'émettre `{ action: 'deleteProject' }` ou `{ eval: '...' }` est interceptée et bloquée.
* **Résistance aux injections HTML (XSS) :** `addTerminalLogEntry` utilise `escapeTerminalHtml(entry.message)` (`apps/studio/index.html:5178`), qui remplace systématiquement `&`, `<`, `>`, `"`, `'` par leurs entités HTML équivalentes. Aucun payload de type `<img src=x onerror=...>` ne peut s'exécuter dans le contexte du Studio parent.

---

### 4. Prévisualisation dans un Nouvel Onglet (`popoutPreview`)

Dans `apps/studio/index.html:4801-4806` :
```javascript
function popoutPreview() {
  const blob = new Blob([currentAppHtml || pulseAiExactTemplate], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
```
* L'utilisation obligatoire de `'noopener,noreferrer'` rompt tout accès à `window.opener`.
* La révocation du Blob URL après 15 secondes évite les fuites de mémoire et limite la fenêtre de réutilisation du lien.

---

### 5. Conclusion sur l'Isolation Sandbox

Le bac à sable client du Studio respecte les meilleures pratiques de sécurité actuelles :
* **Aucune évasion directe** du bac à sable n'est possible sans vulnérabilité 0-day du moteur de rendu navigateur (V8/Blink/Gecko).
* Le canal `postMessage` est étanche et immunisé contre les injections de commandes et le Cross-Site Scripting.
