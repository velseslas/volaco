# ANALYSE DES CHAINES D'ATTAQUE (ATTACK CHAINS)
## VOLACO-CORE — TENTATIVES DE COMPROMISSION ET DÉFENSES EN PROFONDEUR

### Chaîne 1 : Contournement de Rate Limiting & Heap Exhaustion DoS
* **Scénario :** L'attaquant envoie des milliers de requêtes en modifiant l'en-tête `X-Forwarded-For` à chaque tentative, dans le but d'échapper aux quotas et de remplir la mémoire du serveur avec une infinité d'adresses IP.
* **Vérification Offensive :** Vecteurs 21 & 22 de `offensive-audit.test.ts`.
* **Résultat de Défense :**
  - Si le socket distant n'appartient pas à la liste `TRUSTED_PROXIES`, l'en-tête `X-Forwarded-For` est formellement ignoré, et l'IP réelle du socket est utilisée.
  - La Map interne des compteurs est plafonnée à `maxKeys` (10 000 entrées). Toute nouvelle clé provoque l'éviction de l'entrée la plus ancienne (LRU) et un ramasse-miettes purge les buckets expirés toutes les 60 secondes.
* **Verdict :** **NEUTRALISÉ (0 impact sur la disponibilité du service).**

---

### Chaîne 2 : Path Traversal Canonique & Exfiltration de Fichiers Système
* **Scénario :** L'attaquant soumet des requêtes d'évasion telles que `/..%2f..%2fpackage.json`, `/....//package.json` ou `/%2e%2e/%2e%2e/tsconfig.json` pour lire des fichiers sensibles du serveur hôte.
* **Vérification Offensive :** Vecteur 23 de `offensive-audit.test.ts`.
* **Résultat de Défense :**
  - Décodage d'URL via `decodeURIComponent()`.
  - Résolution canonique absolue `path.resolve(studioRoot, relativeFile)`.
  - Rejet HTTP 403 Forbidden immédiat si le chemin résolu ne commence pas par le préfixe normalisé de `apps/studio`, ou si `relativeFile` contient `..`.
* **Verdict :** **NEUTRALISÉ (Accès bloqué avec HTTP 403 / 404).**

---

### Chaîne 3 : Usurpation d'Identité et Falsification de l'Auteur de Révision
* **Scénario :** Un utilisateur authentifié avec le rôle `ENGINEER` modifie le corps JSON de la requête `POST /projects/:id/revisions` pour forger `"author": "admin_security_lead"` et imputer une révision malveillante à un tiers.
* **Vérification Offensive :** Vecteur 26 de `offensive-audit.test.ts`.
* **Résultat de Défense :**
  - La route `POST /projects/:id/revisions` et la route de rollback ignorent catégoriquement la propriété `payload.author`.
  - L'identité enregistrée est obligatoirement extraite du JWT authentifié (`context.role`).
* **Verdict :** **NEUTRALISÉ (Falsification impossible).**

---

### Chaîne 4 : Escalade de Privilèges par Mutation Destructive Non Supervisée
* **Scénario :** Un agent IA ou un utilisateur déclenche une mutation modifiant ou supprimant des fichiers critiques du projet avec `allowBreaking = true` sans validation humaine.
* **Vérification Offensive :** Vecteur 28 de `offensive-audit.test.ts` et tests d'intégration AINT-007.
* **Résultat de Défense :**
  - Par défaut, `MutationExecutor` applique `allowBreaking = false` et `allowHighRisk = false`.
  - Toute action destructive non approuvée lève une erreur `AgentCapabilityError` ou requiert `continueRun(..., confirmation = true)`.
* **Verdict :** **NEUTRALISÉ (Principe du moindre privilège effectif).**
