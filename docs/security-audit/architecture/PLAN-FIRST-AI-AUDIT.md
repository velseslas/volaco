# AUDIT CIBLÉ — PLAN FIRST VOLACO
## Vérification Forensique de la Génération Réelle des Plans d'Ingénierie

**Date de l'audit** : 16 Septembre 2026  
**Statut** : READ-ONLY STRICT — Aucune modification de code ou de prompt effectuée.  
**Cible** : Pipeline Plan First, Intent Engine, Compass, PlanGenerator, PlanValidator, AI Orchestrator, Studio Chat.

---

## 1. Executive Summary

Le présent audit forensique a examiné l'intégralité du cycle de vie du **Plan First** de Volaco, de la saisie utilisateur dans le Studio jusqu'à l'exécution et l'affichage final dans l'interface.

### Constat Majeur
> **LE PLAN FIRST AFFICHÉ DANS LE STUDIO N'EST PAS GÉNÉRÉ PAR UNE IA.**  
> Il est produit par un **template déterministe hardcodé à 3 étapes fixes** dans le code TypeScript (`PlanGenerator.ts`), paramétré par des expressions régulières heuristiques (`intent-engine.ts`).

1. **Absence Totale d'Inférence IA pour la Planification** : Le composant `PlanGenerator.ts` ne contient **aucun import d'IA**, aucun client HTTP, aucun appel de provider (Mistral, OpenAI, Gemini).
2. **Confidence Score Fictif (88% conf.)** : Le score `88%` affiché sur la carte du plan provient directement d'une valeur flottante codée en dur (`weight: 0.88`) associée à la règle regex de la catégorie `CREATE` dans `intent-engine.ts`.
3. **Structure des Étapes Figée (3 étapes immuables)** : Toute demande de création ou d'ajout produit invariablement :
   - Étape 1 : `Inspect <domain> architecture and prerequisites`
   - Étape 2 : `Execute Execute <Action> in <domain>`
   - Étape 3 : `Verify changes and ensure zero regressions`
4. **Indépendance Totale au Contexte de l'Application** : Deux projets radicalement différents (un projet de gestion de stock et un projet RH) soumis à la même requête produisent un plan **100% identique au caractère près**.
5. **Déconnexion Post-Plan dans le Studio** : Lors du clic sur « Confirmer et exécuter », le Studio appelle `POST /orchestrate` mais en ignore le résultat, puis déclenche directement un appel LLM (`POST /api/v1/ai/chat/completions`) avec Codestral en lui envoyant le template complet du code HTML à régénérer d'un bloc.

---

## 2. Question Centrale

> **Le Plan First de Volaco est-il réellement généré par une IA en fonction du contexte de l'application et de la demande utilisateur, ou est-il produit par du hardcode, un template, une heuristique déterministe, un fallback ou une combinaison de ceux-ci ?**

### Réponse Forensique
Le Plan First est produit par une **combinaison exclusive d'heuristiques regex et d'un template déterministe hardcodé**. L'IA n'intervient **à aucun moment** dans l'élaboration du plan, dans le calcul de son score de confiance, dans le découpage de ses étapes, ni dans l'analyse des dépendances du projet.

---

## 3. Architecture Réellement Exécutée

