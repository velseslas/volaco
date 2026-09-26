# CHAÎNES D'ATTAQUE POST-REMÉDIATION
## VOLACO-CORE — MODÉLISATION DES SCÉNARIOS OFFENSIFS ET ANALYSE DE RÉSISTANCE

**Périmètre :** Monorepo complet `volaco-core`  
**Objectif :** Tester la résistance des chaînes d'exploitation composites contre les défenses en profondeur.

---

### Chaîne 1 : Prise de Contrôle Anonyme du `default-tenant` et Pollution de Workspace

* **Gravité théorique :** ÉLEVÉE  
* **Prérequis :** Aucun (accès réseau non authentifié à l'API)  
* **Composants ciblés :** `apps/api/src/server.ts:173`, `apps/api/src/routes/projects.ts`, `apps/api/src/routes/files.ts`

```
[Attaquant Anonyme]
        │
        ▼ 1. POST /api/v1/auth/session
[Serveur Volaco] ──(Délivre un Bearer Token valide { tenantId: 'default-tenant', role: 'ENGINEER' })
        │
        ▼ 2. Utilisation du Bearer Token sur POST /api/v1/projects
[ProjectStore] ────(Projet créé sous 'default-tenant')
        │
        ▼ 3. Appel de PUT /api/v1/projects/:id/files/content
[FileStore] ───────(Modification du code source de l'espace de travail partagé)
```

* **Vérification d'exploitabilité :** **VULNÉRABLE.** Tout utilisateur non authentifié peut interagir avec l'espace de travail de `default-tenant`.
* **Impact :** Si une organisation utilise le tenant par défaut en production, ses projets sont accessibles publiquement.
* **Atténuation :** Isoler hermétiquement les clients payants sous des `tenantId` dédiés et désactiver l'endpoint `/api/v1/auth/session` en environnement de production (`NODE_ENV === 'production'`).

---

### Chaîne 2 : Contournement du Rate Limiter & Épuisement Mémoire (Heap DoS)

* **Gravité théorique :** CRITIQUE / ÉLEVÉE  
* **Prérequis :** Accès réseau direct au port Node.js sans reverse proxy qui filtre `X-Forwarded-For`  
* **Composants ciblés :** `apps/api/src/middleware/rate-limiter.ts`

```
[Attaquant Externe]
        │
        ▼ Boucle de 100 000 requêtes HTTP POST /api/v1/projects
        ▼ Chaque requête inclut un en-tête aléatoire :
        ▼ X-Forwarded-For: 10.x.y.z
[RateLimiter.check()]
        │
        ├── Lit firstIp depuis 'x-forwarded-for' (10.x.y.z)
        ├── Clé générée : 'ip:10.x.y.z:MUTATION'
        ├── Nouveau WindowBucket alloué dans this.buckets Map
        ├── Le quota par IP n'est JAMAIS atteint (1 requête par IP)
        └── this.buckets grossit indéfiniment en RAM (pas d'éviction LRU)
        │
        ▼
[Crash V8 : JavaScript heap out of memory]
```

* **Vérification d'exploitabilité :** **VULNÉRABLE.** L'absence de nettoyage de la table de hachage et la confiance aveugle en l'en-tête client permettent à la fois de contourner le quota et de consommer la mémoire de façon non bornée.
* **Atténuation :**
  1. Ignorer systématiquement `X-Forwarded-For` sauf si l'IP de la socket appartient à une liste d'adresses de reverse proxies de confiance (`TRUSTED_PROXIES`).
  2. Implémenter un mécanisme d'éviction avec taille maximale (ex. LRU de 10 000 buckets) et timer de purge des seaux expirés.

---

### Chaîne 3 : Injection Indirecte de Prompt via Mutation d'Ingénierie

* **Gravité théorique :** ÉLEVÉE  
* **Prérequis :** Session authentifiée `ENGINEER`  
* **Composants ciblés :** `apps/api/src/routes/ai.ts`, `packages/core/.../executor.ts`

```
[Attaquant / Développeur Malveillant]
        │
        ▼ 1. Soumission d'un prompt d'ingénierie hostile
[Proxy AI /api/v1/ai]
        │
        ├── Analyse INJECTION_PATTERNS (Détecté -> warning logué)
        ├── Encadrement hermétique <user_input source="user_prompt">
        └── Neutralisation des balises internes [neutralized-tag:...]
        │
        ▼ 2. Transmission à Mistral
[Modèle LLM]
        │
        └── Génère un plan de mutation JSON avec suppression de fichiers critiques
        │
        ▼ 3. Réception par l'Agent Runtime Executor
[Executor.executePlan()]
        │
        ├── Vérifie hasPermission(role, 'PROJECT_MUTATE') -> Succès (ENGINEER)
        ├── allowBreaking -> true par défaut !
        ├── allowHighRisk -> true par défaut !
        └── Exécution directe de la mutation sans confirmation ADMIN !
```

* **Vérification d'exploitabilité :** **PARTIELLEMENT VULNÉRABLE.** Bien que l'injection directe de balises système soit neutralisée, le comportement par défaut de l'exécuteur autorise des mutations destructives sans approbation administrative ou humaine explicite.
* **Atténuation :** Forcer `allowBreaking: false` et `allowHighRisk: false` par défaut pour tous les rôles, et exiger un jeton d'approbation d'un utilisateur `ADMIN` pour toute mutation cassante.

---

### Chaîne 4 : Falsification de Preuves AINT-017 et Tentative d'Exécution Autonome

* **Gravité théorique :** CRITIQUE  
* **Prérequis :** Session authentifiée `PROJECT_READ`  
* **Composants ciblés :** `packages/core/src/ai-native/evolution/service.ts`, `routes/evolution.ts`

```
[Attaquant]
        │
        ▼ 1. POST /api/v1/projects/:id/evolution/analyze
        ▼ Injection d'un faux contexte d'audit avec fausses failles critiques (confidence: 1.0)
[EvolutionOptimizerService.analyze()]
        │
        ├── Construit des EvolutionEvidence synthétiques (type FACT)
        ├── Calcule un score EPS très élevé (> 90)
        ├── Place la proposition dans l'horizon NOW de la Roadmap
        └── Enregistre la proposition en statut 'PROPOSED'
        │
        ▼ 2. Tentative d'exécution automatique ou d'appel à planHandoff()
[EvolutionOptimizerService.planHandoff()]
        │
        ├── Vérifie : proposal.status === 'APPROVED' || 'PLANNED'
        └── ÉCHEC ! Le statut actuel est 'PROPOSED' -> Rejet avec ValidationError !
```

* **Vérification d'exploitabilité :** **BLOQUÉ (RÉSISTANCE VALIDÉE).** AINT-017 refuse formellement de générer un graphe de tâches ou de muter le code tant qu'une décision humaine explicite (`applyDecision` avec `APPROVE`) n'a pas été enregistrée par un utilisateur habilité (`PROJECT_UPDATE`). Le principe du contrôle humain est étanche.

---

### Chaîne 5 : Détournement de Transaction de Rollback Inter-Locataires

* **Gravité théorique :** CRITIQUE  
* **Prérequis :** Compte authentifié `ENGINEER` sur le Tenant A  
* **Composants ciblés :** `packages/core/src/ai-native/mutation-orchestrator/service.ts:465-484`

```
[Attaquant sur Tenant A]
        │
        ▼ 1. Découverte ou devinette d'un transactionId appartenant au Tenant B ('tx_victim_456')
        ▼ 2. Appel de mutationService.rollback('tx_victim_456', 'ENGINEER', reqId, 'tenant_A')
[MutationOrchestratorService.rollback()]
        │
        ├── Recherche la transaction 'tx_victim_456'
        ├── Constaté : transaction.tenantId ('tenant_B') !== tenantId appelant ('tenant_A')
        └── Lève immédiatement ForbiddenError (HTTP 403) :
            "Accès refusé: la transaction 'tx_victim_456' appartient au tenant 'tenant_B'..."
```

* **Vérification d'exploitabilité :** **BLOQUÉ (RÉSISTANCE VALIDÉE).** La propagation de `tenantId` dans `repair.ts`, `recovery.ts` et `MutationOrchestratorService` interdit formellement à un locataire d'annuler ou de manipuler les transactions d'un tiers.

---

### Chaîne 6 : Usurpation d'Identité dans l'Historique des Révisions (SEC-016)

* **Gravité théorique :** MOYENNE  
* **Prérequis :** Session authentifiée `ENGINEER` sur son propre tenant  
* **Composants ciblés :** `apps/api/src/routes/revisions.ts:58`

```
[Développeur Malveillant]
        │
        ▼ 1. POST /api/v1/projects/:id/revisions
        ▼ Payload : { message: "Backdoor discrète", author: "Lead Security Architect", files: {...} }
[handleRevisionsRoutes()]
        │
        ├── Lit payload.author sans confrontation avec context.role ou userId
        └── Enregistre la révision avec author: "Lead Security Architect"
        │
        ▼ 2. Consultation de l'historique par les auditeurs
[Audit / Revisions List]
        │
        └── La responsabilité apparente de la modification est imputée à un tiers.
```

* **Vérification d'exploitabilité :** **VULNÉRABLE.** L'auteur de la révision peut être falsifié par n'importe quel utilisateur habilité en écriture.
* **Atténuation :** Forcer `author = context.role` ou lier le champ à l'identifiant extrait du JWT vérifié.
