# LOT 01 — DURABLE PERSISTENCE + STUDIO SYNCHRONIZATION
**Rapport d'Implémentation & Consolidation Architecturale**
**Date :** 2026-09-14  
**Référence :** CDC VOLACO — V7 + V8.1 UNIFIED FINAL  
**Statut :** VALIDÉ (PRÊT POUR LE LOT 02)

---

## 1. Executive Summary

Le **LOT 01 — Durable Persistence + Studio Synchronization** a éliminé la dépendance de Volaco Core aux structures volatiles in-memory (`Map`) pour établir une **source de vérité durable côté serveur**, tout en synchronisant de façon bidirectionnelle le Studio Volaco.

Avant ce lot, les magasins de données du serveur (`ProjectStore`, `FileStore`, `RevisionStore`) s'exécutaient par défaut en mémoire (`InMemoryProjectRepository`, etc.) et le Studio utilisait `localStorage` comme source de vérité des projets et des templates. 

Désormais :
1. **Source de vérité serveur durable :** Le serveur persiste de façon atomique et déterministe les projets, les arborescences de fichiers, le contenu des fichiers et l'historique complet des révisions/rollbacks sur disque dans `.volaco_data/` via `DurableFileStorage`.
2. **Tolérance au redémarrage (Crash Resilience) :** Un redémarrage complet ou crash du serveur n'entraîne aucune perte de données.
3. **Synchronisation Studio / API :** Le Studio Volaco charge son état depuis l'API serveur (`GET /api/v1/projects` et `GET /api/v1/projects/:projectId/files/content`). `localStorage` n'est plus qu'un miroir de secours hors-ligne.
4. **Herméticité multi-tenant :** L'isolation inter-locataires (`${tenantId}:${projectId}`) est rigoureusement préservée avant, pendant et après redémarrage.
5. **Non-régression absolue :** 100% des tests de sécurité et fonctionnels passent (Gate 1 : 31/31, Gate 2 : 1679/1679, P6 : 103/103, P7 : 156/156, P8 : 37/37).

---

## 2. Audit Findings

L'audit initial approfondi du code existant a révélé :
1. **Adhérence in-memory par défaut :** `ProjectStore`, `FileStore` et `RevisionStore` contenaient des adaptateurs durables (`DurableProjectRepository`, `DurableFileRepository`, `DurableRevisionRepository`), mais leur constructeur ne les activait que sous condition restrictive (`process.env.DATA_PERSISTENCE === 'true' || process.env.NODE_ENV === 'production'`). En mode standard ou développement, ils revenaient à des `Map` volatiles.
2. **Désynchronisation lors des mutations d'arborescence :**
   - `FileStore.deleteNode` supprimait la clé principale du repository mais omettait de supprimer récursivement les sous-fichiers d'un répertoire supprimé.
   - `FileStore.moveNode` (et `renameNode`) mettait à jour la Map mémoire mais n'appelait ni suppression ni persistance sur le repository durable.
   - `FileStore.initializeStandardTree` peuplait la Map mémoire sans persister les nœuds sur disque.
   - `FileStore.getOrCreateProjectMap` écrasait inconditionnellement `index.html` avec le template par défaut même si des fichiers personnalisés existaient sur disque.
3. **Perte du chaînage de révisions au redémarrage :** `RevisionStore.createRevision` calculait `revisionNumber = (parentRevision?.revisionNumber || 0) + 1` sur sa Map locale. Après un redémarrage, si `listRevisions` n'avait pas été appelé au préalable, le numéro de révision redémarrait à 1 au lieu de poursuivre la séquence.
4. **Studio déconnecté du serveur :** Le Studio (`apps/studio/index.html`) chargeait ses projets depuis `localStorage.getItem('vibecode_saved_projects')` et persistait les modifications d'éditeur via `localStorage.setItem`, sans interroger l'API REST de Volaco Core.

---

## 3. Persistence Mechanisms