```text
USER CHAT INPUT ("Ajoute maintenant une page fournisseurs")
    │
    ▼ [HTTP POST]
apps/api/src/routes/conversations.ts (ligne 135)
    │
    ▼
conversationIntelligenceService.processTurn() [packages/core/.../service.ts:302]
    │
    ▼
ConversationEngine.processTurn() [packages/core/.../engine/conversation-engine.ts:110]
    │
    ├─► 1. IntentEngine.classifyIntent() [engine/intent-engine.ts:99]
    │      • Regex match : /ajoute/i => category: "CREATE", weight: 0.88
    │      • Regex entity : /fournisseurs/i => entities: ["fournisseurs", "page"]
    │      • Regex domain : /fournisseur/i => domain: "dom_suppliers"
    │      • requestedAction: "Execute CREATE action on page, fournisseurs"
    │      • confidence: 0.88 (PUREMENT STATIQUE)
    │
    ├─► 2. PlanGenerator.generatePlan() [engine/plan-generator.ts:24]
    │      • AUCUN APPEL IA, AUCUN PROVIDER, AUCUN MODÈLE
    │      • Titre template : `Engineering Plan: ${intent.requestedAction}`
    │      • Étape 1 hardcodée : `Inspect ${targetDomain} architecture and prerequisites`
    │      • Étape 2 hardcodée : `Execute ${intent.requestedAction} in ${targetDomain}`
    │      • Étape 3 hardcodée : `Verify changes and ensure zero regressions`
    │
    ├─► 3. PlanValidator.validate() [engine/plan-validator.ts:25]
    │      • Vérifie structure DAG (1 -> 2 -> 3) : Toujours valide
    │
    ├─► 4. durablePlanRepository.save() [packages/core/.../repository.ts:312]
    │      • Sauvegarde locale en mémoire/JSON
    │
    └─► 5. DefaultReasoningProvider.reason() [provider/reasoning-provider.ts:18]
           • Switch-case JS déterministe : `case 'CREATE': reply = ...`
           • N'influence PAS le plan (le plan est DÉJÀ généré à la ligne 110)
    │
    ▼ [HTTP 200 OK JSON]
apps/studio/index.html (ligne 854000)
    │
    ▼
renderVolacoPlanCard(plan, intent) [apps/studio/index.html]
    • Affiche le titre template
    • Affiche les 3 étapes hardcodées
    • Affiche `${Math.round(intent.confidence * 100)}% conf.` => "88% conf."
    │
    ▼ [CLIC UTILISATEUR : "Confirmer et exécuter"]
confirmAndExecuteVolacoPlan(planId) [apps/studio/index.html]
    │
    ├─► 1. POST .../plans/:id/confirm (Verrouillage status REST)
    ├─► 2. POST .../orchestrate (Exécute graphe d'agents backend dont le résultat est ignoré)
    └─► 3. POST /api/v1/ai/chat/completions (Bypass frontend : appel direct à Codestral)
           • Prompt système : "Voici les étapes : Step 1, Step 2, Step 3..."
           • Génère l'application HTML complète en un bloc
```

---

## 4. Architecture Théorique Attendue

Dans une architecture AI-Native Plan First authentique :
1. Le modèle IA reçoit l'intégralité du contexte : la demande utilisateur, le graphe de composants réels de l'application (`ApplicationSemanticModel`), le schéma de données, l'arbre des fichiers existants, et les dépendances.
2. Le modèle produit par **inférence structurée** (JSON Schema / Tool Calling) un plan spécifique comportant $N$ étapes adaptées à la complexité de la demande.
3. Le score de confiance reflète la certitude du modèle et l'adéquation au code réel.
4. L'orchestrateur d'agents exécute ce plan étape par étape en modifiant chirurgicalement les fichiers impactés.

---

## 5. Trace Complète du Code Path

