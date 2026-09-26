# AUDIT DU REGISTRE DES LOGS & NON-RÉPUDIATION (AUDIT TRAIL)
## VOLACO-CORE — CHAÎNAGE CRYPTOGRAPHIQUE SHA-256 ET TAMPER EVIDENCE

### 1. Architecture du Chaînage Cryptographique
- Chaque événement consigné dans `AuditStore` calcule une empreinte SHA-256 combinant :
  ```
  previousHash | id | tenantId | userId | action | resourceType | resourceId | status | requestId | timestamp | metadata
  ```
- Toute tentative d'altération en mémoire (modification d'un champ, inversion de deux événements, suppression d'un enregistrement) brise immédiatement la chaîne cryptographique.

### 2. Détection par `verifyIntegrity()`
- La méthode retourne `{ valid: true }` si la chaîne est intacte.
- En cas de compromission, elle identifie avec précision l'index de l'événement altéré (`compromisedIndex`) et la cause du bris (`reason`).
- Validation : Vecteurs 49 et 50 de `red-team-p2.test.ts` (PASS).

### 3. Limites et Recommandations
- Le modèle actuel garantit la **preuve d'altération en mémoire** (tamper evidence).
- Pour atteindre la non-répudiation légale absolue face à un attaquant disposant d'un accès root au processus, la persistance sur stockage WORM (Write Once Read Many) ou base de données signée externe constitue l'étape d'évolution recommandée.
