# LOT 02 — RAPPORT D'IMPLÉMENTATION : CANONICAL APPLICATION MODEL & CONTRACT

**Date :** 14 Septembre 2026  
**Auteur :** Ingénieur Principal Volaco Core  
**Contexte :** CDC VOLACO — V7 + V8.1 UNIFIED FINAL  
**Statut :** IMPLÉMENTATION COMPLÈTE ET VÉRIFIÉE  

---

## 1. ÉTAT INITIAL

Avant le LOT 02, l'état applicatif dans Volaco Core était fragmenté entre plusieurs modèles partiels non unifiés :
- `ApplicationRevision` (dans `packages/core/src/model/revision.ts`) : focalisé sur l'arborescence physique des fichiers et le chaînage des révisions.
- `ApplicationDNA` (dans `packages/core/src/ai-native/dna/types.ts`) : heuristiques d'analyse statique (pile, couches, métriques de graphe) sans persistance durable (cache RAM uniquement).
- `ApplicationSemanticModel` (dans `packages/core/src/ai-native/application-understanding/types.ts`) : modèle sémantique inféré par raisonnement (domaines, fonctionnalités, règles métier) sans persistance durable.
- `ProjectStateSummary` (dans `packages/core/src/project-state/types.ts`) : vue opérationnelle pour le dashboard et le workspace.
- `TechnicalDecision`, `ArchitecturalDecisionRecord` et `DecisionRecord` : définitions dispersées et non coordonnées.
- Aucun mécanisme de verrouillage de version optimiste (`modelVersion`) n'existait pour prévenir les conflits de concurrence entre agents IA ou entre un agent et l'utilisateur.

---

## 2. PROBLÈMES TROUVÉS