| Étape | Fichier | Ligne | Fonction / Classe | Données Entrantes | Données Sortantes | Appel IA Réel ? |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| 1. Saisie Studio | `apps/studio/index.html` | ~854000 | `handleWorkspacePromptSubmit` | Texte utilisateur | Payload JSON `{ message }` | **NON** |
| 2. Route API | `apps/api/src/routes/conversations.ts` | 118-135 | `handleConversationRoutes` | HTTP Request | Appel service | **NON** |
| 3. Service Facade | `packages/core/.../conversation-intelligence/service.ts` | 302 | `ConversationIntelligenceService.processTurn` | `message`, `sessionId` | Appel Engine | **NON** |
| 4. Moteur de Tour | `packages/core/.../conversation-intelligence/engine/conversation-engine.ts` | 80-120 | `ConversationEngine.processTurn` | Session, message | Intent, Plan, Turn | **NON** |
| 5. Classification | `packages/core/.../conversation-intelligence/engine/intent-engine.ts` | 99-165 | `classifyIntent` | `userText` | `IntentResult` | **NON** (Regex) |
| 6. Génération Plan | `packages/core/.../conversation-intelligence/engine/plan-generator.ts` | 24-254 | `PlanGenerator.generatePlan` | `IntentResult`, `semanticModel` | `EngineeringPlan` | **NON** (Template) |
| 7. Validation Plan | `packages/core/.../conversation-intelligence/engine/plan-validator.ts` | 25-150 | `PlanValidator.validate` | `EngineeringPlan` | `PlanValidation` | **NON** (DAG check) |
| 8. Persistance | `packages/core/.../conversation-intelligence/repository.ts` | 312 | `DurablePlanRepository.save` | `EngineeringPlan` | Stockage local | **NON** |
| 9. Réponse Studio | `apps/studio/index.html` | ~854040 | `convRes.json()` | HTTP Response | Objet plan JS | **NON** |
| 10. Rendu Carte | `apps/studio/index.html` | ~456500 | `renderVolacoPlanCard` | `plan`, `intent` | HTML Plan Card | **NON** |
| 11. Confirmation | `apps/studio/index.html` | ~457000 | `confirmAndExecuteVolacoPlan` | `planId` | Codestral completion | **OUI** (Post-plan) |

---

## 6. Source Exacte du Titre

Pour le texte :
```text
Engineering Plan: Execute CREATE action on page, fournisseurs
```

* **Fichier** : `packages/core/src/ai-native/conversation-intelligence/engine/plan-generator.ts`
* **Ligne** : 206
* **Fonction** : `PlanGenerator.generatePlan`
* **Code exact** :
  ```typescript
  title: `Engineering Plan: ${intent.requestedAction}`,
  ```
* **Provenance de `intent.requestedAction`** :
  - **Fichier** : `packages/core/src/ai-native/conversation-intelligence/engine/intent-engine.ts`
  - **Ligne** : 158
  - **Code exact** :
    ```typescript
    requestedAction: `Execute ${bestCategory} action on ${entities.join(', ') || 'application'}`,
    ```
* **Nature** : **Concaténation déterministe de chaînes de caractères**.
  `bestCategory` = `"CREATE"` (issu du pattern regex `/ajoute/i`)
  `entities` = `["page", "fournisseurs"]` (issus du regex de mots-clés)
  Résultat : `"Execute CREATE action on page, fournisseurs"`.

---

## 7. Source Exacte des Étapes

### Étape 1 : `Inspect dom_suppliers architecture and prerequisites`
* **Fichier** : `packages/core/src/ai-native/conversation-intelligence/engine/plan-generator.ts`
* **Lignes** : 84-99
* **Code** :
  ```typescript
  steps.push({
    id: 'step-1',
    stepIndex: 1,
    order: 1,
    title: `Inspect ${targetDomain} architecture and prerequisites`,
    description: `Analyze existing structure and dependencies for ${intent.requestedAction}.`,
    targetDomain,
    targetFiles: targetFiles.length > 0 ? targetFiles : undefined,
    operation: 'ANALYZE',
    type: 'ANALYZE',
    ...
  });
  ```
* **Nature** : **Template déterministe statique** (interpolation de `${targetDomain}`).

### Étape 2 : `Execute Execute CREATE action on page, fournisseurs in dom_suppliers`
* **Fichier** : `packages/core/src/ai-native/conversation-intelligence/engine/plan-generator.ts`
* **Lignes** : 109-124
* **Code** :
  ```typescript
  steps.push({
    id: 'step-2',
    stepIndex: 2,
    order: 2,
    title: `Execute ${intent.requestedAction} in ${targetDomain}`,
    description: `Apply required code changes to satisfy goal: ${intent.goal}.`,
    targetDomain,
    targetFiles: targetFiles.length > 0 ? targetFiles : undefined,
    operation: opType,
    type: opType,
    ...
  });
  ```
* **Nature** : **Template déterministe statique**.
  *Remarque flagrante* : Le doublon syntaxique `"Execute Execute"` prouve mécaniquement l'absence d'IA : `intent.requestedAction` valant déjà `"Execute CREATE..."`, le template rajoute aveuglément `"Execute "` devant.

