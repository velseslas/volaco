# AUDIT DU BAC À SABLE DE PRÉVISUALISATION (SANDBOX AUDIT)
## VOLACO-CORE — ISOLATION IFRAME ET PRÉVENTION XSS

### 1. Configuration du Bac à Sable Iframe
- Localisation : `apps/studio/index.html` (ligne 9803).
- Attributs appliqués : `sandbox="allow-scripts"`.
- **Règle absolue :** L'attribut permissif `allow-same-origin` est **strictement absent**.
- **Conséquence de sécurité :** L'iframe s'exécute avec une origine opaque (`null`). Le code généré par l'IA ne peut ni accéder aux cookies du Studio, ni à son `localStorage`, ni au DOM du document parent.

### 2. Sécurisation des Liens Popout
- Tous les liens et boutons ouvrant des fenêtres de prévisualisation secondaires appliquent `target="_blank"` avec les attributs `rel="noopener noreferrer"`.
- Cette mesure neutralise tout risque de Reverse Tabnabbing via `window.opener`.

### 3. Filtrage des Événements PostMessage
- Tout message transitant entre la fenêtre principale et l'iframe est validé par un récepteur qui vérifie `event.source` et applique une liste blanche d'actions autorisées.
- Validation : Vecteurs 15 et 16 de `offensive-audit.test.ts` (PASS).
