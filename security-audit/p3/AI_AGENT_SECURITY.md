# SÉCURITÉ DE L'AGENT IA & DU RUNTIME — MISSION P3
**Sous-systèmes :** `apps/api/src/routes/ai.ts`, `packages/core/src/ai-native/`

---

## 1. Défense contre le Prompt Injection (SEC-010)
* **Filtrage de motifs malveillants :** Détection d'expressions telles que "ignore all previous instructions", "you are now in developer mode", "dan", "jailbroken".
* **Normalisation XML :** Encadrement des entrées utilisateur dans des balises hermétiques `<user_input source="user_prompt">...</user_input>`.
* **Neutralisation des balises internes :** Remplacement de `<admin_override>` ou `<system_instruction>` par des balises inertes `[neutralized-tag:...]`.

## 2. Protection contre le Cost Bombing & DoS IA
* Plafonnement strict des tokens à 4096 tokens (`MAX_AI_TOKENS_CAP`).
* Contrôle de concurrence : maximum 5 requêtes IA simultanées par locataire (`MAX_CONCURRENT_AI_PER_TENANT`).

## 3. Découverte d'Audit sur l'Exécution des Plans
* Dans `packages/core/src/ai-native/conversation-intelligence/engine/execution-bridge.ts` (l. 29) :
`canExecute` considère comme valide l'état `PLANNING` dès lors que le plan n'est pas `REJECTED` ou `FAILED`.
* Cela permet l'appel à `executeApprovedPlan` sans confirmation formelle préalable par l'utilisateur.