### Étape 3 : `Verify changes and ensure zero regressions`
* **Fichier** : `packages/core/src/ai-native/conversation-intelligence/engine/plan-generator.ts`
* **Lignes** : 127-141
* **Code** :
  ```typescript
  steps.push({
    id: 'step-3',
    stepIndex: 3,
    order: 3,
    title: 'Verify changes and ensure zero regressions',
    description: 'Run automated checks, type checks and integration verifications.',
    targetDomain,
    operation: 'VERIFY',
    type: 'TEST',
    ...
  });
  ```
* **Nature** : **Chaîne de caractères 100% hardcodée**.

---

## 8. Source du Confidence Score ("88% conf.")

Le badge `88% conf.` affiché dans le Studio est **entièrement factice**.

1. **Origine dans `intent-engine.ts`** (lignes 58-61) :
   ```typescript
   {
     category: 'CREATE',
     patterns: [/ajoute/i, /cr[ée][ée]?/i, /fais un/i, /fais une/i, /nouvel/i, /nouveau/i, /impl[ée]mente/i, /constuis/i, /add/i, /create/i, /new/i],
     weight: 0.88 // <--- VOICI LE 88%
   }
   ```
2. **Assignation** (ligne 162) :
   ```typescript
   confidence: Math.round(highestWeight * 100) / 100, // Retourne 0.88
   ```
3. **Affichage dans `apps/studio/index.html`** (ligne ~456530) :
   ```javascript
   const confidencePct = intent && typeof intent.confidence === 'number' ? Math.round(intent.confidence * 100) : 95;
   ...
   `<span ...>${confidencePct}% conf.</span>`
   ```
4. **Conclusion** : Aucune mesure d'incertitude mathématique ou probabiliste par IA. Le score 88% est une constante hardcodée attribuée à toute phrase contenant le mot « ajoute » ou « crée ».

---

## 9. Tests Comparatifs de Variation des Plans (Exécution Réelle)

Tests exécutés sur le runtime de production compilé (`dist/packages/core/...`) :

| Demande | Titre Produit | Étapes Produites | Domaines Détectés | Différence Réelle |
| :--- | :--- | :--- | :--- | :--- |
| **A. Page Fournisseurs** | `Engineering Plan: Execute CREATE action on page, fournisseurs` | 1. Inspect dom_suppliers...<br>2. Execute Execute CREATE...<br>3. Verify changes... | `dom_suppliers` | Seul le nom de domaine regex change |
| **B. Authentification** | `Engineering Plan: Execute CREATE action on auth` | 1. Inspect dom_authentication...<br>2. Execute Execute CREATE...<br>3. Verify changes... | `dom_authentication` | Seul le nom de domaine regex change |
| **C. Notifications** | `Engineering Plan: Execute CREATE action on application` | 1. Inspect core...<br>2. Execute Execute CREATE...<br>3. Verify changes... | `core` (fallback) | Identique au template C |
| **D. Facturation PDF** | `Engineering Plan: Execute CREATE action on page` | 1. Inspect core...<br>2. Execute Execute CREATE...<br>3. Verify changes... | `core` (fallback) | Identique au template C |
| **E. Dark Mode** | `Engineering Plan: Execute UNKNOWN action on table` | 1. Inspect core...<br>2. Execute Execute UNKNOWN...<br>3. Verify changes... | `core` | Heuristique erronée : extrait `table` de `tableau` |
| **F. Recherche Produits**| `Engineering Plan: Execute CREATE action on application` | 1. Inspect core...<br>2. Execute Execute CREATE...<br>3. Verify changes... | `core` (fallback) | Identique au template C |

### Analyse
La structure est invariante : **3 étapes, structure Inspect / Execute / Verify**.  
La seule variabilité provient de la substitution d'une regex sur les mots saisis par l'utilisateur.

---

## 10. Test de Dépendance au Contexte (Projet A vs Projet B)

