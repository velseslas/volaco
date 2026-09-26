# AUDIT DU CONFINEMENT DE LA SANDBOX APPLICATIVE (SANDBOX_REALITY)

## 1. Architecture du Confinement Iframe

L'application web générée est rendue au sein d'une balise `<iframe>` configurée comme suit :
```html
<iframe id="wsLiveIframe" sandbox="allow-scripts allow-modals allow-forms allow-popups allow-downloads">
```

### Analyse des Garanties :
1. **Omission Délibérée de `allow-same-origin` :** L'iframe est confinée dans une origine opaque `null`.
   - Impossibilité formelle d'accéder aux cookies du Studio.
   - Impossibilité formelle d'accéder au `localStorage` / `sessionStorage` du Studio.
   - Tentative d'accès à `window.parent.document` bloquée nativement par le moteur du navigateur (Same-Origin Policy).
2. **Filtrage des Messages `postMessage` :**
   - Le Studio valide que `event.source === iframe.contentWindow`.
   - Le Studio rejette toute charge utile contenant des commandes exécutables (`event.data.eval`, `event.data.command`).
   - Les logs reçus sont échappés via `escapeTerminalHtml()` avant toute insertion dans le DOM parent.
