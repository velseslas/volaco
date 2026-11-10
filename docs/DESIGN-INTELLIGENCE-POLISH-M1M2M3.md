# RAPPORT D'IMPLÉMENTATION — Design Intelligence POLISH M-1 / M-2 / M-3 (CDC V8.0)

**Dépôt** : `Y:\` — **Date** : 2026-11-10 — **Origine** : audit de conformité CDC V8.0 (verdict GO, 3 constats POLISH P3) + autorisation « GO ».
**Mode** : implémentations bornées (aucun secret, aucune fonctionnalité hors périmètre, aucun `npm install`, aucun build de production).

---

## 1. Périmètre livré

| ID | Constat (audit) | Section CDC | Livré |
|---|---|---|---|
| **M-1** | L'UI Agent trace le Design DNA mais sans artefact d'explication « Pourquoi » exploitable | §11 | `designRationale` structuré dans le payload `UI_SPEC` + rendu Studio |
| **M-2** | Champs de gouvernance réels mais éparpillés, pas de vue unifiée | §26 | Agrégateur pur `design-governance.ts` + endpoint `GET .../design/governance` + section Studio |
| **M-3** | Tokens affichés/derivés mais pas d'édition fine au Studio | §29 | Éditeur d'affinage par groupe de tokens (8 dimensions §6) dans la carte Design Intelligence |

---

## 2. M-1 — Explication structurée « Pourquoi ce design » (§11)

**Code**
- `packages/core/src/ai-native/ai-orchestrator/agents/ui-agent.ts`
  - `buildDesignRationale(designContext)` — fonction **pure, déterministe** (0 `Math.random`, 0 LLM) exportée ;
  - payload `UI_SPEC.designRationale` ajouté **uniquement** quand `context.designContext` existe (payload historique strictement inchangé sinon) ;
  - champs : `reportId`, `generatedAt`, `overallScore`, `directionSource`, `direction` (8 dimensions §6 connues), `rulesApplied {count, catalogVersion}`, `decisionsRespected`, `correctionsExpected`, `components {catalogVersion, available}` et `reasons[]` — chaînes canoniques « preuve → conséquence UI » bornées à 180 car. :
    - rayon dominant Npx mesuré (tokens de forme) → style ;
    - police primaire + familles inférées → personnalité ;
    - palette (rôles retenus, primaire) → énergie visuelle ;
    - grille de pas Npx → densité (absente si stats DOM absentes : **jamais inventée**) ;
    - règles du catalogue versionné appliquées au markup ;
    - décisions §24 respectées, corrections MEDIUM+ attendues, contrats §9/§10 (aucun composant recréé).

**Studio** — `apps/studio/index.html` (panneau AINT-010) : bloc « Pourquoi ce design (§11) » sous les artefacts d'un run orchestration, affichant rapport, source de direction, dimensions et les raisons échappées.

**Tests** — `packages/core/tests/ai-native/ai-orchestrator/ui-agent-design-aware.test.ts` :
- `6bis` : contenu (chiffres réels du rapport fictif : rayon 10px, primaire `#b45309`, catalogue 1.0.0, 1 correction HIGH) + **déterminisme** (2 exécutions → `reasons` identiques) ;
- `6ter` : sans `designContext` → **aucune** clé `designRationale`/`designAware` (non-régression stricte).

---

## 3. M-2 — Ledger unifié de gouvernance design (§26)