### Protocole
Deux modèles sémantiques distincts ont été injectés dans `PlanGenerator.generatePlan` avec la même requête *« Ajoute une page fournisseurs »* :
- **Projet A (Gestion de Stock)** : Entités `Produits`, `Fournisseurs`, `Stocks`, fichiers `src/stock.ts`, `src/suppliers.ts`.
- **Projet B (Gestion RH)** : Entités `Employés`, `Congés`, `Paie`, fichiers `src/payroll.ts`, `src/leaves.ts`.

### Résultat du Test
* **Plan Projet A** :
  - Titre : `Engineering Plan: Execute CREATE action on page, fournisseurs`
  - Step 1 : `Inspect dom_suppliers architecture and prerequisites`
  - Step 2 : `Execute Execute CREATE action on page, fournisseurs in dom_suppliers`
  - Step 3 : `Verify changes and ensure zero regressions`
* **Plan Projet B** :
  - Titre : `Engineering Plan: Execute CREATE action on page, fournisseurs`
  - Step 1 : `Inspect dom_suppliers architecture and prerequisites`
  - Step 2 : `Execute Execute CREATE action on page, fournisseurs in dom_suppliers`
  - Step 3 : `Verify changes and ensure zero regressions`

**Corrélation : 100% binaire identique.** Le modèle applicatif sous-jacent n'a **strictement aucun impact** sur le plan généré.

---

## 11. Test de Compréhension sur Demande Complexe

### Demande Testée
> *« Ajoute une page fournisseurs avec : liste des fournisseurs ; recherche ; filtres ; fiche détaillée ; possibilité de créer/modifier/supprimer ; historique ; association aux produits ; gestion des permissions. »*

### Résultat Obtenu
- **Intent Category** : `DELETE` (Catégorie destructive erronée !)
- **Explication du bug** : Le mot « supprimer » figurant dans la liste a activé le regex `/supprime/i` dont le poids est 0.94, surpassant `/ajoute/i` (0.88).
- **Plan généré** :
  - Titre : `Engineering Plan: Execute DELETE action on page, fournisseurs`
  - Step 1 : `Inspect dom_suppliers architecture and prerequisites`
  - Step 2 : `Execute Execute DELETE action on page, fournisseurs in dom_suppliers` (opType: `DELETE`, requiresApproval: `true`, risk: `CRITICAL`)
  - Step 3 : `Verify changes and ensure zero regressions`

### Diagnostic
L'absence de compréhension par IA produit ici une **inversion critique de sens** : une demande d'ajout d'écran d'administration avec permissions et filtres est convertie en une **action destructrice de suppression** !

---

## 12. Utilisation de l'Application Model

Dans `PlanGenerator.ts` (lignes 52-69) :
```typescript
const targetDomain = intent.domain || semanticModel?.summary.highestRiskAreas[0] || 'core';
...
if (targetFiles.length === 0 && semanticModel?.domains) {
  const matchingDomain = semanticModel.domains.find(
    (d) => d.name.toLowerCase().includes(targetDomain.toLowerCase())
  );
  if (matchingDomain && matchingDomain.relatedFiles.length > 0) {
    targetFiles.push(...matchingDomain.relatedFiles.slice(0, 3));
  }
}
```
L'Application Model n'est consulté que comme **fallback cosmétique** pour renseigner la propriété optionnelle `targetFiles` ou `targetDomain`. Les pages, composants, routes, modèles de données, invariants, règles métiers et dette technique ne sont **jamais lus ni injectés dans la planification**.

---

## 13. Audit du Conversation Compass

Le `ConversationCompass` est une machine à états finis déterministe (`packages/core/.../conversation-compass.ts`) :
- États : `READY` → `UNDERSTANDING` → `WAITING_CONFIRMATION` → `EXECUTING` → `COMPLETED`.
- **Rôle réel** : Il pilote l'affichage visuel du badge Compass dans le Studio (point coloré et libellé).
- **Impact sur le plan** : **Zéro impact**. Il ne guide aucune stratégie de planification et n'est pas alimenté par un raisonneur IA.

---

