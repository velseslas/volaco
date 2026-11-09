# RAPPORT D'AUDIT — Intégration MCP Admin/User ↔ backend sécurisé (Lots A/B)

**Dépôt** : `Y:\` (volaco-core) — **HEAD audité** : `2ddba38` (chaîne attendue : UI-MCP `7383b30` → GATE-01 `30baad0` → rapport clôture `2ddba38`)
**Date** : 2026-11-09 — **Working tree au début** : propre (0 modification).
**Missions de référence** : Lot UI-MCP `7383b30`, clôture A+B `30baad0`/`2ddba38` (verdict GO sous 4 conditions).

---

## 0. Méthode et périmètre d'audit

- **Aucune modification produit** : `dist/`, `.env`, `.volaco-data`, `.tmp-lot8-build` intacts ; serveur réel **PID 27344 / port 3000 / health 200** jamais arrêté, redémarré ou sollicité (0 requête vers :3000 pendant l'audit).
- **Exécution des suites** : build TypeScript temporaire `.tmp-audit-dist` (EXIT 0) — base d'exécution des tests uniquement, supprimée en fin d'audit.
- **Environnement isolé** : serveur portable `127.0.0.1:3213`, data dir `Temp\opencode\audit-mcp-server-data` (données de test jetables), keyring de test `VOLACO_MCP_REMOTE_KEY_ID=audit-mcp-ui-v1` + clé 32 octets générée en mémoire **jamais affichée ni persistée**, `--env-file=.env` **en lecture seule** (secret JWT réel lu, jamais installé ni publié).
- **Preuves navigateur** : onglet réel sur l'instance 3213, interactions via événements DOM réels (clics natifs du harnais inopérants sur cette app — `UnknownVizError` — remplacés par `element.click()` effectifs), réponses API lues **depuis le navigateur** (token de session réel) ; **zéro donnée fictive** présentée comme réelle : chaque figure affichée a été réconciliée avec la réponse API correspondante.
- **Interdictions respectées** : pas de Lot C/D, pas d'activation/publication du secret JWT, pas de push (0 remote), aucun correctif appliqué.

---

## 1. PHASE 1 — CARTOGRAPHIE (UI → API → service → stockage)

### 1.1 Front (Studio)

| Vue | Fichier | Greffon | Appels |
|---|---|---|---|
| User Hub `#mcphub` | `mcp-user-hub.js` (L7–L388) | `index.html` L3361 `mcpUserHubMount` (vue `view-mcphub` L3348) | `GET /api/v1/mcp/catalog` (L39/L227), `GET /api/v1/mcp-remote/connectors?scope=mine` (L40/L261), `POST /catalog/:id/activation` (L9/L298), `DELETE /catalog/:id/activation` (L12/L298), imports perso CRUD `POST/PATCH/DELETE/POST-test /api/v1/mcp-remote/connectors[...]' (L323/L343/L368/L388) |
| Admin `#mcpadmin` | `mcp-admin.js` (L7–L439) | `index.html` L3379 `mcpAdminMount` (vue `view-mcpadmin` L3366) | `GET admin/stats` (L7), `GET/POST/PATCH admin/catalog` (L11–L13), `POST /:id/status` (L14), `DELETE /:id` (L16), `POST /:id/test` (L17), `GET /:id/history` (L18) |
| Menu | `index.html` L1168 (`menuNav-mcphub`), L1181 (`menuNav-mcpadmin`), `switchSystemView` L8508/L8548/L8585–8591 | | |

