# volaco-core — note d'évaluation (12 octobre 2026)

**Note globale : 55/100** — *« socle solide, exécution inachevée »*

Le mot « bordel » ne décrit pas la **structure** (elle est nette) mais trois choses précises : **trois chemins critiques ouverts**, **une couche d'architecture manquante** (gateway/runtime), et **de l'accumulation** (sauvegardes, code mort, `dist/` sans parité source). C'est un chantier en cours vu de l'intérieur, pas un projet mal conçu.

**Deux contextes, deux notes :**

| Contexte d'usage | Note | Pourquoi |
|---|---|---|
| Outil **local**, mono-utilisateur, jamais exposé (état actuel du `.env`, écoute `127.0.0.1`) | **63/100** | L'essentiel des failles suppose un appelant qui atteint l'API ou du contenu généré exécuté hors iframe ; en local, l'exposition est réduite — mais pas nulle (ondes web, ouverture en onglet, CSRF) |
| Dès que c'est **exposé, partagé, multi-tenant ou publiquement déployé** | **38/100** | Authentification non appliquée par défaut, aucune isolation de locataire sur la chaîne React, SSRF, RCE terminal, bundle sur l'origine du Studio |

---

## Scorecard par dimension

| Dimension | Poids | Note | Justification (faits vérifiés) |
|---|---|---|---|
| **Sécurité — posture** | 25 % | **45** | À charge : repli d'authentification actif en configuration livrée (`middleware/auth.ts:78-103` + `.env`), aucune vérification de locataire sur `/app/*` et `/preview-bundle`, `npm test` = RCE (`whitelist.ts:62-63`), traversée `projectId` MCP (`.env` lisible), SSRF ×2, bundle généré exécuté sur l'origine du Studio (jeton + clé IA en `localStorage`), CSRF sans contrôle d'origine, clé de dev connue. À décharge : `execFile` sans shell, `scrypt` + `timingSafeEqual`, CORS fermé par défaut, écoute `127.0.0.1`, en-têtes de base, masquage des secrets, audit persistant |
| **Robustesse / exploitation** | 15 % | **45** | Appels synchrones bloquants (`execFileSync`, `scryptSync`, écritures + `fsync` par événement), builds non atomiques dans le processus de l'API, SSE sans fin de flux ni backpressure, limites en mémoire mono-instance, pas d'arrêt propre ni de migrations/sauvegardes |
| **Preview — conformité à la cible** | 13 % | **40** | 2 couches sur 7 ; **ni dev server ni HMR**, ni WebContainers, ni runtime cloud, ni gateway, ni mocks/BDD ; mais VFS + patch engine + snapshots transactionnels solides, moteur de preview testé (35 fichiers) et rendu headless réel |
| **Architecture & structuration** | 15 % | **65** | Séparation routes/services nette, RBAC appliqué dans les services, isolation de locataire correcte dans les stores, moteur immuable, adaptateurs de transport. En recul : `server.ts` monolithe (~650 lignes), singletons d'état global, parsing d'URL dupliqué dans chaque route, validation ad hoc sans schéma |
| **Qualité du code & typage** | 12 % | **68** | TypeScript strict avec `noUncheckedIndexedAccess` et `exactOptionalPropertyTypes`, commentaires d'architecture de grande qualité (le « pourquoi » est expliqué). En recul : code legacy mort (Stitch), incohérences internes (validation de chemin, listener dupliqué), quelques chaînes mal encodées |
| **Tests & vérifiabilité** | 12 % | **60** | ≈60 tests API + 35 tests `preview-builder`, gates et hook pre-commit. En recul : **aucune CI**, couverture absente sur la page hôte du preview, le contrat SSE et les accès inter-locataires ; et **aucune exécution possible dans cette session**, donc l'état de passage réel est inconnu |
| **Documentation & traçabilité** | 8 % | **70** | `RELEASE-POLICY`, ADR, audits successifs, décisions explicitées dans le code, journaux d'audit applicatifs. En recul : documentation contredisant le runtime (`dist/` sans parité source), plusieurs copies de référence dans le dépôt, pas de versionnage d'API |

*Note globale = moyenne pondérée des dimensions ci-dessus (≈54, arrondie à 55 en tenant compte de la trajectoire : deux audits menés, décisions de sécurité déjà prises et documentées).*

---

## Ce qui explique la note (les 3 causes réelles)

1. **L'intention est bonne, l'application a des trous.** Les contrôles sont pensés puis contournés par un détail : `npm run` est bloqué *au motif de la RCE*, mais `npm test` — équivalent — reste autorisé ; l'iframe du preview est sandboxée sans `allow-same-origin`, mais un bouton ouvre le même contenu en onglet ; le garde-fou d'authentification couvre `/api`, pas `/preview-bundle`.
2. **Une couche manquante, pas un mauvais code.** Sans la Preview Gateway (origine dédiée + CSP + contrôle réseau), beaucoup de défauts du preview restent ouverts par construction — quel que soit le runtime choisi ensuite.
3. **Accumulation.** Deux sauvegardes complètes du projet, archives `*.zip`, fichiers `*.bak`, code legacy inatteignable, `dist/` exécuté sans source correspondante : c'est ce qui donne l'impression de désordre et ce qui rend la « version de référence » difficile à identifier.

---

## Ce qui ferait monter la note (effet estimé)

| Action | Effort | Effet estimé sur la note |
|---|---|---|
| **Lot 0** — fermer l'exposition : PV-01, PV-02, PV-03, SEC-01, SEC-03, SEC-04, SEC-05, SEC-06 | < 2 jours | **55 → 68** (dimension Sécurité : 45 → 65) |
| **Lot 1** — fiabiliser : SSE terminal, verrou + bascule atomique de build, timeouts IA, undo, VFS (plafonds/persistance), réparation ciblée | 1–2 semaines | **68 → 78** (Robustesse : 45 → 65) |
| **Lot 2** — viser la cible : Preview Gateway → contrat `PreviewRuntime` → dev server + HMR → remontée des logs → spike runtime cloud → mocks/BDD | 1–2 mois | **78 → 88** (Preview : 40 → 75) |
| **Transverse** — CI bloquante (typecheck, tests, audit, secrets, SAST), nettoyage sauvegardes/archives, parité `dist/` ↔ sources | en continu | **+3 à +5** (Tests : 60 → 80, Doc/exploitation) |

**Le plafond réaliste est ~90/100, pas 100** : la cible que vous décrivez (WebContainers ou MicroVM, runtime full-stack, limites de ressources) reste un chantier de plusieurs mois, et certaines dépendances (Playwright, Vite dans le processus) demandent des choix d'infrastructure, pas seulement du code.

---

## Limites de cette note

- **Aucune exécution** n'a été possible : ni `npm run typecheck`, ni tests, ni build, ni navigateur. Les dimensions « Tests » et « Robustesse » sont donc évaluées sur la lecture, pas sur le comportement observé — elles pourraient être **meilleures** (si tout passe) ou **pires** (si des tests échouent déjà).
- La sécurité est notée **indépendamment du modèle de menace** ; en usage strictement local et mono-utilisateur, l'exposition réelle est plus faible (voir les deux contextes ci-dessus).
- Les notes par dimension sont une **convention de lecture** pour prioriser, pas une mesure scientifique.
