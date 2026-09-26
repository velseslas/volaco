# SÉCURITÉ DE L'INTELLIGENCE ARTIFICIELLE ET RUNTIME AGENTIQUE
## VOLACO-CORE — CONTRÔLE DES FLUX, DÉFENSE EN PROFONDEUR ET IMPACT GATE

### 1. Protection contre les Injections d'Invites (Prompt Injection)
- **Détection active :** `INJECTION_PATTERNS` identifie les tentatives de jailbreak, de contournement d'instructions (`ignore previous instructions`), ou de substitution de persona système.
- **Neutralisation structurelle :** Remplacement systématique des balises de balisage interne (`<system_instruction>`, `<admin_override>`) par des identifiants inoffensifs (`[neutralized-tag:...]`).
- **Encadrement délimité :** Les entrées utilisateurs sont isolées dans `<user_input source="user_prompt">` avant transmission au modèle de langage.

### 2. Plafonnement des Dépenses & Anti-Cost Bombing
- Plafond maximal de génération : 4 096 tokens par requête.
- Plafond de concurrence : 5 requêtes IA simultanées par locataire.
- Tier de Rate Limiting dédié : 20 requêtes IA par minute par IP/tenant.

### 3. Principe du Moindre Privilège dans les Mutations (Deny-by-Default)
- Dans `PlanExecutor`, `allowBreaking` et `allowHighRisk` sont fixés à `false` par défaut pour toute mutation réelle de code.
- L'Impact Gate rejette toute opération destructive sans confirmation humaine explicite (`confirmation = true`).
- Aucune sortie du modèle de langage ne peut auto-octroyer un droit de mutation sans passer par la validation des politiques RBAC.
