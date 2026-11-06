# AUDIT STUDIO — Boutons sans icônes, Preview cassé, « Ouvrir dans un nouvel onglet »

> **Type :** audit diagnostic (lecture seule + observation navigateur). **Aucune correction appliquée.**
> **Date :** 2026-11-05
> **Cible :** Studio servi sur `http://127.0.0.1:3000` (serveur actif, PID 7908) — **état pré-Lot B** (cf. audits précédents).
> **Symptômes signalés :** (1) « les boutons n'apparaissent pas bien », (2) « le preview ne fonctionne pas bien », (3) « open new tab » aussi.

---

## 1. VERDICT EN UNE PHRASE

Le Studio est cassé par un **conflit entre le durcissement CSP (travail « Lot S2 », 04/11) et les ressources externes des pages Studio** : la CSP serveur (`default-src 'self'`, sans source externe) **bloque Font Awesome** (→ **286 icônes invisibles**, d'où les boutons « vides »), **Google Fonts**, et **`cdn.tailwindcss.com`** (→ **Preview Builder non stylé**). Les fonctionnalités (preview, nouvel onglet) **fonctionnent** côté logique ; c'est l'**apparence des boutons** qui les rend méconnaissables.

---

## 2. PREUVE DIRECTE (console navigateur)

Ouverture de `http://127.0.0.1:3000/` — erreurs console :

```
error  Loading the stylesheet 'https://cdnjs.cloudflare.com/.../font-awesome/6.4.0/css/all.min.css'
       violates CSP "style-src 'self' 'unsafe-inline'".  The action has been blocked.
error  Loading the stylesheet 'https://fonts.googleapis.com/css2?...'  violates CSP "style-src 'self' ..."
error  Loading the script 'https://cdn.tailwindcss.com/'  violates CSP "script-src 'self' ..."   (page preview-builder.html)
```

En-tête réellement émis par le serveur (sur `/`, `/studio`, `/preview-builder.html`) :

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline';
  style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self';
  frame-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self';
  frame-ancestors 'self'; form-action 'self'
```

Source : `apps/api/src/server.ts:349` (`STUDIO_CSP`) + `:355` (en-tête), appliqué à tout le Studio.

**Sonde navigateur (page `/`)** :
```
tailwind: true      ← local OK
html2canvas: true   ← local OK
JSZip: true         ← local OK
faContent: "none"   ← Font Awesome NON chargé  ⇒ icônes invisibles
286 <i class="fa-*">  tous en content:"none"
```

**Sonde navigateur (`/preview-builder.html`)** :
```
tailwind: false     ← cdn.tailwindcss.com bloqué  ⇒ page NON stylée
```

---

## 3. CAUSE RACINE

Le travail **Lot S2 (audit sécurité, 04/11)** a introduit une **CSP stricte sans allowlist CDN** (`static-csp.test.ts`, `server.ts:349`). Il a été appliqué **sans mettre à jour le HTML des pages Studio**, qui continue de charger des ressources externes :

| Ressource externe | Fichier:ligne | Bloquée par CSP | Conséquence |
|---|---|---|---|
| Font Awesome CSS | `index.html:57` (+ templates `:5221`, `:6811`, `:6914`…) | **OUI** | **286 icônes invisibles** → boutons « vides » |
| Google Fonts CSS | `index.html:58` (+ templates) | **OUI** | police de repli (Segoe UI) — cosmétique |
| `cdn.tailwindcss.com` | `preview-builder.html:14` | **OUI** | **Preview Builder totalement non stylé** |

À l'inverse, la page `preview-standalone` (aperçu isolé) **fonctionne** : elle est servie avec sa **propre CSP permissive** (`sandbox allow-scripts`, `preview-standalone.ts:141`), donc Tailwind CDN y passe. **Vérifié** : le nouvel onglet d'aperçu rend correctement.

---

## 4. ANALYSE DÉTAILLÉE PAR SYMPTÔME

### 4.1 « Les boutons n'apparaissent pas bien »
- **Exact** : les boutons existent et sont cliquables (ex. `#btnTopPreviewPopout`, `#btnDashboardNewProject`), mais leur **contenu visuel est une icône Font Awesome** — CSS externe bloqué → **l'icône ne s'affiche pas**.
- 611 références `fa-*` dans `index.html` ; **286 éléments `<i class="fa-*">`** rendus avec `content: "none"`.
- L'arbre d'accessibilité montre des `[generic]` vides là où l'icône devrait apparaître (ex. bouton « Ouvrir dans un nouvel onglet » = `[button]` avec `[generic]` vide).

### 4.2 « Le preview ne fonctionne pas bien »
Deux chemins distincts :
- **Preview Builder** (`/preview-builder.html`) : **cassé visuellement** — sa seule source de styles est `cdn.tailwindcss.com`, **bloquée**. `tailwind:false` confirmé. La page s'affiche sans mise en forme.
- **Aperçu isolé / nouvel onglet** (`/preview-standalone/…`) : **fonctionne** (CSP `sandbox allow-scripts`). Test réel : page rendue, Tailwind chargé, contenu correct.

> Nuance importante : le « preview » n'est **pas cassé dans ses fonctions** ; c'est le **Preview Builder embarqué** qui est non stylé, et la confusion vient des **boutons d'aperçu sans icône**.

### 4.3 « Open new tab » aussi
- Le bouton `#btnTopPreviewPopout` (titre « Ouvrir dans un nouvel onglet ») est **présent, activé**, `onclick="popoutPreview()"`.
- **Test fonctionnel** (interception `window.open`) : l'appel produit bien
  `window.open('/preview-standalone/pv_805a68…/', '_blank', 'noopener')` → **la logique fonctionne**.
- Ouvert dans un onglet : **la page rend correctement** (`tailwind:true`, contenu affiché).
- **Mais le bouton est invisible/méconnaissable** car son icône (`fa-arrow-up-right-from-square`) est bloquée → l'utilisateur croit qu'il ne marche pas.

---

## 5. CE QUI N'EST PAS LA CAUSE (écarté par preuve)

| Hypothèse | Test | Résultat |
|---|---|---|
| Lot B (auth strict / JWT) casse le Studio | CSP observée identique sur routes publiques ; Studio servi 200 | **Non** — c'est une cause CSP, pas auth |
| Fichiers statiques manquants | `/tailwindcss.min.js`, `/html2canvas.min.js`, `/jszip.min.js` → **200** | Non |
| Tailwind local cassé | `window.tailwind:true` sur `/` | Non |
| Endpoint preview HS | `POST /api/v1/preview/standalone` → **201** + URL | Non |
| `window.open` bloqué | interception → URL correcte | Non |
| Serveur obsolète | `/` sert 1 410 924 o = `index.html` courant | Non |

---

## 6. FICHIERS ET LIGNES CONCERNÉS

| Fichier | Ligne | Rôle |
|---|---|---|
| `apps/api/src/server.ts` | `349`, `355` | CSP stricte `STUDIO_CSP` appliquée au Studio |
| `apps/studio/index.html` | `57` (et `5221`, `6811`, `6914`…) | `<link>` Font Awesome (CDN) — **bloqué** |
| `apps/studio/index.html` | `58` (et `5222`, `6812`) | `<link>` Google Fonts (CDN) — **bloqué** |
| `apps/studio/index.html` | `8`, `32`, `45` | Replis **locaux** Tailwind/html2canvas/jszip (fonctionnent) |
| `apps/studio/index.html` | `14`, `25`, `38`, `51` | Replis CDN (inutiles ici, bloqués si déclenchés) |
| `apps/studio/preview-builder.html` | `9` | `<meta CSP>` locale autorisant Tailwind — **écrasée** par l'en-tête serveur |
| `apps/studio/preview-builder.html` | `14` | `<script src="https://cdn.tailwindcss.com">` — **bloqué** |
| `apps/api/src/routes/preview-standalone.ts` | `141` | CSP permissive `sandbox allow-scripts` (aperçu isolé — OK) |
| `apps/api/tests/static-csp.test.ts` | `44-58` | Gel de la CSP stricte (interdit `*`) |

---

## 7. PISTES DE CORRECTION (non appliquées — pour décision)

Trois familles, à choisir :

**Option A — Rapatrier les ressources en local (recommandée, cohérente avec la CSP stricte).**
- Servir **Font Awesome** localement (`apps/studio/fontawesome.min.css` + webfonts) et changer les 4 `<link>` CDN → locaux. Supprime la dépendance externe **et** restaure les 286 icônes.
- **Preview Builder** : remplacer `cdn.tailwindcss.com` par le `tailwindcss.min.js` **local déjà présent** (`apps/studio/tailwindcss.min.js`) — cohérent avec `index.html:8`.
- **Google Fonts** : soit rapatrier les polices, soit accepter le repli système.
- **Avantage :** garde la CSP stricte du Lot S2 **sans aucune exception**.

**Option B — Assouplir la CSP du Studio (rapide, mais affaiblit S2).**
- Ajouter `https://cdnjs.cloudflare.com https://fonts.googleapis.com https://fonts.gstatic.com` à `style-src`/`font-src`, et `https://cdn.tailwindcss.com` à `script-src`.
- ⚠️ `script-src` avec un CDN externe **rouvre une surface XSS/CDN** — contraire à l'objectif S2. **Déconseillé**.

**Option C — Hybride.**
- Rapatrier Font Awesome + utiliser Tailwind local (Option A) pour **zéro exception**, et **uniquement si nécessaire** autoriser `fonts.googleapis.com`/`gstatic` en `style-src`/`font-src` (polices seules, risque faible).

> La **structure** du Studio est déjà prête pour l'Option A : elle **prévoit des replis locaux** (`tailwindcss.min.js`, etc.). Il manque surtout un **Font Awesome local** et le **Tailwind local** dans `preview-builder.html`.

---

## 8. IMPACT ET RISQUE

| Constat | Sévérité | Nature |
|---|---|---|
| 286 icônes invisibles (Font Awesome bloqué) | **P1 (UX)** | Régression visuelle majeure, boutons méconnaissables |
| Preview Builder non stylé (Tailwind CDN bloqué) | **P1 (UX)** | Fonction d'aperçu dégradée |
| Google Fonts bloqué | **P3** | Cosmétique (repli police) |
| Fonctions preview / nouvel onglet | — | **Fonctionnelles** (pas de bug logique) |

**Ce n'est pas un incident de sécurité** : au contraire, le Studio est *trop* verrouillé pour ses propres ressources. Aucune donnée perdue, aucune auth contournée.

---

## 9. LIMITES DE L'AUDIT

- Audit **non intrusif** : observation navigateur + en-têtes HTTP + lecture sources ; **aucune modification**.
- Le serveur audité est **pré-Lot B** (cf. audits précédents) ; les symptômes CSP sont **indépendants** du Lot B.
- Diagnostic **statique** de l'ordre de chargement (suffisant ici : la cause est un blocage CSP déterministe).

---

## 10. CONCLUSION

Les trois symptômes (« boutons », « preview », « open new tab ») ont **une même cause** : la **CSP stricte du Lot S2** bloque les ressources externes que les pages Studio utilisent encore. La correction **propre** est de **rapatrier en local** Font Awesome et d'utiliser le **Tailwind local** dans `preview-builder.html` (Option A), ce qui **satisfait à la fois** la sécurité (S2) et l'interface.

**Aucune correction n'a été appliquée — en attente de ton choix d'option.**
