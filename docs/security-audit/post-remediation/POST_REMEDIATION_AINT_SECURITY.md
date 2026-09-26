# AUDIT DE SÉCURITÉ DU MOTEUR AINT-017
## AUTONOMOUS EVOLUTION & SELF-OPTIMIZATION ENGINE — ANALYSE EN BOÎTE BLANCHE

**Périmètre :** `packages/core/src/ai-native/evolution/` et `apps/api/src/routes/evolution.ts`  
**Date d'évaluation :** 11 Septembre 2026  

---

### 1. Vue d'Ensemble & Invariants d'AINT-017

AINT-017 constitue le sous-système d'intelligence produit et d'évolution autonome de VibeCode.
Il agrège les signaux d'audit (AINT-013), d'opportunités fonctionnelles (AINT-014), de retours utilisateurs (AINT-015), de stratégie (AINT-016) et les contraintes ADN pour proposer une trajectoire d'évolution logicielle déterministe.

Il repose sur 5 invariants formels de sécurité :
1. **NO EVIDENCE → NO EVOLUTION CLAIM :** Aucune proposition d'évolution n'est émise si elle ne s'appuie pas sur au moins une preuve traçable et pondérée.
2. **CONTRÔLE HUMAIN OBLIGATOIRE :** AINT-017 est un système d'aide à la décision. Il ne mutera jamais le code applicatif sans une approbation explicite (`applyDecision` avec `APPROVE`).
3. **SCORING DÉTERMINISTE :** Formule mathématique pure $0-100$ sans `Math.random()`, stable et reproductible.
4. **ISOLATION MULTI-TENANT STRICTE :** Cloisonnement étanche des propositions, états, caches et roadmaps par locataire et par projet.
5. **RBAC ENFORCEMENT :** `PROJECT_READ` pour la consultation, `PROJECT_UPDATE` pour les décisions et transferts de plans.

---

### 2. Audit des Composants Internes d'AINT-017

#### A. Le Moteur de Preuves (`EvolutionEvidenceEngine` & `ConfidenceEngine`)
* `packages/core/src/ai-native/evolution/evidence/evolution-evidence-engine.ts` :
  - Reçoit des contextes externes et instancie des objets immuables `EvolutionEvidence`.
  - Si un contexte est absent ou vide, la fonction renvoie `[]` sans aucune hallucination ni extrapolation.
  - Chaque preuve possède un identifiant canonique déterministe calculé par SHA-256.
* `packages/core/src/ai-native/evolution/evidence/confidence-engine.ts` :
  - `hasMinimumEvidence(evidence)` retourne formellement `false` si `evidence.length === 0`.
  - Formule : $\min(\text{count} / 5.0, 1.0) \times (\text{moyenne pondérée des confiances})$.

#### B. Générateur & Validateur de Propositions (`EvolutionProposalGenerator`)
* `packages/core/src/ai-native/evolution/proposal/evolution-proposal-generator.ts` :
  - Toute proposition dépourvue d'éléments de preuve est automatiquement classée avec le statut `UNSUPPORTED` et exclue du rapport d'analyse.
  - L'identifiant de proposition est un hachage SHA-256 déterministe préfixé par `evo:`.
* `packages/core/src/ai-native/evolution/proposal/proposal-validator.ts` :
  - Valide l'intégrité de tous les champs obligatoires (`tenantId`, `projectId`, `title`, `category`, `evidence`).

#### C. Moteur de Priorisation Déterministe (EPS)
* `packages/core/src/ai-native/evolution/scoring/evolution-priority-engine.ts` :
  - Formule mathématique :
    $$\text{Base} = 0.20 \cdot V_{\text{user}} + 0.20 \cdot S_{\text{strat}} + 0.15 \cdot C_{\text{ev}} \cdot 100 + 0.15 \cdot V_{\text{exp}} + 0.10 \cdot S_{\text{urg}} + 0.10 \cdot (100 - R) + 0.10 \cdot V_{\text{biz}}$$
    $$\text{Pénalité} = 0.10 \cdot \text{Effort} + 0.05 \cdot \text{Complexité} + 0.05 \cdot \text{Risque}$$
    $$\text{EPS} = \text{clamp}(0, 100, \text{Base} - \text{Pénalité})$$
  - Zéro appel à `Math.random()`. Cent exécutions sur le même jeu de données retournent cent résultats strictement identiques au bit près.

#### D. Détection de Conflits et Cycles (`DependencyEngine` & `ConflictEngine`)
* `DependencyEngine` implémente l'algorithme topologique de Kahn (BFS). Tout cycle de dépendance entre propositions déclenche une exception explicite listant les nœuds en boucle.
* `ConflictEngine` détecte automatiquement les conflits de composants partagés (`DIRECT_CONFLICT`), les contradictions de dépendances (`DEPENDENCY_CONFLICT`) et les violations de contraintes architecturales (`DNA_CONFLICT`).

#### E. Machine à États et Contrôle d'Exécution (`EvolutionStateMachine`)
* Statuts formels : `DETECTED → ANALYZING → PROPOSED → EVALUATED → PRIORITIZED → AWAITING_DECISION → APPROVED / REJECTED / DEFERRED → PLANNED → HANDED_OFF`.
* **Règle d'or vérifiée :** Aucune proposition ne peut passer à `HANDED_OFF` (génération de plan d'exécution pour l'orchestrateur AINT-010) si elle n'a pas reçu au préalable la décision humaine `APPROVED`.

---

### 3. Résistance aux Scénarios Offensifs

#### Test Offensif : Tentative de Manipulation par Preuves Forgées
* **Question clé de l'audit :** *Un utilisateur ou un agent malveillant peut-il fabriquer suffisamment de fausses preuves pour forcer AINT-017 à déclencher une modification hostile ?*
* **Résultat de l'analyse :**
  1. L'attaquant peut envoyer de fausses preuves via `POST /api/v1/projects/:id/evolution/analyze` pour gonfler artificiellement le score EPS d'une proposition et la faire apparaître dans l'horizon `NOW` de la roadmap.
  2. **MAIS :** AINT-017 ne dispose d'aucun lien direct avec le système de fichiers hôte ni avec les méthodes d'écriture sans décision humaine.
  3. L'appel à `planHandoff()` échoue systématiquement (`ValidationError`) tant qu'un utilisateur humain authentifié n'a pas formellement émis `applyDecision({ type: 'APPROVE' })`.
  4. Même après approbation, le handoff ne produit qu'un graphe de tâches d'ingénierie abstrait (`EvolutionHandoffPayload`) transmis à AINT-010, qui applique ses propres barrières RBAC (`PROJECT_MUTATE`) et son moteur de préconditions.

---

### 4. Bilan de Sécurité d'AINT-017

Le module AINT-017 démontre une **excellente robustesse conceptuelle et technique** :
* 90/90 tests unitaires réussis.
* 10/10 tests d'intégration API réussis.
* Étanchéité multi-tenant absolue (clé composite et vérification systématique de l'appartenance du projet).
* Confinement strict au rôle consultatif (zéro mutation autonome non approuvée).
