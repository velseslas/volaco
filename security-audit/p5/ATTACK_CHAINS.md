# SCÉNARIOS D'ATTAQUES DE BOÎTE NOIRE RÉELS (ATTACK_CHAINS)

### CHAÎNE 1 : Déni de Service Inter-Locataire par Falsification de Jeton (P5-FINDING-01)
- **Préconditions :** Connaissance du `tenantId` de l'organisation cible (souvent prévisible ou découvert dans des communications publiques).
- **Vecteur :** Envoi de 120 requêtes HTTP avec en-tête `Authorization: Bearer <forged_token_with_invalid_sig>`.
- **Résultat Observé :** Le quota de l'organisation cible est épuisé. Les vrais utilisateurs de l'organisation sont bloqués avec `HTTP 429`.
- **Impact :** **CRITIQUE / ÉLEVÉ**. Déni de service complet sur une organisation rivale sans aucun compte ni mot de passe.
- **Verdict :** **EXPLOITABLE (FAIL)**.

### CHAÎNE 2 : Escalade de Privilèges VIEWER -> Consommation de Ressources IA
- **Préconditions :** Compte invité avec privilèges de simple lecture (`VIEWER`).
- **Vecteur :** Envoi répété de requêtes à forte consommation de tokens sur `POST /api/v1/ai/chat/completions`.
- **Résultat Observé :** Les requêtes sont relayées à Mistral et consomment le quota/facturation de l'entreprise.
- **Impact :** **MOYEN**. Facturation abusive non autorisée.
- **Verdict :** **EXPLOITABLE (FAIL)**.

### CHAÎNE 3 : Exfiltration d'Informations Système via Erreur 500 Forcée
- **Préconditions :** Envoi d'une entrée déclenchant une exception interne non gérée.
- **Vecteur :** Observation de la réponse JSON reçue.
- **Résultat Observé :** La clé `context.original` restitue le message système interne de l'exception Node.js.
- **Impact :** **MOYEN**. Reconnaissance et découverte de chemins d'infrastructure.
- **Verdict :** **EXPLOITABLE (FAIL)**.

### CHAÎNE 4 : Usurpation d'Identité par Algorithme "none"
- **Préconditions :** Envoi d'un jeton JWT forgé avec `"alg": "none"`.
- **Résultat :** Rejeté avec `HTTP 401`.
- **Verdict :** **BLOQUÉ (PASS)**.

### CHAÎNE 5 : Traversée de Répertoire Arbitraire (Path Traversal)
- **Préconditions :** Envoi de `../../../../etc/passwd` ou `..\..\..\windows\win.ini`.
- **Résultat :** Rejeté avec `HTTP 404` ou `403`.
- **Verdict :** **BLOQUÉ (PASS)**.

### CHAÎNE 6 : Évasion de la Sandbox Iframe vers le DOM Parent
- **Préconditions :** Code JavaScript injecté dans la preview tentant d'accéder à `window.parent.document`.
- **Résultat :** Bloqué nativement par le navigateur (`DOMException`, origine `null`).
- **Verdict :** **BLOQUÉ (PASS)**.

### CHAÎNE 7 : Épuisement Mémoire par Requête Géante (> 10 Mo)
- **Préconditions :** Envoi d'un corps de requête de 11 Mo.
- **Résultat :** Connexion brutalement fermée par le serveur (`req.destroy()`).
- **Verdict :** **BLOQUÉ (PASS)**.

### CHAÎNE 8 : Contournement d'Approbation de Plan IA Destructeur
- **Préconditions :** Tentative de déclenchement d'un plan avec `DELETE_FILE` sans approbation.
- **Résultat :** Rejeté par `ConfirmationPolicy` et `ExecutionBridge`.
- **Verdict :** **BLOQUÉ (PASS)**.

### CHAÎNE 9 : Vol de Données Inter-Locataires par IDOR
- **Préconditions :** Locataire B tente de lire un projet du Locataire A par son UUID.
- **Résultat :** Rejeté avec `HTTP 404`.
- **Verdict :** **BLOQUÉ (PASS)**.

### CHAÎNE 10 : Écrasement d'Identité Tenant par Injection JSON
- **Préconditions :** Locataire A spécifie `"tenantId": "tenant-b"` dans le corps POST.
- **Résultat :** Ignoré; la ressource est assignée au tenant du jeton vérifié.
- **Verdict :** **BLOQUÉ (PASS)**.