## 14. Audit du Plan Validator

Le `PlanValidator` (`packages/core/.../plan-validator.ts`) vérifie :
1. Présence d'un `planId` et `title`.
2. Unicité des identifiants et numéros d'ordre des étapes.
3. Validité syntaxique des opérations (`ANALYZE`, `CREATE`, `MODIFY`, etc.).
4. Détection de cycles DAG par algorithme de parcours en profondeur (DFS).

Comme `PlanGenerator` instancie toujours la même chaîne linéaire (Étape 1 sans dépendance, Étape 2 dépendant de 1, Étape 3 dépendant de 2), **le PlanValidator valide un plan qui ne peut structurellement jamais échouer**.

---

## 15. Audit de l'Exécution Post-Confirmation (Plan → Orchestrator → Agents)

Lors de la confirmation dans le Studio (`confirmAndExecuteVolacoPlan`) :
```javascript
// 1. Appel orchestrateur backend
await authenticatedFetch(`/api/v1/projects/${encodeURIComponent(pId)}/orchestrate`, {
  method: 'POST',
  body: JSON.stringify({ plan, intent, conversationId })
});

// 2. Appel direct LLM dans le Studio
const mistralRes = await authenticatedFetch("/api/v1/ai/chat/completions", {
  method: "POST",
  body: JSON.stringify({
    model: "codestral-latest",
    messages: [
      { role: "system", content: enrichedSystemPrompt },
      { role: "user", content: userPrompt }
    ]
  })
});
```

### Rupture Architecturale Identifiée
1. Le backend exécute bien un graphe d'agents simulés (`AIOrchestratorService.orchestratePlan`).
2. Cependant, le Studio **n'utilise pas le code ni les artefacts produits par ces agents**.
3. Le Studio appelle lui-même le proxy `/api/v1/ai/chat/completions` avec `codestral-latest` en lui passant dans le prompt système les titres du plan template.
4. Le message final :
   ```text
   Plan validé et exécuté avec succès par les agents Volaco !
   ```
   s'affiche alors même que l'application affichée a été générée d'un seul bloc par Codestral via une complétion monolithique, et non par des agents spécialisés.

---

## 16. Classification des Problèmes Découverts

### P0 — CRITIQUE (Faiblesse Fondamentale de Conception)
* **P0-1 : Plan First Déterministe Non-IA**  
  Le `PlanGenerator` utilise un template statique codé en dur sans aucune inférence de modèle de langage.
* **P0-2 : Score de Confiance Factice (Misleading UI)**  
  L'affichage `88% conf.` est un nombre flottant en dur dans une règle regex (`weight: 0.88`).
* **P0-3 : Inversion Sémantique Critique de l'Intent**  
  Toute phrase comportant une négation ou un verbe secondaire (ex: « ajouter une vue avec option de suppression ») classe la demande en `DELETE` destructif.

### P1 — MAJEUR
* **P1-1 : Déconnexion de l'Application Model**  
  Le plan ne prend pas en compte le code existant, les composants ni le contexte métier.
* **P1-2 : Double Génération Redondante (Studio vs Backend)**  
  Le backend orchestre des agents dont le travail est écrasé par un appel direct Codestral dans le frontend.
* **P1-3 : Doublon Lexical Visuel**  
  L'intitulé de l'étape 2 affiche `"Execute Execute CREATE..."` dans le chat utilisateur.

### P2 — MINEUR / COSMÉTIQUE
* **P2-1 : Compass Purement Réactif**  
  La machine à états ne sert que d'indicateur visuel sans influencer la chaîne décisionnelle.

---

## 17. Tableau Final Synthétique

