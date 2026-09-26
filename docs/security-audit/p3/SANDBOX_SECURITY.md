# SÉCURITÉ DE LA SANDBOX ET DU STUDIO SHELL — MISSION P3
**Composants :** `apps/studio/index.html`, `packages/core/src/terminal/`

---

## 1. Sandbox de Prévisualisation (Iframe)
* Attributs : `sandbox="allow-scripts allow-modals allow-forms allow-popups allow-downloads"`.
* Remarque : L'absence de `allow-same-origin` isole le stockage local de l'iframe de celui du Studio parent.
* Polyfill de stockage : `logBridgeScript` émule `localStorage` et `sessionStorage` en mémoire pour éviter les erreurs `SecurityError`.

## 2. Canal de Communication postMessage
* L'écouteur global du Studio parent vérifie :
  - `event.source === iframe.contentWindow`
  - `event.data.source === 'vibecode-preview-runtime'`
  - Rejet systématique de toute charge utile contenant `command`, `action`, `eval` ou `execute`.

## 3. Terminal Émulé et Protection Shell Injection
* Aucun processus système réel n'est exécuté : `TerminalService` est un automate déterministe en mémoire.
* La whitelist restreint strictement les commandes autorisées : `pnpm`, `npm`, `node`, `git`.
* Métacaractères bloqués : `;`, `&&`, `||`, `|`, `>`, `<`, ```, `$(`, `${`, retours chariot et octet nul.
