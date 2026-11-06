# REBUILD + REDÉMARRAGE — Journal d'opération

> **Date :** 2026-11-06
> **Autorisation :** explicite (« fait rebuild+redémarrage »).
> **Résultat :** ✅ serveur redémarré sur le **nouveau build (Lots A/B actifs)** + **fix Studio (Option A)** live.

---

## 1. Séquence exécutée

1. **Sauvegardes**
   - `dist-backup-20261106-013317/` (2497 fichiers) — ancien `dist`.
   - `.env.bak-20261106-013649` — ancien `.env`.
2. **Arrêt** du serveur :3000 (ancien PID 7908).
3. **`tsc --noEmit`** (typecheck) → EXIT 0.
4. **Rebuild** `npx tsc` → `dist` régénéré (EXIT 0).
5. **(.env)** ajout de `VOLACO_JWT_SECRET` (généré, 32 octets base64, distinct de la clé API) **et** `VOLACO_STRICT_AUTH=0` (dev).
6. **Redémarrage** : `node --env-file=.env dist/apps/api/src/server.js` (PID **30528**).
7. **Vérifications** (santé, Lot B, Studio, tests).

---

## 2. Résultats

### Lot B désormais ACTIF (avant : dormant)
| Sonde | Avant (ancien dist) | Après (nouveau dist) |
|---|---|---|
| `POST /api/v1/auth/logout` | **404** (route absente) | **401** (route active, exige auth) |
| Route privée + en-têtes falsifiés | 200 (fallback) | 200 (fallback dev, `STRICT=0`) / **401 si strict ON** |
| `/health` | 200 | 200 |

### Studio (Option A) — actif
| Contrôle | Résultat |
|---|---|
| Font Awesome (286 icônes) | **rendues** |
| Police locale | `"Plus Jakarta Sans"` |
| Erreurs console | **0** |
| Preview Builder | `tailwind: true`, stylé |
| `.woff2` MIME | **`font/woff2`** (corrigé par le rebuild) |

### Tests (build actuel, data dir isolé)
```
lot-b-auth-revocation + lot-b-audit-quota + lot-b-session-unit
+ auth-strict + static-csp + preview-bundle-tenant
→ 23 / 23 PASS  (EXIT=0)
```

---

## 3. Configuration `.env` (noms de variables)

```
PORT, NODE_ENV, AUTH_SECRET, MISTRAL_API_KEY, MISTRAL_MODEL,
VOLACO_JWT_SECRET   ← ajouté (valeur masquée, non versionné)
VOLACO_STRICT_AUTH=0 ← ajouté (dev uniquement)
```
- `NODE_ENV=development` → la production reste verrouillée (strict **obligatoire**, jamais désactivable ; `VOLACO_STRICT_AUTH=0` n'est honoré qu'en dev/test).
- `.env` non versionné (gitignoré) ; `.env.bak-*`, `dist-backup-*/`, logs de redémarrage ajoutés au `.gitignore`.

---

## 4. Serveur actuel

- **PID 30528**, port 3000, `node --env-file=.env dist/apps/api/src/server.js`.
- `/health` → 200.

---

## 5. Retour arrière possible

- **Artefact** : `dist-backup-20261106-013317/` (restaurer = remplacer `dist/`).
- **Config** : `.env.bak-20261106-013649` (retirer le secret + `STRICT_AUTH`).

---

## 6. Points d'attention (hérités, non bloquants pour l'usage actuel)

- **GATE-01** (audit pré-publication) confirmé en pratique : sans `VOLACO_JWT_SECRET`, le processus **ne binde pas** le port mais **ne s'arrête pas** et log « le serveur continue de fonctionner » — à corriger avant une mise en production.
- `.env` de **développement** : `STRICT_AUTH=0` par choix explicite (confort Studio). Pour un déploiement exposé : `NODE_ENV=production` + secret valide (strict forcé).