| Élément | Existe dans le code | Appelé en runtime | IA Réelle ? | Dynamique ? | Dépend du contexte projet ? | Source du code |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **Conversation** | OUI | OUI | NON | OUI | Faible | `apps/api/src/routes/conversations.ts` |
| **Intent Engine** | OUI | OUI | **NON** | NON (Regex) | NON | `packages/core/.../intent-engine.ts:99` |
| **Compass** | OUI | OUI | **NON** | NON (State machine) | NON | `packages/core/.../conversation-compass.ts:25` |
| **Application Model** | OUI | OUI | **NON** | OUI | Ignoré | `packages/core/.../plan-generator.ts:52` |
| **PlanGenerator** | OUI | OUI | **NON** | **NON (Template)** | **NON** | `packages/core/.../plan-generator.ts:24` |
| **AI Provider (Planning)**| NON | NON | **NON** | NON | NON | *Inexistant pour le plan* |
| **Plan Validator** | OUI | OUI | **NON** | NON (Algorithme DAG) | NON | `packages/core/.../plan-validator.ts:25` |
| **Plan Repository** | OUI | OUI | **NON** | OUI | OUI | `packages/core/.../repository.ts:312` |
| **AI Orchestrator** | OUI | OUI | Hybride (Agents) | OUI | Partiel | `packages/core/.../ai-orchestrator/service.ts:113` |
| **Agent Runtime** | OUI | OUI | OUI (LLM adapter) | OUI | Partiel | `packages/core/.../ai-orchestrator/agents/` |
| **Confidence Score** | OUI | OUI | **NON (Hardcodé 0.88)** | **NON** | **NON** | `packages/core/.../intent-engine.ts:60` |

---

## 18. Test Final Décisif

> **Si je change complètement la demande utilisateur, est-ce que Volaco reconstruit réellement un nouveau plan à partir de l'intelligence du modèle et du contexte de l'application, ou est-ce qu'il remplace essentiellement quelques variables dans un template prédéfini ?**

### Réponse Obligatoire & Prouvée :
```text
DETERMINISTIC / TEMPLATE PLANNING
```

**Preuve Formelle** :  
Volaco ne reconstruit **aucun plan par intelligence artificielle**. Il se contente d'injecter deux ou trois fragments textuels extraits par expressions régulières (`domain`, `requestedAction`) à l'intérieur d'un patron immuable à 3 étapes :
1. `Inspect [domaine] architecture and prerequisites`
2. `Execute Execute [action] in [domaine]`
3. `Verify changes and ensure zero regressions`

---

## 19. Architecture Recommandée pour Résoudre la Dette

Pour transformer ce système en un véritable **Plan First AI-Native** :

1. **Intégrer le LLM dans `PlanGenerator`** :
   Connecter `PlanGenerator` à `aiProviderRegistry` (via `ReasoningOrchestrator` ou directement) avec un prompt de planification outillé recevant :
   - Le message utilisateur et l'historique conversationnel.
   - La synthèse sérialisée de l'`ApplicationSemanticModel` (arborescence des fichiers, composants actifs, routes d'API existantes).
   - Un schéma JSON strict (Structured Outputs) imposant la structure de l'`EngineeringPlan`.
2. **Dynamiser le Nombre et la Nature des Étapes** :
   Permettre au modèle de formuler entre 2 et 8 étapes chirurgicales adaptées à l'intention (ex. pour une page fournisseurs : création du schéma de données, implémentation du composant table, création des filtres, ajout de la route).
3. **Supprimer le Poids Fixe 0.88** :
   Faire évaluer la confiance par le modèle ou par un évaluateur sémantique mesurant l'adéquation entre l'expression du besoin et l'état courant de l'application.
4. **Unifier l'Exécution Frontend/Backend** :
   Faire en sorte que l'appel `POST /orchestrate` transmette au Studio le code finalisé ou les deltas de fichiers appliqués, plutôt que de relancer une complétion monolithique parallèle dans le navigateur.

---

## 20. Verdict Final

```text
NOT READY — PLAN FIRST NOT GENUINELY AI-DRIVEN
```

Le label « Plan First » et l'affichage « Plan d'Ingénierie Volaco » avec un score de « 88% conf. » relèvent aujourd'hui d'une **illusion d'interface orchestrée par des expressions régulières et un template déterministe statique**. L'infrastructure de validation et de persistance DAG existe et fonctionne rigoureusement, mais son contenu n'est pas issu d'une intelligence artificielle.