1. **Fragmentation et ambiguïté :** Aucun conteneur racine canonique ne fédérait l'ensemble des connaissances applicatives.
2. **Absence de persistance unifiée :** Seules les révisions de fichiers étaient persistées sur disque (Lot 01) ; le modèle sémantique et le DNA devaient être recalculés à chaque redémarrage.
3. **Absence de contrôle de concurrence optimiste :** Risque de modifications concurrentes silencieuses où un agent écrit par-dessus les changements d'un autre.
4. **Indifférenciation de versioning :** Pas de découplage explicite entre `schemaVersion` (structure contractuelle du schéma) et `modelVersion` (évolution incrémentale de l'application).
5. **Absence de validation déclarative des invariants :** Aucune barrière formelle n'empêchait l'introduction de configurations de routes incohérentes ou de fuites de secrets dans l'état applicatif.

---

## 3. ARCHITECTURE RETENUE

Une architecture en couches strictes centrée sur un contrat canonique unique :

```text
                  API Routes (apps/api/src/routes/application-model.ts)
                                           │
                                           ▼
                 ApplicationModelStore (packages/core/src/model/application-model/store.ts)
                                           │
                 ┌─────────────────────────┼─────────────────────────┐
                 ▼                         ▼                         ▼
      ApplicationModelValidator   SchemaMigrationEngine   ApplicationModelAdapters
                 │                         │                         │
                 └─────────────────────────┼─────────────────────────┘
                                           │
                                           ▼
             DurableApplicationModelRepository (application_models.json, versions.json)
                                           │
                                           ▼
                  DurableFileStorage (.volaco_data/ via écritures atomiques)
```

### Principes architecturaux appliqués :
1. **Contrat Canonique Fortement Typé :** `ApplicationModel` rassemble toutes les facettes (metadata, identity, product, stack, architecture, structure, pages, routes, components, dataModel, apis, businessRules, permissions, integrations, designSystem, runtime, tests, dependencies, constraints, invariants, technicalDebt, dna).
2. **Découplage `schemaVersion` vs `modelVersion` :** Le schéma de données évolue selon un cycle sémantique (`"1.0"`, `"1.1"`), tandis que le modèle applicatif s'incrémente de manière strictement séquentielle (`1, 2, 3...`) à chaque mutation.
3. **Concurrence Optimiste (Optimistic Locking) :** Toute tentative d'écriture fournissant un `expectedModelVersion` qui ne correspond pas à la version courante est immédiatement rejetée avec un `ConflictError` (HTTP 409).
4. **Validation Systématique :** Aucune mutation n'est enregistrée sans passer avec succès la suite complète de contrôles de `ApplicationModelValidator` (structure, cohérence, sécurité/secrets, architecture/cycles, design system, invariants actifs).
5. **Traçabilité par ChangeSet & Provenance :** Chaque incrément de version capture un snapshot complet `ApplicationModelVersion` avec le `ChangeSet` (added, modified, removed, impacted) et la `ModelProvenance` (acteur, requestId, motif, timestamp).
6. **Persistance Durable Sans Moteur Parallèle :** Réutilisation stricte de `DurableFileStorage` écrivant dans `.volaco_data/application_models.json` et `.volaco_data/application_model_versions.json`.
7. **Isolation Multi-Tenant Hermétique :** Cloisonnement strict garanti par la clé composite `${tenantId}:${projectId}`.

---

## 4. SCHÉMA FINAL

Le contrat canonique est défini dans `packages/core/src/model/application-model/types.ts` :

```typescript
export interface ApplicationModel {
  readonly metadata: ModelMetadata;
  readonly identity: ModelIdentity;
  readonly product: ModelProduct;
  readonly stack: ModelStack;
  readonly architecture: ModelArchitecture;
  readonly structure: ModelStructure;
  readonly pages: readonly ModelPage[];
  readonly routes: readonly ModelRoute[];
  readonly components: readonly ModelComponent[];
  readonly dataModel: ModelDataModel;
  readonly apis: readonly ModelApiEndpoint[];
  readonly businessRules: readonly ModelBusinessRule[];
  readonly permissions: ModelPermissions;
  readonly integrations: readonly ModelIntegration[];
  readonly designSystem: ModelDesignSystem;
  readonly runtime: ModelRuntime;
  readonly tests: ModelTests;
  readonly dependencies: ModelDependencies;
  readonly constraints: ModelConstraints;
  readonly invariants: readonly ModelInvariant[];
  readonly technicalDebt: readonly ModelTechnicalDebt[];
  readonly dna: ModelDNASlice;
  readonly customExtensions?: Readonly<Record<string, unknown>> | undefined;
}
```

Snapshot de version :
```typescript
export interface ApplicationModelVersion {
  readonly id: string;
  readonly applicationModelId: string;
  readonly projectId: string;
  readonly tenantId: string;
  readonly version: number;
  readonly schemaVersion: SchemaVersionString;
  readonly parentVersionId?: string | undefined;
  readonly sourceRevisionId?: string | undefined;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly changeSet: ChangeSet;
  readonly provenance: ModelProvenance;
  readonly validationStatus: 'VALID' | 'WARNINGS' | 'INVALID';
  readonly snapshot: ApplicationModel;
}
```

---

## 5. FICHIERS CRÉÉS

1. `security-audit/architecture/LOT-02-AUDIT.md` : Rapport exhaustif d'audit préliminaire (Phase 1).
2. `packages/core/src/model/application-model/types.ts` : Définitions et contrats TypeScript stricts de l'Application Model canonique, des versions, change sets, invariants, provenance et métadonnées.
3. `packages/core/src/model/application-model/validator.ts` : Moteur de validation multi-axes (structurel, cohérence, sécurité et détection de secrets, absence de cycles architecturaux, design tokens, vérification des invariants actifs).
4. `packages/core/src/model/application-model/migration.ts` : Moteur de migration de schéma déterministe et idempotent (v1.0 -> v1.1) préservant les extensions personnalisées.
5. `packages/core/src/model/application-model/repository.ts` : `DurableApplicationModelRepository` persistant les modèles et historiques de versions dans `.volaco_data/` via `DurableFileStorage`.
6. `packages/core/src/model/application-model/store.ts` : `ApplicationModelStore` gérant l'auto-initialisation par défaut, le verrouillage de version optimiste, les propositions/applications de changement et le rollback non destructif.
7. `packages/core/src/model/application-model/adapters.ts` : Adaptateurs de rétrocompatibilité bidirectionnels avec `ApplicationRevision`, `ApplicationDNA` et `ApplicationSemanticModel`.
8. `packages/core/src/model/application-model/index.ts` : Module d'exportation unifié du sous-système application-model.
9. `apps/api/src/routes/application-model.ts` : Routeur HTTP REST exposant les points d'accès `/api/v1/projects/:projectId/application-model*` avec contrôle RBAC, extraction du contexte d'authentification et journalisation d'audit.
10. `apps/api/tests/lot02-application-model.test.ts` : Suite de tests automatisés couvrant les 8 axes obligatoires du lot (22/22 tests passants).
11. `security-audit/architecture/LOT-02-IMPLEMENTATION.md` : Le présent rapport final de mise en œuvre.

---

## 6. FICHIERS MODIFIÉS

1. `packages/core/src/errors.ts` :
   - Ajout du code d'erreur standard `'CONFLICT'` dans `ErrorCode`.
   - Exportation de la classe `ConflictError` (HTTP 409) pour la gestion formelle des conflits de concurrence optimiste.
2. `packages/core/src/repository/index.ts` :
   - Déclaration de l'interface contractuelle `IApplicationModelRepository`.
3. `packages/core/src/index.ts` :
   - Re-exportation des types, validateur, moteur de migration, adaptateurs et store du modèle canonique.
4. `apps/api/src/server.ts` :
   - Activation de la persistance durable pour `applicationModelStore.enableDurablePersistence()`.
   - Enregistrement du routeur `handleApplicationModelRoutes` avec émission d'événements d'audit sécurisés.

---

## 7. FICHIERS SUPPRIMÉS

**0 fichier supprimé.**  
Aucun composant existant n'a été détruit, conformément à la règle stricte de rétrocompatibilité et de non-régression.

---

## 8. DÉCISIONS ARCHITECTURALES

1. **Auto-initialisation transparente :** Lorsqu'un projet existant est sollicité pour la première fois sans enregistrement préalable de modèle canonique, `ApplicationModelStore` synthétise automatiquement un modèle v1.0 par défaut valide avec un premier snapshot de version, garantissant qu'aucune requête ne rencontre d'état indéfini.
2. **Rejet strict sans écrasement (Optimistic Locking) :** Si `expectedModelVersion` est fourni et diffère de la version courante, l'opération est refusée immédiatement avec `ConflictError` (HTTP 409). Les agents IA et le Studio sont ainsi contraints de relire l'état frais avant de soumettre une nouvelle proposition.
3. **Rollback par nouvelle version :** Tout comme dans `RevisionStore` (CORE-007), le rollback ne détruit jamais l'historique : il génère une version N+1 qui restaure l'état du snapshot cible avec provenance `SYSTEM_REPAIR`.
4. **Défense en profondeur anti-secrets :** Le validateur sérialise le modèle et le confronte à des expressions régulières détectant les clés privées, les jetons JWT, les clés API de services tiers et les mots de passe avant toute écriture en base.
5. **Invariants exécutables :** Les invariants déclarés dans `model.invariants` sont vérifiés par code par le validateur (ex: règles d'authentification sur les routes, appartenance des entités de données au locataire courant).

---

## 9. STRATÉGIE DE MIGRATION

- Découplage complet de `schemaVersion` (ex: `"1.0"`) et `modelVersion` (ex: `1, 2, ...`).
- Implémentation du moteur `SchemaMigrationEngine` :
  - Support de migration de `"1.0"` vers `"1.1"` enrichissant le modèle avec les structures avancées de design tokens (`shapeTokens`, `elevationTokens`) et les métadonnées d'invariants.
  - Idempotence garantie : migrer un modèle déjà en version `"1.1"` retourne l'objet intact sans duplication.
  - Préservation intégrale des propriétés non standards (`customExtensions`).

---

## 10. STRATÉGIE DE COMPATIBILITÉ

| Module | Décision | Implémentation |
| :--- | :--- | :--- |
| `ApplicationRevision` (FND-004) | **KEEP** | Reste le moteur sous-jacent de suivi physique des fichiers. Lié au modèle par `sourceRevisionId`. Adaptable via `applicationModelAdapters.fromRevision()`. |
| `ApplicationDNA` (AINT-002) | **ADAPT** | Conservé pour l'extraction AST statique. Ses informations alimentent la tranche `dna` et les sections `stack`/`architecture` via `fromDNA()`. |
| `ApplicationSemanticModel` (AINT-008) | **ADAPT** | Conservé pour l'inférence sémantique profonde. Alimente `components`, `apis` et `businessRules` via `fromSemanticModel()`. |
| `ProjectStateSummary` (CAPP-004) | **KEEP** | Préservé pour le dashboard et l'état opérationnel du workspace. |
| Synthèse canonique | **ADAPT** | La méthode `applicationModelAdapters.synthesizeCanonicalModel()` permet de fusionner des fragments hétérogènes en un `ApplicationModel` canonique unifié. |

---

## 11. TESTS RÉALISÉS

Suite dédiée créée dans `apps/api/tests/lot02-application-model.test.ts` comportant 22 tests unitaires et d'intégration :
1. **Contrat canonique et cycle de vie :** Initialisation par défaut, validation, incrément de version N+1, snapshot, chaînage parent-enfant, rollback historique.
2. **Isolation hermétique multi-tenant :** Deux locataires avec le même identifiant de projet possèdent des modèles, versions et historiques complètement étanches.
3. **Concurrence et verrouillage optimiste :** Rejet avec `ConflictError` (HTTP 409) sur version obsolète dans `applyChange` et `proposeChange`.
4. **Moteur de migration de schéma :** Migration v1.0 -> v1.1 déterministe, idempotente et sans perte d'extensions personnalisées.
5. **Intégrité et invariants :** Détection de routes dupliquées, cycles de dépendances de couches, violation d'invariants `AUTHENTICATION`.
6. **Sécurité et protection des secrets :** Blocage des clés privées, jetons JWT, clés API, mots de passe, affectations de valeurs dans `envVarsDeclared`, et rôles invalides.
7. **Adaptateurs de compatibilité :** Conversion d'`ApplicationRevision` en fragment de modèle et synthèse multi-sources.
8. **Endpoints REST API & RBAC :**
   - `GET /api/v1/projects/:projectId/application-model` -> 200
   - `POST /api/v1/projects/:projectId/application-model/changes` -> 201
   - Concurrence sur l'API -> 409 Conflict
   - Contrôle d'accès RBAC (VIEWER rejeté sur les modifications) -> 403 Forbidden
   - Isolation inter-locataires sur l'API -> 404 Not Found

---

## 12. RÉSULTATS DE VALIDATION ET NON-RÉGRESSION

| Vérification | Statut | Résultat |
| :--- | :--- | :--- |
| **TypeScript Strict** (`tsc --noEmit`) | **PASS** | 0 erreur |
| **Production Build** (`tsc`) | **PASS** | Compilation réussie dans `dist/` |
| **Dedicated Tests LOT 02** | **PASS** | 22 / 22 passants (100%) |
| **Quality Gate 1** (9 suites historiques) | **PASS** | 31 / 31 passants (100%) |
| **Quality Gate 2** (Phase 2 Core) | **PASS** | 1701 / 1701 passants (100%) |
| **P6 Security Suite** (Red-team) | **PASS** | 103 / 103 passants (100%) |
| **P7 Security Suite** (Hardening & Type confusion) | **PASS** | 156 / 156 passants (100%) |
| **P8 Security Suite** (Global Red Team & SSRF) | **PASS** | 37 / 37 passants (100%) |
| **Parité Studio** (`apps/studio/index.html` vs `volaco_studio.html`) | **PASS** | 100% synchronisé byte-for-byte |

---

## 13. RISQUES RÉSIDUELS

- **Migration volumique d'anciens historiques :** Les anciens projets sans `application_models.json` sont initialisés à la volée en version 1 lors du premier appel, ce qui élimine tout risque de rupture sans nécessiter de script de migration à froid bloquant.
- **Taille de l'historique sur projets massifs :** Si un projet effectue des milliers de mutations, le fichier `application_model_versions.json` grossira proportionnellement. Une stratégie d'archivage ou de compactage pourra être envisagée dans un lot ultérieur d'optimisation sans impacter le contrat actuel.

---

## 14. ÉLÉMENTS VOLONTAIREMENT REPORTÉS

Conformément à la consigne explicite du CDC (Section 18 « CE QU'IL NE FAUT PAS FAIRE ») :
- Le nouveau Conversation Compass n'a pas été construit.
- Le moteur Plan First n'a pas été construit.
- Le nouvel Agent Runtime n'a pas été construit.
- Le Design Critic et le Quality Engine complet n'ont pas été construits.
- Aucun fournisseur IA supplémentaire n'a été ajouté.
- L'arborescence UI du Studio n'a pas été refaite au-delà des contrats nécessaires.
- Les anciens modules n'ont pas été supprimés.

---

## 15. VERDICT FINAL OBLIGATOIRE

```text
LOT 02 — FINAL STATUS

Application Model: PASS
Canonical Contract: PASS
Persistence: PASS
Versioning: PASS
Schema Migration: PASS
Validation: PASS
Provenance: PASS
Tenant Isolation: PASS
Concurrency: PASS
Compatibility: PASS

Dedicated Tests: 22/22
TypeScript: PASS
Production Build: PASS
Gate 1: 31/31
Gate 2: 1701/1701
P6: 103/103
P7: 156/156
P8: 37/37

OUT-OF-SCOPE CHANGES: 0 expected

FINAL VERDICT:
READY FOR LOT 03
```
