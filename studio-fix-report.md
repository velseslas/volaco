# FIX STUDIO — Option A : ressources rapatriées en local (CSP stricte préservée)

> **Type :** correction appliquée (Option A). **CSP du Studio inchangée** (toujours stricte).
> **Date :** 2026-11-06
> **Symptômes corrigés :** boutons sans icônes (286 icônes invisibles), Preview Builder non stylé, « Ouvrir dans un nouvel onglet » méconnaissable.

---

## 1. Principe de l'Option A

Rapatrier **en local** les ressources externes consommées par le Studio, au lieu d'ouvrir la CSP. Aucune exception CSP ajoutée : `default-src 'self'` reste en vigueur (posture de sécurité Lot S2 **préservée**).

---

## 2. Modifications

| Fichier | Changement |
|---|---|
| `apps/studio/fontawesome/` (**nouveau**) | Font Awesome 6.4.0 : `css/all.min.css` + 8 webfonts (`fa-solid`, `fa-regular`, `fa-brands`, `fa-v4compatibility`) |
| `apps/studio/fonts/` (**nouveau**) | Google Fonts localisées : `google-fonts.css` + 17 fichiers `.woff2` (Plus Jakarta Sans / Inter / JetBrains Mono) |
| `apps/studio/index.html` | `<link>` Font Awesome CDN (l.57) → **`fontawesome/css/all.min.css`** (+ repli CDN conditionnel si l'asset local est absent) ; Google Fonts CDN (l.58) → **`fonts/google-fonts.css`** |
| `apps/studio/preview-builder.html` | `cdn.tailwindcss.com` (l.14) → **`tailwindcss.min.js` local** (déjà présent) ; `<meta CSP>` alignée (`script-src 'self'`) |
| `apps/api/src/server.ts` | Ajout des MIME `woff2`/`woff`/`ttf` dans `mimeMap` (servis en `font/*` au lieu de `application/octet-stream`) |

> Les `<link>`/`<script>` CDN présents dans les **templates d'apps générées** (HTML produits pour les utilisateurs) sont **inchangés** : ces aperçus tournent sous la CSP permissive `sandbox allow-scripts` de `preview-standalone`, donc le CDN y est légitime.

---

## 3. Preuves (navigateur réel, `http://127.0.0.1:3000`)

| Contrôle | Avant | Après |
|---|---|---|
| Font Awesome chargé | `faContent:"none"`, 286 icônes vides | **`faContent:"\ue007"`**, `font-family:"Font Awesome 6 Free"` |
| Police du Studio | repli Segoe UI (Google Fonts bloqué) | **`"Plus Jakarta Sans"`** (locale) |
| Console `/` — erreurs CSP | 3 (FA, Fonts, Tailwind) | **0 CSP** (Google Fonts localisé) |
| `/preview-builder.html` | `tailwind:false`, page non stylée + erreur CSP | **`tailwind:true`**, stylé, **0 erreur** |
| Bouton « Ouvrir dans un nouvel onglet » | icône invisible | **icône visible** (fonction inchangée : ouvrait déjà `/preview-standalone/…`) |
| En-tête CSP | `default-src 'self'` … | **identique (strict, inchangé)** |

Capture (studio authentifié) : barre d'outils avec toutes les icônes (▶, ⟳, ↗, 📷, ✨, 📎, 🎤, ↑).

---

## 4. Non-régression (build isolé, `dist` non touché)

```
static-csp + preview-popout-caged + preview-bundle-tenant + static-cache
→ 13 / 13 PASS   (EXIT=0)
```

MIME vérifié sur le build isolé : `/fontawesome/webfonts/fa-solid-900.woff2 → 200 font/woff2`,
`/fonts/google-fonts.css → 200 text/css`.

---

## 5. Prise d'effet

- **Pages Studio** (`index.html`, `preview-builder.html`) : servies **depuis le disque** → effet **immédiat** (déjà visible sur le serveur actuel).
- **`server.ts` (MIME)** : nécessite un **rebuild + redémarrage** (le serveur :3000 actuel est pré-rebuild). Sans ce rebuild, les `.woff2` restent servis en `application/octet-stream` — les navigateurs les chargent **quand même** (vérifié : icônes + police OK), mais le MIME correct viendra avec le prochain déploiement.

---

## 6. Sécurité

- **Aucune exception CSP** ; `default-src 'self'`, `object-src 'none'`, `base-uri 'self'` conservés.
- Aucune ressource externe bloquée ne reste **indispensable** à l'UI.
- Les polices/icônes sont servies **same-origin** (`font-src 'self'`, `style-src 'self'`).

---

## 7. Fichiers modifiés (récapitulatif)

```
M  apps/api/src/server.ts
M  apps/studio/index.html
M  apps/studio/preview-builder.html
?? apps/studio/fontawesome/   (9 fichiers, ~0,9 Mo)
?? apps/studio/fonts/         (18 fichiers, ~0,5 Mo)
```

**Aucune modification de `dist/`, `.env`, `.volaco-data`.** Diagnostic initial : `studio-audit-csp-report.md`.
