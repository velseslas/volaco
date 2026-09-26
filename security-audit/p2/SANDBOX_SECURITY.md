# SÉCURITÉ DU BAC À SABLE CLIENT (SANDBOX SECURITY)
## VOLACO-CORE — CONFINEMENT DE L'IFRAME PREVIEW ET ISOLATION DU DOM

### 1. Confinement de l'Iframe Preview
- Localisation : `apps/studio/index.html` (ligne 9803).
- Attributs appliqués :
  ```html
  sandbox="allow-scripts allow-modals allow-forms allow-popups allow-downloads"
  ```
- **Règle absolue vérifiée :** L'attribut permissif `allow-same-origin` est **strictement absent**.
- **Effet de sécurité :** L'iframe fonctionne avec une origine opaque (`null`). Le code utilisateur ne peut accéder ni au `localStorage`, ni aux cookies, ni au DOM de l'application Studio parent.

### 2. Canal de Communication Sécurisé `postMessage`
- Vérification systématique de l'émetteur :
  ```javascript
  if (iframe && event.source !== iframe.contentWindow) return;
  ```
- Filtrage des charges utiles : toute commande active contenant `command`, `action`, `eval` ou `execute` est rejetée immédiatement.
- Échappement HTML universel : les messages de log sont passés dans `escapeTerminalHtml()` avant toute insertion dans l'interface du terminal Studio.
