# AUDIT DE LA CHAÎNE D'APPROVISIONNEMENT ET SRI (SUPPLY_CHAIN_REALITY)

## 1. Dépendances NPM

- Aucune dépendance externe de production superflue dans `package.json` (le core fonctionne sur les modules natifs Node.js `node:http`, `node:crypto`, `node:fs`).
- Seules les dépendances de développement `@types/node`, `typescript` et `vitest` sont présentes.

## 2. Analyse des Ressources Externes CDN

- **Scripts du Studio Principal :** `html2canvas` et `jszip` disposent de condensats SHA-512 `integrity` valides.
- **Écart Découvert (P5-MED-03) :**
  1. `https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js` dans l'en-tête du Studio est appelé sans hachage `integrity`.
  2. Les 12 templates intégrés de projets appellent `https://cdn.tailwindcss.com` sans condensat SRI.
- **Recommandation :** Remplacer les appels CDN distants par les versions locales statiques servies par le Studio ou ajouter les attributs `integrity` SHA-512 correspondants.