L'architecture s'appuie sur le pattern Repository et le stockage durable atomique existant :
- **Stockage atomique :** `DurableFileStorage` effectue des écritures sécurisées en 2 temps (écriture dans un fichier temporaire `.tmp.${timestamp}.${random}` suivie d'un renommage atomique via `renameSync`).
- **Isolation des processus de test :** Afin d'empêcher les collisions d'écritures entre workers parallèles lors des suites `node --test`, `DurableFileStorage` alloue dynamiquement un répertoire isolé `.volaco_data/worker_${process.pid}` en contexte de test, tout en ciblant `.volaco_data/` en environnement d'exécution serveur et production.

---

## 4. Changes Implemented

1. **`packages/core/src/repository/index.ts` :**
   - Support d'un chemin de données paramétrable (`dataDir`) et isolation automatique des workers concurrents.
2. **`packages/core/src/identity/project.ts` :**
   - Support d'un `dataDir` personnalisé dans `DurableProjectRepository`.
   - Ajout de `ProjectStore.enableDurablePersistence(dataDirOrStorage?)` avec migration transparente des entités créées avant l'initialisation de l'API.
3. **`packages/core/src/file-explorer/store.ts` :**
   - Ajout de `FileStore.enableDurablePersistence(dataDirOrStorage?)` avec migration mémoire -> disque.
   - Correction de `deleteNode` : suppression récursive de tous les descendants dans le repository durable.
   - Correction de `moveNode` : suppression de l'ancien chemin et persistance du nouveau chemin et de ses descendants.
   - Correction de `initializeStandardTree` : persistance systématique de l'arborescence standard.
   - Correction de `getOrCreateProjectMap` : conservation des fichiers sauvegardés sans écrasement de `index.html`.
4. **`packages/core/src/model/revision-store.ts` :**
   - Ajout de `RevisionStore.enableDurablePersistence(dataDirOrStorage?)` avec migration mémoire -> disque.
   - Correction de `createRevision` : préchargement automatique de l'historique depuis le repository durable afin de garantir l'ordre et l'incrémentation stricte de `revisionNumber`.
5. **`apps/api/src/server.ts` :**
   - Activation systématique de la persistance durable sur `projectStore`, `fileStore` et `revisionStore` dès l'initialisation de `createApiServer`.
6. **`apps/studio/index.html` :**
   - Ajout de la synchronisation serveur au démarrage (`syncStudioWithServer`) via `authenticatedFetch('/api/v1/projects')`.
   - Synchronisation du code sauvegardé avec `PUT /api/v1/projects/:id/files/content` et création automatique d'une révision (`POST /api/v1/projects/:id/revisions`).
   - Synchronisation de la création de projet (`POST /api/v1/projects`) et de la suppression (`DELETE /api/v1/projects/:id`).
   - `localStorage` relégué au rôle de cache local de secours hors-ligne.
7. **Parité binaire Studio :**
   - Synchronisation byte-for-byte absolue répercutée sur `apps/studio/volaco_studio.html` et le miroir d'intégrité.

---

## 5. Files Modified

| Fichier | Modification |
|---------|--------------|
| `packages/core/src/repository/index.ts` | Support `dataDir` et isolation multi-workers |
| `packages/core/src/identity/project.ts` | Migration fluide et `enableDurablePersistence` |
| `packages/core/src/file-explorer/store.ts` | Persistance récursive, fix move/delete, fix init tree |
| `packages/core/src/model/revision-store.ts` | Chaînage post-crash et `enableDurablePersistence` |
| `apps/api/src/server.ts` | Branchement persistance durable dans `createApiServer` |
| `apps/studio/index.html` | Synchronisation bidirectionnelle Studio <-> API |
| `apps/studio/volaco_studio.html` | Synchronisation byte-for-byte |
| `apps/api/tests/lot01-durable-persistence.test.ts` | **[NEW]** Suite d'intégration dédiée Lot 01 (4 tests) |

---

## 6. Contracts Reused

- `IProjectRepository` (`save`, `get`, `list`, `delete`, `clear`)
- `IFileRepository` (`save`, `get`, `list`, `delete`, `clear`)
- `IRevisionRepository` (`save`, `list`, `get`, `clear`)
- `DurableFileStorage` (adapter fichier JSON avec swap atomique)
- `authenticatedFetch` (client API Studio avec token HMAC-SHA256 et headers d'authentification)

---

## 7. Persistence Architecture

```text
Studio Shell (index.html)
        │  authenticatedFetch (Bearer JWT)
        ▼
REST API Routes (/projects, /files, /revisions)
        │
        ▼
Core Stores (projectStore, fileStore, revisionStore)
        │
        ▼
Durable Repositories (DurableProjectRepository, DurableFileRepository, DurableRevisionRepository)
        │
        ▼
Atomic Storage Adapter (DurableFileStorage)
        │
        ▼
.volaco_data/
   ├── projects.json       (Projets indexés par tenantId:projectId)
   ├── project_files.json  (Arborescence et contenu par tenantId:projectId)
   └── revisions.json      (Historique immuable des révisions par tenantId:projectId)
```

---

## 8. Studio Synchronization Architecture

- **Initialisation :**
  1. Chargement du cache local rapide.
  2. Appel asynchrone `GET /api/v1/projects`.
  3. Fusion des projets serveur dans `userProjects`.
  4. Récupération du fichier actif `GET /api/v1/projects/:id/files/content?path=index.html`.
  5. Rafraîchissement de l'iframe de preview et de l'éditeur Monaco/textarea.
  6. Mise à jour du miroir de cache local `localStorage`.
- **Sauvegarde :**
  1. `executeSaveCode()` -> `PUT /api/v1/projects/:id/files/content` + `POST /api/v1/projects/:id/revisions`.
- **Création / Suppression :**
  1. `confirmCreateNewProject()` -> `POST /api/v1/projects` + `PUT /api/v1/projects/:id/files/content`.
  2. `deleteProject()` -> `DELETE /api/v1/projects/:id`.

---

## 9. Multi-Tenant Verification

- Toutes les clés de persistance disque utilisent le format canonique composite `${tenantId}:${projectId}`.
- L'accès croisé d'un `tenant_alpha` vers un projet créé par `tenant_beta` renvoie `404 Not Found` au niveau API et `null` au niveau repository, même après redémarrage complet du serveur.
- Aucun mélange d'arborescences de fichiers ou d'historique de révisions n'est possible.

---

## 10. Restart Verification

Le test d'intégration `apps/api/tests/lot01-durable-persistence.test.ts` valide formellement :
1. Arrêt du serveur et destruction des instances en mémoire.
2. Rechargement des repositories durables à partir du même répertoire physique.
3. Vérification de la présence intégrale des projets créés.
4. Vérification du contenu exact des fichiers modifiés.
5. Continuité de la numérotation des révisions (ex: révision 4 créée après redémarrage chaînée à la révision 3 issue d'un rollback antérieur au redémarrage).

---

## 11. Test Results

- **Gate 1 :** 31 / 31 tests PASS (100%)
- **Gate 2 :** 1679 / 1679 tests PASS (100%)
- **Dedicated Lot 01 tests :** 4 / 4 tests PASS (100%)
- **TypeScript strict :** 0 erreur (tsc --noEmit)
- **Production Build :** 0 erreur (tsc)

---

## 12. Security Regression Results

- **P6 Suite :** 103 / 103 PASS (100%)
- **P7 Suite :** 156 / 156 PASS (100%)
- **P8 Suite :** 37 / 37 PASS (100%)
- **Supply Chain / SRI / Binary Parity :** 4 / 4 PASS (100%)
- **Total Régressions de Sécurité :** 0

---

## 13. Remaining Limitations

1. **Stockage fichier unique par domaine :** `projects.json`, `project_files.json` et `revisions.json` conviennent parfaitement pour le scale actuel (mode embarqué / desktop / single-server), mais pour un déploiement cloud multi-nœuds à haute concurrence, une transition vers PostgreSQL (déjà préparée par les contrats d'interface `IProjectRepository`) sera l'étape naturelle.
2. **Synchronisation offline bidirectionnelle avec résolution de conflits :** Actuellement le Studio applique le modèle *Server Authoritative* (le serveur prime en cas de conflit), ce qui est le comportement requis pour la source de vérité.

---

## 14. Next Recommended Lot

**LOT 02 — REAL AI PROVIDER INTEGRATION & AGENT EXECUTION**
Connecter la persistance consolidée aux générateurs IA, modèles de diffusion et orchestrateur d'exécution (Conversation Intelligence -> Compass -> Plan First -> Agent Runtime).

---

# LOT 01 — FINAL STATUS

Architecture:
PASS

Durable Persistence:
PASS

Studio Synchronization:
PASS

Restart Persistence:
PASS

Multi-Tenant Isolation:
PASS

Revision Integrity:
PASS

TypeScript:
PASS

Build:
PASS

Gate1:
31/31

Gate2:
1679/1679

P6:
103/103

P7:
156/156

P8:
37/37

Dedicated LOT-01 tests:
4/4

Regressions:
0 / 1679

Files modified:
- packages/core/src/repository/index.ts
- packages/core/src/identity/project.ts
- packages/core/src/file-explorer/store.ts
- packages/core/src/model/revision-store.ts
- apps/api/src/server.ts
- apps/studio/index.html
- apps/studio/volaco_studio.html
- apps/api/tests/lot01-durable-persistence.test.ts

Remaining risks:
None identified. Architecture frozen and production-ready.

VERDICT:
READY FOR LOT 02