**Code**
- `packages/core/src/ai-native/design-harmony/design-governance.ts` (nouveau, exporté par l'index) :
  - `buildDesignGovernanceLedger(...)` — **agrégateur PUR** : ne lit que 4 sources réelles (stores injectables pour les tests, défaut = singletons) ;
  - chaque événement porte les **8 attributs §26** : `who`, `what`, `why`, `at` (When), `previous`, `new`, `impact`, `approval` + `id` dérivé de la source, `source`, `status` ;
  - sources : override de direction (§6, upsert `updatedBy/updatedAt`), décisions mémoire (§24 : raison obligatoire, supersession `ACTIVE→SUPERSEDED` avec `supersededBy`), révisions d'amélioration (§29 : delta AQS **extrait** du message canonique `Design Improve — AQS x → y (stop)`), overrides de composants (§9/§10 : raison réelle) ;
  - **honnêteté** : un champ non stocké par la source est `null` (direction = upsert sans historique → `previous/why/impact` null ; message non parsable → deltas null) — aucun chiffre, aucune raison fabriqués ;
  - tri déterministe `at DESC, id ASC` — 0 `Math.random`.
- `apps/api/src/routes/design-surfaces.ts` : `GET /api/v1/projects/:id/design/governance` **additif** (`PROJECT_READ`, même pattern `RequestContext` que les routes voisines) + docstring d'en-tête mise à jour.

**Studio** — section « Gouvernance design (§26) » dans la carte Design Intelligence : compteurs, 20 premiers événements avec badge source/statut, `who · at`, `what`, `Pourquoi : why`, transition `previous → new`, `impact`, `approuvé par approval`.

**Tests** — `apps/api/tests/design-governance-v81.test.ts` (3 cas, style HTTP du dépôt) :
1. parcours réel (PUT direction + mémoire + supersession + DISABLED composant) → les 8 attributs, sources couvertes, compteurs, tri, **2 lectures → mêmes événements** ;
2. agrégateur pur : delta `72→84` = `+12` réellement parsé ; `AQS ? → ?` → `previous/new/impact = null` ; déterminisme `deepEqual` ;
3. aucune donnée → ledger vide, zéro événement fabriqué.

---

## 4. M-3 — Affinage par groupe de tokens (§6/§29)

**Studio uniquement** (le schéma d'override §6 existant suffit — aucun nouveau backend) :
- les **8 dimensions du CDC §6** éditables une à une, regroupées par **famille de tokens** qu'elles gouvernent : Forme (style), Palette (complexité), Espacement (densité), Contenu (densité info), Typographie (personnalité), Ton (professionnalisme), Transitions (mouvement), Accents (énergie) ;
- valeurs strictes du catalogue `design-direction-catalog 1.0.0` (l'autorité de validation reste `normalizeDesignDirectionOverride` côté serveur — toute valeur libre est refusée) ;
- « — dériver — » restaure la dérivation déterministe pour la dimension ;
- **merge client** depuis l'override stocké avant `PUT` (le PUT remplace l'ensemble : aucune dimension fixée n'est perdue silencieusement) ; si plus aucune dimension ne reste → reset explicite (jamais d'override vide persisté) ;
- écriture explicite et approuvée (`approvedBy`), suivie d'un rechargement — aucune modification silencieuse (§21).

---

## 5. Preuve d'exécution

- **Build de test temporaire** `npx tsc -p tsconfig.json --outDir .tmp-go-dist` → **EXIT 0** (supprimé en fin de session — aucun build de production lancé).
- **22 suites `node --test --test-concurrency=1`** en environnement isolé (`VOLACO_AGENT_CHAIN=0`, `VOLACO_STRICT_AUTH=0`, `VOLACO_DATA_DIR` temporaire supprimé) :

```
tests 121 · pass 121 · fail 0 · cancelled 0   (EXIT 0)
```

- 104 tests de **baseline** (20 suites CDC inchangées — zéro régression) + 3 nouveaux (gouvernance) + 14 (UI Agent, dont `6bis`/`6ter`).
- Log : `Temp\opencode\go-impl-tests.txt`.
- Serveur réel **jamais touché** : PID 27344 / port 3000 / `health 200` vérifié avant et après.

## 6. Hors périmètre explicite (honnêteté)

- **Édition token par token de valeurs brutes** (px/couleurs exacts) : non livrée — exigerait un schéma d'override de tokens + persistance + application à la dérivation, non approuvé dans ce lot. L'affinage M-3 travaille **au niveau des dimensions §6** qui pilotent ces familles de tokens, en réutilisant le schéma existant (décision retenue dans le plan).
- Aucun secret installé, aucun Lot C/D, aucune écriture hors des routes design autorisées.

## 7. Artefacts de session

- Rapports d'audit (déjà commités dans `dfec80e`) : `cdc-v8-conformity-audit.md`, `mcp-integration-audit-report.md`.
- Ce rapport : `docs/DESIGN-INTELLIGENCE-POLISH-M1M2M3.md`.
- Working tree : 2 fichiers de debris **non créés par cette session** (sorties `git diff` avec redirections corrompues, noms `coresrcai-nativedesign-harmonydesign-context.ts` et `ult = Select-String …`) — laissés en place, à confirmer/supprimer par l'utilisateur.