Sécurité DOM : construction exclusive `createElement`+`textContent` (mcp-admin.js L26 ; à l'identique dans `mcp-user-hub.js`) — aucun `innerHTML`, aucun `eval`.

### 1.2 Backend

| Routeur | Fichier | Contraintes |
|---|---|---|
| Catalogue | `apps/api/src/routes/mcp-catalog.ts` — enregistré `apps/api/src/server.ts` L562 | `MCP_CATALOG_MANAGE` (L425/451/482/496/528/547/L567+) sur toute surface admin ; `MCP_REMOTE_INVOKE` + `userId` requis (L350–351, L397–398) pour activation/désactivation ; création forcée BROUILLON (test ADM-3) |
| Remote | `apps/api/src/routes/mcp-remote.ts` — enregistré `server.ts` L563 | routeur L2157–2294 (`connectors`, `remote-servers`, `journal`, CRUD+`test`), `scope=mine` ; **PAS d'exécution d'outils** (B3, docstring L21) |

### 1.3 Identity, RBAC, auth

- `packages/core/src/identity/permissions.ts` — `MCP_REMOTE_INVOKE` (L17) et `MCP_CATALOG_MANAGE` (L34) = **OWNER+ADMIN** par défaut (L23, L29 ; ENGINEER/VIEWER exclus, réversibles) ; la GESTION des connecteurs reste `TENANT_MANAGE` (OWNER seul, L15).
- `apps/api/src/middleware/auth.ts` — JWT vérifié : tenant/rôle **du token signé** (L58–L84), révocation serveur (L67), `userId` **uniquement** d'un JWT (L13–24, D7) ; clé API = identité partagée **sans `userId`** (L41–47) → fail-closed sur les appels exigeant une identité individuelle ; en production, toute route non publique sans Bearer valide est verrouillée (L119–130) + surface publique minimale (L93–102).
- Signup : **tenant dédié par utilisateur** + rôle OWNER (`packages/core/src/identity/user-store.ts` L97–99 : `tenantId: 'ten-u' + randomBytes(6)`, `role: 'OWNER'`) ; garde-fous : `USERS_MAX` (L87–89), rate limit signup 429 (`routes/auth.ts` L48–59, L152–162), passwords scrypt+sels (L91–101), comparaison timing-safe (L114–122).

### 1.4 Stockage

- `packages/core/src/mcp/catalog/store.ts` — `mcp_catalog` (L150) : catalogue **GLOBAL sans tenant_id** (commentaire L10–12) ; entrées publiées décrites sans secret ; **contrôle de dépendance à la suppression** (L500–512 : refus 409 tant que des instances d'activation existent ; compteur L592–593).
- `packages/core/src/mcp/remote/store.ts` — `mcp_remote_connectors` (L123–146) : PK **(tenant_id, connector_id)**, index tenant/scope/owner, `secret_ciphertext` (L99/L135), requêtes TOUJOURS `tenant_id = ?`, écritures transactionnelles (L15–17) ; `mcp_remote_tool_policies` (L151).
- `packages/core/src/mcp/remote/crypto.ts` — AES-256-GCM, AAD lié **tenant+connecteur** (L2, L15–18), keyring `active`+`previous` pour **rotation** (L44–58), keyId format contraint (L68–74), variables `VOLACO_MCP_REMOTE_KEY[KEY]_ID` (L144–161) ; échecs typés (`DECRYPT_FAILED`…, L32).

### 1.5 Chemins HTTP et STDIO

- HTTP : les deux routeurs ci-dessus + le cycle B3 dans `mcp-remote.ts` (prepare/confirm STORE via `REMOTE_MCP_CONFIRM*`, imports L80–81) — **aucun `tools/call` HTTP direct** en B3.
- STDIO : `packages/core/src/mcp/{client.ts, protocol.ts, project-server.ts, browser-server.ts}` (4 fichiers présents, audit précédent 118/118 + STDIO 6/6 reconstitués, rapport `2ddba38`).

---

## 2. PHASE 2 — AUDIT ADMIN

**Preuve de base (API)** : suite `mcp-catalog-admin.test.ts` — **14/14 verts** (instance isolée, log `Temp\opencode\audit-ph2345.txt`, exécution 65/65 au total).

| Contrôle | Résultat | Preuve (test) | API | Risque / GRAVITÉ / Action | Classement |
|---|---|---|---|---|---|
| Création d'entrée | OK | ADM-1 (OWNER et ADMIN 200/201), ADM-3 (BROUILLON forcé, rien ne naît publié), ADM-4 (URL SSRF refusée, champs requis, mass-assignment rejeté) | `POST /api/v1/mcp/admin/catalog` | faible | KEEP |
| Modification | OK | ADM-7 (PATCH whitelist, version++, rejet champs inconnus/SSRF) | `PATCH /:id` | faible | KEEP |
| Suppression | OK | ADM-12 (409 `MCP_CATALOG_DEPENDENCY` tant qu'une instance existe, succès ensuite), ADM-13 (404 sans oracle) | `DELETE /:id` | faible | KEEP |
| Cycle de statuts | OK | ADM-5 (transitions serveur), ADM-6 (hors matrice → 409 `MCP_CATALOG_INVALID_TRANSITION`) | `POST /:id/status` | faible | KEEP |
| Test de connexion | OK | ADM-8 (OK → `last_test` persisté + audit), ADM-9 (échec → 200 {ok:false}, code seul) — politique SSRF serveur (docstring mcp-admin.js L17) | `POST /:id/test` | faible (politique réseau vérifiée par tests) | KEEP |
| Découverte d'outils | N/A par design côté admin (aucun endpoint d'exécution) ; couvert côté connecteur par B3/C3.4 | — | — | — | KEEP |
| Journalisation | OK | ADM-10 (opérations réelles auditées) | `GET /:id/history` | faible | KEEP |
| Stats | OK | ADM-11 (chiffres réels) | `GET /admin/stats` | **Voir F-2 (agrégats cross-tenant)** | POLISH |
| Accès direct non-admin | **OK — séparé** | ADM-2 : ENGINEER/VIEWER **403** sur CHAQUE endpoint admin API | tous | sérif ; doublé par la suite `mcp-catalog-separation` (7/7) | KEEP |

**Vérification UI réelle (identité A, OWNER, instance 3213)** — alignée sur les tests :

- Création via `＋ Nouvelle entrée` → **HTTP 200 confirmé**, entrée née `status:"BROUILLON"`, `version:1`, `activationCount:0` (contredire « naît toujours en brouillon » = impossible côté serveur). Après création **la vue ne se rafraîchit pas** (compteurs à 0) — ok après « Actualiser » (F-3).
- `Tester la connexion` sur URL DNS-irrésoluble → statut persisté **FAILED + `DNS_POLICY`**, message **tronqué** + code `MCP_REMOTE_UNREACHABLE` dans la carte ; audit `MCP_CATALOG_TESTED {ok:false, errorCode:"DNS_POLICY"}` visible dans `Dernières opérations`.
- Transitions via UI : `BROUILLON→VALIDATION→PUBLIÉ` (`En validation`→`Publier`) — compteurs et `GET /admin/stats` **toujours cohérents** (2 transitions auditées avec `userId` + `metadata.from/to`).
- `Historique` (UI) == audit trail API : **4 événements** (Création, Test de santé, 2 Changements de statut) avec ids `aud_*`, `requestId`, timestamps. Aucun écart UI/API constaté.

---

## 3. PHASE 3 — AUDIT USER

**Preuve de base (API)** : `mcp-catalog-user.test.ts` **12/12 verts** + `mcp-catalog-separation.test.ts` **7/7 verts** (refus croisés).

| Contrôle | Résultat | Preuve | Classement |
|---|---|---|---|
| Affichage des serveurs autorisés | OK | USR-1…; UI : catalogue vide → « Aucun connecteur publié » **strictement équivalent** à `GET /mcp/catalog {entries:[]}` (réelles) | KEEP |
| Ajout serveur personnel | OK | UI : formulaire privé (notice « PRIVÉ : … absent du catalogue global » écran) → POST → réponse **sans secret ni ciphertext** (`secretPresent:true`, `secretKeyId` NON secret, `secretEncryptedAt`) | KEEP |
| Modification / suppression de ses serveurs | OK | UI : `Modifier`→PATCH (URL mise à jour, **secret préservé**, champ jamais pré-rempli) ; `Supprimer`→native `confirm()` obligatoire puis disparition (API `scope=mine` réduite) | KEEP (voir F-4) |
| Découverte / consultation | OK | UI : catégories et filtres dérivés des réponses réelles (`audit (1)`) | KEEP |
| Activation / refus | OK | UI : `Activer` → instance `scope:catalolog`+`catalogId` créée (200), `Désactiver` → retour « Activer » + `Activés (0)` ; refus non-owner testé (SEP) | KEEP |
| Confirmation des opérations sensibles | OK | suppression protégée par `confirm()` ; activation/désactivation vérifiées **côté serveur** (`findOwnInstance`, ownership) | KEEP |
| Historique personnel | OK | `GET /api/v1/mcp-remote/journal?limit=50` scoppé utilisateur ; identité B → `{events:[],total:0}` malgré l'activité de A | KEEP |
| Non-accès au catalogue global (modif) | OK | `MCP_CATALOG_MANAGE` OWNER/ADMIN → 403 pour les autres (tests separation) | KEEP |

---

## 4. PHASE 4 — CYCLE D'EXÉCUTION (prepare → confirmation → call)

**Preuves (API, environnement isolé)** — `mcp-remote-b3.test.ts` **19/19**, `mcp-remote-c34.test.ts` **11/11**, `mcp-remote-servers-strict.test.ts` **2/2** (65/65 exécutés en une passe) :

- prepare → permission → confirmation → confirmation valide → exécution → journalisation : **OK** (B3 complet, y compris le refus de `tools/call` HTTP direct — docstring `mcp-remote.ts` L21).
- Confirmation **expirée** et **réutilisée** : refusées (STORE/binding, B3). Changement de **contexte de sécurité** : binding vérifié (B3/C3.4).
- **Refus de permission** : 403 (C3.4).
- **Serveur indisponible**, **timeout**, **erreur HTTP** : typés et audités (C3.4 ; collecte du code seul, message tronqué).
- **SSRF / redirections interdites** : politique réseau serveur sur `POST /:id/test` (ADM-4/7, ADM-9 `DNS_POLICY`).
- **Keyring indisponible** : **preuve HTTP réelle** sur l'instance 3213 démarrée **sans** keyring : `GET /api/v1/mcp/remote-servers` → **503**, `GET /api/v1/mcp-remote/connectors?scope=mine` → **503**, `GET /api/v1/mcp/admin/stats` → **403**, `POST /api/v1/mcp/admin/catalog` → **403** — **aucune fuite de secret dans aucun corps**. Le même serveur redémarré AVEC keyring répond 200 partout (fail-closed prouvé dans les deux sens).

La surface UI n'expose **aucune exécution d'outils** ( B3 par design) — rien à traverser visually ; l'audit du cycle reste un contrôle backend/STDIO (couvert).

---

## 5. PHASE 5 — MULTI-UTILISATEUR

**Identités réelles créées via l'UI d'inscription** (instance isolée, données jetables) :
- A `audit-mcp-owner@test.local` → `usr_1cc2cbdf24c0d962`, **tenant `ten-ub2ffe6c8514c`**, OWNER.
- B `audit-mcp-user@test.local` → `usr_68dc987c98b8b9f6`, **tenant `ten-u875882b35ee5`**, OWNER.

| Contrôle | Résultat | Preuve | GRAVITÉ / Classement |
|---|---|---|---|
| Isolation des serveurs personnels | **OK** | B : `scope=mine` → `[]` ; A l'inverse voit ses 2 (catalog+perso) | — KEEP |
| Accès horizontal bloqué sans oracle | **OK** | B sur les connecteurs de A (`c84f65b8…` activation catalog, `174b09eb…` import perso) : GET/PATCH/DELETE/test → **404 `NOT_FOUND`** uniforme (aucun oracle d'existence) — PK `(tenant_id, connector_id)` + ownership | KEEP |
| Isolation des historiques | **OK** | B : journal `{events:[],total:0}` malgré les opérations de A | KEEP |
| Absence de fuite de secrets | **OK** | réponses `scope=mine` : `secretPresent` booléen, `secret_ciphertext` **absent du corps**, secret en clair **jamais** renvoyé (recherche littérale négative dans le corps) ; catalog : aucun champ secret | KEEP |
| Confusion tenant/utilisateur | **OK** | tenant déduit du JWT signé (middleware L77) ; `findOwnInstance(tenantId,userId)` aux deux dimensions (mcp-catalog.ts L333/L357/L403) | KEEP |
| Accès vertical | **OK** | non-owner → 403 (ADM-2 + separation 7/7) ; repli clé API **sans userId** ne peut pas se faire passer pour un utilisateur (D7) | KEEP |
| Agrégats admin inter-tenant | **Documenté** | F-2 ci-dessous | P3 POLISH |

**Découverte contextuelle (pas une anomalie, à consigner)** : la mesure « tenant de A » depuis l'onglet A avait, après le signup de B, **renvoyé le tenant de B** — cause identifiée : `localStorage` **partagé par origine** entre onglets (le token de B a écrasé celui de A dans TOUT le navigateur). Comportement normal du navigateur, à connaître pour l'exploitation multi-comptes (les deux comptes ne peuvent pas vivre côte à côte dans le même navigateur). Aucun impact serveur.

---

## 6. PHASE 6 — TESTS NAVIGATEUR (instance temporaire isolée :3213)

**Setup** : inscription **via le vrai formulaire** (« Hello! » → `Créer mon compte`), JWT `vibecode_auth_token` émis, `GET /auth/me` OK. Captures mobiles : iframe **390×844** (émulation native indisponible dans ce harnais — fenêtre desktop masquée, `browser.screenshot` bloqué « needs a visible tab ») + rendu `html2canvas` (fallback établi).

### Admin `#mcpadmin` (identité A, OWNER)
- Menu `menuNav-mcpadmin` **visible et cliquable** pour OWNER (flex) ; triys de gouvernance affichés.
- Création (form réel, placeholders vérifiés : « Nom du connecteur », URL `https://api.exemple.org/mcp`) → création **réellement serveur** (réponse 200 capturée) et cycle BROUILLON→VALIDATION→PUBLIÉ complet via boutons ; `stats` == valeurs affichées à chaque étape (0→1)[x].
- Test de connexion échec (DNS_POLICY) : carte « Test récent : échec … (tronqué) (MCP_REMOTE_UNREACHABLE) », compta santé mis à jour (SANTÉ ÉCHECS 1 / JAMAIS TESTÉS 0).
- Historique : rendu == audit API (4 opérations).
- **Mobile 390** : aucun débordement (`scrollWidth 390 ≤ clientWidth 390`), vue lisible, réelles (TOTAL 1/PUBLIÉS 1/ÉCHECS 1). Capture : `Temp\opencode\audit-mcp-mobile-mcpadmin.png`.
- **F-3 (POLISH P3)** : après création, la vue ne se rafraîchit pas automatiquement.

### User `#mcphub`
- État initial **vérifié contre API** (`entries:[]`, `connectors:[]` → libellés « Aucun … ») : zéro donnée fictive.
- Après publication A : l'entrée PUBLIÉ(E) apparaît avec le **badge santé réel hérité du test admin (« Santé : échec »)** ; activation → carte « Activé » + ligne de statut ; désactivation → retour.
- Import personnel : POST→carte « Import perso A / Secret configuré » (booléen, secret jamais affiché) ; PATCH (URL modifiable, secret préservé) ; `Tester` → échec tronqué propre ; DELETE protégé par `confirm()` natif.
- **Mobile 390** : aucun débordement ; capture `Temp\opencode\audit-mcp-mobile-mcphub.png`.
- **F-5 (POLISH P3)** : co-présence de l'ancien panneau flottant « MCP distant » (« Connecteurs MCP distants (C3.2-B4) » + badge « Lecture seule (identité dev) ») avec les nouvelles vues — deux systèmes d'entrée MCP localement, risque de confusion (fermeture testée, aucune interférence bloquante).

### Console et réseau
- **0 erreur et 0 warning** de console sur les deux onglets à la fin de la pase (docs A, B).
- Réponses API toutes réelles (network list + corps), `requestId` systématiques.

### Rapprochement UI/figures/API (zéro donnée fictive)
Chaque figure affichée a été comparée à la réponse API réelle du même instant : compteurs admin (0→1), saya santé, counts hub, listes, historique, journal, `perso` CRUD. Aucun écart constaté ; les seuls écarts relevés sont de convivialité (F-2/F-3/F-5) et narration (F-2b).

---

## 7. PHASE 7 — CONDITIONS RÉSIDUELLES

| # | Sujet | État audité | Condition exacte avant activation / forte charge |
|---|---|---|---|
| R1 | **Keyring MCP distant** | fail-closed 503/403 prouvé ; avec clé → 200 ; AES-256-GCM AAD tenant+connecteur ; rotation prévue (active+previous) | Configurer `VOLACO_MCP_REMOTE_KEY_ID` + `VOLACO_MCP_REMOTE_KEY` (base64 canonique 32 octets) **dans l'environnement cible**, jamais en clair dans le repo ; procédure de rotation = ancienne clé en `previous` pendant la re-chiffrement/ne-tout-casser pas les ciphertexts existants |
| R2 | **Secret JWT cible** | jamais installé (consigne) ; GATE-01 8/8 (exit 1+FATAL, refus non-canonique, `VOLACO_STRICT_AUTH=0` ignoré en production) | Installer le secret **à l'étape d'activation dédiée** ; refuser production sans secret canonique (déjà programmé) ; jamais l'installer pendant un audit |
| R3 | **Famille bundle (15)** | 1:1 avec la référence culture préalable (clôture A+B) ; fragilité de barometre, sans cause MCP | Surveiller au Lot suivant ; déterminer cause unique avant activation des slnefers de build |
| R4 | **CAP-01 (P2)** | écriture O(n) ~191 req/s à 15 k projets, migration de schéma requise | Avant TOUTE forte charge : migration de schéma (index/découpage) ; sinon dégradation observable uniquement en charge |
| R5 | **Capacité comptes / rate-limit** | `USERS_MAX` avant hash (L84–89), signup rate-limit 429 (auth.ts L154–162) | Étalonnir `USERS_MAX` vs population cible ; monitorer 429 | KEEP |
| R6 | **Clé API repli** | sans `userId`, fail-closed sur identité individuelle (D7) | Conserver l'interridiction d'utiliser la clé API pour des flux utilisateurs ; tout flux exigeant une identité doit exiger un JWT | KEEP |

---

## 8. MATRICE DES CONSTATS (P0–P3)

Codification : F-n. Gravité et traitements recommandés.

| ID | Constat | Fichier(s):Ligne(s) | API/preuve | GRAVITÉ | Action recommandée |
|---|---|---|---|---|---|
| F-1 | SÉCURITÉ GLOBALE D'ENTRÉES : toutes les surfaces sensibles vérifiées **côté serveur** ; UI cosmétique assumée (boutons sans autorité) ; unknown endpoints 401/403/404 sans oracle ; secrets jamais transportés | `mcp-admin.js` L20–23, `mcp-catalog.ts` L425+, `auth.ts` mix. | tests 65/65 + UI observations | — | **KEEP** |
| F-2 | `admin/stats` `connections` + `personalImports` agrègent **toute l'instance** (cross-tenant), pas le tenant de l'appelant (compteurs seulement, AUCUNE ligne, id, nom ni secret) | `mcp-catalog.ts` L646 `globalAggregateStats()` ; `remote/store.ts` (implémentation) ; UI mcp-admin.js L554 | A (tenant ten-ub2f…) et B (tenant ten-u8758…) — B OWNER voit `personalImports {total:1}` (l'import de A) via `GET /admin/stats` | **P3** (méta-donnée d'activité seulement) | **POLISH** : cadrer la sémantique (statistiques d'instance vs tenant) dans le libellé UI (« instance ») ou scoper au tenant ; à trancher avant exploitation multi-tenant |
| F-2b | Gaugne : « Dernières opérations administratives » inclut `resourceId` + `userId` des **opérations admin globales** (catalogue global — cohérent avec F-1 mais sensibilité à documenter en multi-tenant) | `mcp-catalog.ts` L648–672 | UI == API vérifiés | P3 | POLISH (libeller « catalogue global ») |
| F-3 | Pas de rafraîchissement auto après création admin (compteurs figés jusqu'à « Actualiser ») | `mcp-admin.js` (refresh flow L653+) | UI : compteur 0 après POST 200 une entrée déjà créée | P3 | POLISH (rafraîchir après POST réussi) |
| F-4 | `Supprimer` import perso utilise `confirm()` NATIF (dialog système) tandis que le module a déjà une modale custom (`mcpHubConfirmModal`) | `mcp-user-hub.js` (delete path) | dialog natif intercepté et accepté pendant l'audit | P3 | POLISH (uniformiser l'UX de confirmation) |
| F-5 | Co-présence de deux systèmes MCP dans le shell : panneau flottant legacy « Connecteurs MCP distants (C3.2-B4) » (badge « Lecture seule (identité dev) ») + vues UI-MCP | `apps/studio/mcp-remote.js`, `mcp-hub.js`, bouton `mcpRemoteToggleBtn`; vues `mcp-user-hub.js`, `mcp-admin.js` | navigation réelle : deux entrées « MCP » distinctes | P3 | POLISH (désactiver/linter le panneau legacy ou le clouder dans le hub) |
| F-6 | Signup → **OWNER + tenant dédié** pour tout compte créé (design courant, mono-utilisateur) ; si一所 multi-tenant un jour, un OWNER devrait être **gouverne du catalogue global** partagé (cf. F-2) | `user-store.ts` L97–99 | A/B tenants distincts, OWNER chacun | P2 (conditionnel) | POLISH/POLITIQUE : à goudronner explicitement avant ouverture des inscriptions (aujourd'hui mono-dev) |
| F-7 | `localStorage` partagé par origine : le changement de compte par un second onglet écrase la session du premier (expérience, pas sécurité) | front `index.html` (token en LS) | reproduction documentée §5 | P3 | POLISH (documenter / bannir multi-comptes simultanés) |

**Aucun P0 ni P1 relevé. Aucun BLOCKER.** Les tests adverses (401/403/404/409, SSRF, mass-assignment, réutilisation/expiration de confirmation, révocation JWT, repli sans `userId`) sont tous **verts** (65/65 + reconstitués `2ddba38` 118/118 + STDIO 6/6).

## 9. CLASSEMENTS SYNTHÉTIQUES

- **KEEP** (générique): toute la chaîne RBAC + isolation + secrets + audit + fail-closed keyring + cycle B3  → conservation telle quelle.
- **KEEP** (à contrat): STDIO /project-server /browser-server (déjà audités, inchangés au HEAD audité).
- **POLISH**: F-2 (sémantique agrégats), F-2b (règles de sensibilité d'affichage), F-3 (rafraîchi), F-4 (modale), F-5 (coexistence legacy), F-6 (politique OWNER au signup), F-7 (usage multi-comptes navigateur).
- **REFACTOR**: — (rien NecD)
- **BLOCKER**: — aucun.

---

## 10. VERDICT : **GO SOUS CONDITIONS**

L'intégration UI-MCP (`7383b30`) ↔ backend sécurisé A/B est **conforme aux contrats** : OAuth des contrôles frontaux traçables aux endpoints vérifiés côté serveur, séparation admin/user réelle, isolation utilisateur+tenant démontrée par tests et par navigation multi-identités, secrets chiffrés jamais exposés, journal/audit exhaustif, fail-closed cohérent partout (503/403 sans keyring).

**Conditions (rappel, inchangées + cadres) :**
1. R1 keyring cible configuré (et procédure de rotation documentée) avant tout usage MCP distant réel.
2. R2 secret JWT installé **seulement** pendant l'activation dédiée de l'environnement (jamais pendant un audit).
3. R3 surveiller la famille bundle (15) au Lot suivant (non bloquant pour MCP).
4. R4 CAP-01 traité par migration de schéma avant forte charge.
5. CONDITIONS NOUVELLES (issues de l'audit, non bloquantes, à intégrer dans les lots suivants) : F-2/F-2b (sémantique des agrégats d'instance vs tenant), F-6 (politique explicite OWNER/tenant au signup avant ouverture multi-tenant), F-5 (sortir/clarifier le panneau legacy C3.2-B4).

---

## 11. ARTÉFACTS D'AUDIT (hors produit, Temp)

- `Temp\opencode\audit-ph2345.txt` — log node:test des 65 tests (Phases 2/3/4/5).
- `Temp\opencode\audit-ui-server.log` — log serveur isolé (:3213, deux phases avec + sans keyring).
- `Temp\opencode\audit-mcp-mobile-mcpadmin.png`, `audit-mcp-mobile-mcphub.png` — captures 390px.
- Répertoires supprimés en fin d'audit : `.tmp-audit-dist`, `audit-mcp-data`, `audit-mcp-server-data` (+ comptes de test jetables).
- Serveur réel : **27344 / :3000 / health 200, jamais touché** ; `dist/`, `.env`, `.volaco-data`, `.tmp-lot8-build` intacts ; working tree propre à la sortie (ce rapport est le seul fichier ajouté, **non committé** — en attente d'autorisation).

*Rapport préparé par l'agent d'audit (lecture seule). Tout correctif est hors mandat — attente d'autorisation d'implémentation.*
