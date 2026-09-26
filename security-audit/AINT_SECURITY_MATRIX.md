# ÉVALUATION DE SÉCURITÉ DES MODULES AINT (AINT SECURITY MATRIX)

**Date d'évaluation :** 11 Septembre 2026  
**Auteurs :** Red Team Volaco  
**Mise en garde méthodologique :** Une suite de tests à 100% verts (1094 tests validés sous Gate 2) certifie la conformité fonctionnelle et la robustesse algorithmique, mais **ne constitue en aucun cas une certification de sécurité offensive**.

---

## 1. Matrice des Modules AINT

| Module AINT | Rôle Métier | Statut Sécurité Algorithmique | Surface d'Attaque Directe | Risque d'Effet en Cascade (Inter-Modules) |
| :--- | :--- | :---: | :--- | :--- |
| **AINT-001 (Application DNA)** | Contraintes fondamentales et invariants du projet | **SAIN** (Immuabilité et hash SHA-256) | Empoisonnement lors de la capture initiale | Si DNA est empoisonné, tous les audits ultérieurs sont faussés. |
| **AINT-006 (Mutation Orchestrator)** | Moteur d'application de mutations de code avec 2PC | **MODÉRÉ** (Rollback présent mais in-memory) | Exécution de mutations destructives | Reçoit les ordres de AINT-007 qui force `allowBreaking`. |
| **AINT-007 (Agent Runtime)** | Exécution de DAG d'agents et planification d'outils | **VULNÉRABLE** (`executor.ts:104` force les bypass) | Ingestion de prompts et déclenchement d'outils | Peut ordonner des suppressions massives dans AINT-006. |
| **AINT-008 (AI Orchestrator)** | Coordination multi-agents et métriques d'orchestration | **SAIN** (State machine stricte) | Manipulation de l'état de l'agent | Blocage possible de l'orchestration en cas d'erreur non rattrapée. |
| **AINT-009 (Conversation Intelligence)** | Compass, Intent, Assumptions, Plans de discussion | **MODÉRÉ** (Détection de contradictions active) | Injection de fausses hypothèses dans Memory | Empoisonnement des futures propositions de l'agent. |
| **AINT-013 (Application Audit)** | Analyse de santé, qualité de code, sécurité statique | **SAIN** (Règles déterministes) | Saturation CPU lors de l'analyse d'AST | Signaux transmis à AINT-017 pour influencer les priorités. |
| **AINT-014 (Feature Intelligence)** | Découverte d'opportunités et cartographie | **SAIN** (Pas d'effets de bord destructifs) | Ingestion de fausses opportunités | Recommandations de fonctionnalités inutiles ou non désirées. |
| **AINT-015 (User Feedback)** | Analyse de bugs et remontées utilisateurs | **MODÉRÉ** (Entrées utilisateurs non assainies) | Injection de faux rapports de bugs | Peut orienter artificiellement les priorités de développement. |
| **AINT-016 (Product Strategy)** | Scoring stratégique et roadmaps | **SAIN** (Calcul EPS déterministe) | Manipulation des pondérations | Altération de la vision produit à long terme. |
| **AINT-017 (Application Evolution)** | Optimiseur global de propositions d'évolution | **SAIN EN ISOLATION** (Graphe de Kahn, SHA-256) | Validations d'évolutions logicielles | Hérite de toutes les vulnérabilités de la passerelle API. |

---

## 2. Analyse des Risques Inter-Modules & Effets de Cascade

```
 [Entrée Utilisateur / Faux Feedback (AINT-015)]
                      │
                      ▼
 [Découverte d'Opportunités Artificielles (AINT-014)]
                      │
                      ▼
 [Planificateur Stratégique & Scoring EPS (AINT-016)]
                      │
                      ▼
 [Génération de Proposition d'Évolution (AINT-017)]
                      │
                      ▼ (Approbation par un attaquant usurpant le rôle OWNER)
 [Agent Runtime (AINT-007) : allowBreaking: true]
                      │
                      ▼
 [Mutation Orchestrator (AINT-006) : Suppression de composants vitaux]
```

**Démonstration du Piège de l'Architecture Multi-Modules :**  
Chaque module AINT individuel réussit l'ensemble de ses tests unitaires car il effectue correctement ses calculs mathématiques et ses tris topologiques.  
Cependant, lorsqu'ils sont interconnectés :
1. Une fausse donnée injectée dans **AINT-015** (User Feedback) est transformée en opportunité par **AINT-014**.
2. **AINT-016** lui attribue un score élevé.
3. **AINT-017** la place en phase `NOW` de la roadmap.
4. Un utilisateur ayant profité de **SEC-002** (usurpation de rôle) approuve la proposition.
5. **AINT-007** force le passage en brisant les gardes-fous (`allowBreaking: true`) vers **AINT-006**.
6. Le code applicatif de la victime est corrompu ou supprimé.

**Conclusion :** La sécurité globale ne peut pas être déduite de la conformité isolée de chaque brique.
