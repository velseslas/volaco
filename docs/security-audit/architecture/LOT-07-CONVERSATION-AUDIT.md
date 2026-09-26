# LOT 07 — AUDIT DU PARCOURS CONVERSATIONNEL RÉEL DE VOLACO
# CONVERSATION → INTENT → COMPASS → PLAN → CONFIRMATION → ORCHESTRATOR → AGENTS → VALIDATION → RÉSULTAT

**Date d'audit :** 2026-09-15
**Mode :** STRICT READ-ONLY — ZÉRO MODIFICATION DE CODE
**Statut :** ✅ AUDIT COMPLET

---

## 0. RÉSUMÉ EXÉCUTIF

> **Le problème observé est confirmé par l'audit.**
> 
> Lorsqu'un utilisateur écrit une demande dans le Studio, l'interface affiche
> "Codestral conçoit votre application sur-mesure..." puis "créée par Codestral !"
> et l'application apparaît.
>
> **Ce comportement est correct du point de vue de l'utilisateur final — mais il
> court-circuite ENTIÈREMENT l'architecture conversationnelle cible de Volaco.**
>
> La chaîne ConversationIntelligence → IntentEngine → CompassEngine → PlanGenerator
> → Confirmation → AIOrchestrator → AgentRuntime → Validation est **100% bypassée**
> dans le flux principal du Studio.

---

## 1. ARCHITECTURE PHYSIQUE DES FICHIERS

### 1.1 Studio Frontend

| Fichier | Taille | Rôle |
|---------|--------|------|
| `apps/studio/index.html` | 984 KB / 13 295 lignes | Application monolithique — TOUTE la logique JS est inline dans ce fichier HTML unique |
| `apps/studio/volaco_studio.html` | 972 KB | Version alternative / ancienne du Studio — même structure monolithique |
| `apps/studio/client.js` | 776 bytes | Loader mince, non significatif |

**Constats :**
- ❌ Aucun bundle JS séparé n'est utilisé
- ❌ Aucun import ES module vers les packages `packages/core/src/ai-native/`
- ❌ Le frontend est un document HTML auto-contenu

### 1.2 API Routes disponibles

```
apps/api/src/routes/
├── ai.ts              (18 KB, 426 lignes) — Proxy Mistral brut
├── conversations.ts   (19 KB, 598 lignes) — ConversationIntelligenceService ← INUTILISÉ par le Studio
├── studio.ts          (2.6 KB, 79 lignes) — Shell HTML uniquement
├── executions.ts      (5.8 KB)
├── mutations.ts       (5.8 KB)
└── ... (14 autres routes)
```

### 1.3 Packages AI-Native disponibles (TOUS inutilisés par le Studio)

```
packages/core/src/ai-native/
├── conversation-intelligence/   ← LOT 03 — ConversationIntelligenceService
├── agent-runtime/               ← LOT 06 — AgentRuntimeService
├── ai-orchestrator/             ← LOT 05 — AIOrchestratorService
├── mutation-orchestrator/       ← LOT 07 — MutationOrchestratorService
├── application-model/           ← LOT 04 — ApplicationModelService
└── ... (10 autres packages)
```

---

## 2. PARCOURS RÉEL — TRACE COMPLÈTE DU FLUX STUDIO

### 2.1 Point d'entrée : `handleWorkspacePromptSubmit` (L10348–L10844)

L'utilisateur tape une demande dans `#wsPromptInput` et soumet.

**Étape 1 — Affichage du message utilisateur (L10361–L10386)**
```
appendChatMessage('user', userMessageHtml, true)
```

**Étape 2 — Détection de commandes slash (L10394–L10502)**

La fonction vérifie séquentiellement si le texte correspond à des commandes spéciales :

| Condition | Route | Backend appelé |
|-----------|-------|----------------|
| `/audit` ou texte contenant "audit app/qualit/sécurit" | `openAuditModal()` + return | ❌ Aucun |
| `/features` / `/opportunities` | `requestWorkspaceSubTab('features')` + return | ❌ Aucun |
| `/feedback` / `/bugs` | `requestWorkspaceSubTab('feedback')` + return | ❌ Aucun |
| `/strategy` / `/roadmap` | `requestWorkspaceSubTab('strategy')` + return | ❌ Aucun |
| `/evolution` / `/health` | `requestWorkspaceSubTab('evolution')` + return | ❌ Aucun |

**Étape 3 — Détection du scénario de génération (L10504–L10616)**
```
const isExplicitTemplate = /^\/template\b/i.test(cleanP)  // SCÉNARIO A
const hasAiKey = isAiReady()                                // SCÉNARIO B ou C
```

**SCÉNARIO A : Template explicite (/template xxx) — L10509–L10567**
```
generateInstantApp(text)  // Retourne du HTML statique prédéfini — AUCUN appel API
```
→ Aucun backend appelé. Code HTML statique chargé directement.

**SCÉNARIO B : Pas de clé IA — L10569–L10606**
```
appendChatMessage('assistant', '...clé IA requise...')
```
→ Formulaire inline pour entrer la clé. Aucune génération.

**SCÉNARIO C : Clé IA présente — L10608–L10843 ← PATH PRINCIPAL**

Détection modification vs création (L10610–L10616) :
```js
const isModification = Boolean(currentAppHtml && currentAppHtml.length > 200
  && isExplicitModification && !isCreationPrompt);
```

**SCÉNARIO C1 — CRÉATION (L10625–L10737) ← CHEMIN LE PLUS FRÉQUENT**

```
L10628: renderWorkspaceIframe(createAiLoadingScreen(text))   // "Création en cours..."
L10653: authenticatedFetch("/api/v1/ai/chat/completions", {  // ← APPEL DIRECT PROXY MISTRAL
          method: "POST",
          body: JSON.stringify({
            model: "codestral-latest",
            messages: [systemPrompt, userPrompt],
            temperature: 0.2,
            max_tokens: 8192
          })
        })
L10672: data.choices[0].message.content                     // HTML brut
L10676: renderWorkspaceIframe(clean)                        // Affichage
L10700: appendChatMessage('assistant', "créée par Codestral!")
```

**SCÉNARIO C2 — MODIFICATION (L10739–L10842)**

```
L10762: authenticatedFetch("/api/v1/ai/chat/completions", {  // ← APPEL DIRECT PROXY MISTRAL
          body: JSON.stringify({
            messages: [systemPrompt, { role: "user", content: currentAppHtml + demande }]
          })
        })
L10804: appendChatMessage('assistant', "Modifications appliquées par Codestral!")
```

### 2.2 Résumé du flux réel

```
USER INPUT
    │
    ▼
handleWorkspacePromptSubmit (L10348)
    │
    ├─► /audit /features /strategy... → UI locale uniquement, return
    │
    ├─► /template → generateInstantApp() → HTML statique, return
    │
    ├─► sans clé → message "clé requise", return
    │
    └─► avec clé (scénario le plus fréquent)
            │
            ├─► CRÉATION: createAiLoadingScreen() + authenticatedFetch("/api/v1/ai/chat/completions")
            │             → Proxy Mistral brut (ai.ts) → Mistral Codestral API
            │             → HTML brut → renderWorkspaceIframe()
            │
            └─► MODIFICATION: authenticatedFetch("/api/v1/ai/chat/completions")
                              → Proxy Mistral brut (ai.ts) → Mistral Codestral API
                              → HTML modifié → renderWorkspaceIframe()
```

---

## 3. AUDIT DE LA ROUTE `/api/v1/ai/chat/completions` (ai.ts)

**Fichier :** `apps/api/src/routes/ai.ts` (426 lignes)

### 3.1 Ce que fait la route

| Étape | Code | Description |
|-------|------|-------------|
| 1 | L186 | `assertPermission(context.role, 'PROJECT_MUTATE', requestId)` |
| 2 | L210–229 | Concurrency guard — max requests per tenant |
| 3 | L249 | `sanitizeAiMessages(parsedBody.messages, { allowSystem: false })` |
| 4 | L275 | `fetch('https://api.mistral.ai/v1/chat/completions', ...)` ← APPEL DIRECT MISTRAL |
| 5 | L296 | Fallback: `fetch('https://codestral.mistral.ai/v1/chat/completions', ...)` (sur 401/5xx) |
| 6 | L319 | Fallback réseau: `fetch('https://codestral.mistral.ai/v1/chat/completions', ...)` |
| 7 | L346–353 | `aiUsageTracker.recordUsage(...)` |
| 8 | — | `res.end(resData)` — streaming de la réponse brute |

### 3.2 Ce que la route NE fait PAS

- ❌ N'appelle PAS `ConversationIntelligenceService`
- ❌ N'appelle PAS `IntentEngine` / `ConversationIntentEngine`
- ❌ N'appelle PAS `CompassEngine` / `ConversationCompass`
- ❌ N'appelle PAS `PlanGenerator`
- ❌ N'appelle PAS `AIOrchestratorService`
- ❌ N'appelle PAS `AgentRuntimeService`
- ❌ N'appelle PAS `MutationOrchestratorService`

**Verdict : `/api/v1/ai/chat/completions` est un proxy Mistral brut. Point.**

---

## 4. AUDIT DE LA ROUTE `conversations.ts` (598 lignes)

### 4.1 Ce que la route fait

`conversations.ts` importe et utilise `conversationIntelligenceService` (L7–11) :

```ts
import { conversationIntelligenceService, ... }
  from '../../../../packages/core/src/ai-native/conversation-intelligence/index.js';
```

Elle expose 14 routes REST :

| Route | Méthode | Appel service |
|-------|---------|---------------|
| `/conversations` | POST | `conversationIntelligenceService.createSession(...)` |
| `/conversations` | GET | `conversationIntelligenceService.listSessions(...)` |
| `/conversations/:id` | GET | `conversationIntelligenceService.getSession(...)` |
| `/conversations/:id/messages` | POST | `conversationIntelligenceService.processTurn(...)` ← **CLEF** |
| `/conversations/:id/context` | GET | `...getConversationContext(...)` |
| `/conversations/:id/decisions` | POST | `...recordDecision(...)` |
| `/conversations/:id/confirm` | POST | `...confirmPlan(...)` |
| `/conversations/:id/plans` | POST | `...generatePlanForConversation(...)` |
| `/conversations/:id/plans` | GET | `...listPlans(...)` |
| `/conversations/:id/plans/:planId` | GET | `...getPlan(...)` |
| `/conversations/:id/plans/:planId/validate` | POST | `...validatePlan(...)` |
| `/conversations/:id/plans/:planId/confirm` | POST | `...confirmPlan({ targetStatus: 'CONFIRMED' })` |
| `/conversations/:id/plans/:planId/reject` | POST | `...rejectPlan(...)` |
| `/conversations/:id/plans/:planId/revise` | POST | `...revisePlan(...)` |

### 4.2 Ce que le Studio fait avec conversations.ts

**Rien.** Zéro appel depuis `apps/studio/index.html` vers une URL
`/api/v1/projects/:id/conversations` ou similaire.

La route `conversations.ts` est un service backend complet et fonctionnel qui
**n'est appelé par aucun chemin de code du Studio principal.**

---

## 5. AUDIT DE LA ROUTE `studio.ts` (79 lignes)

Deux routes uniquement :

| Route | Description |
|-------|-------------|
| GET `/api/v1/projects/:projectId/shell` | Renvoie un ViewModel de shell via `StudioShellService.getShellViewModel()` |
| GET `/shell` ou `/studio` ou `/` | Renvoie le HTML du Studio via `StudioShellService.renderShellHtml()` |

**Aucun appel IA. Aucune connexion à ConversationIntelligence ou autre AI-native package.**

---

## 6. AUDIT DU MOTEUR LOCAL JS (DEAD CODE)

### 6.1 Fonctions définies dans index.html (L6620–L6870)

| Fonction | Ligne | Description |
|----------|-------|-------------|
| `setCompassState(state, ...)` | L6627 | Met à jour les classes CSS de `compassStep-1` à `compassStep-5` |
| `analyzeUserIntent(prompt)` | L6659 | Classifieur lexical local (regex sur keywords) |
| `generateEngineeringPlan(prompt, intent, targetCode)` | L6705 | Générateur de plan statique hardcodé |
| `executePlanAction(planId)` | L6790 | Exécute un plan en appliquant `plan.targetCode` directement |
| `dismissPlanAction(planId)` | L6862 | Ignore un plan |

### 6.2 `analyzeUserIntent` — Implémentation réelle

**Ce n'est PAS une IA.** C'est un classifieur par expressions régulières :

```js
function analyzeUserIntent(prompt) {
  const p = prompt.toLowerCase();
  let type = "CREATE_FEATURE";
  if (/calcul|dosage|béton|formule/i.test(p)) type = "LOGIC_&_COMPUTATION";
  else if (/couleur|thème|style/i.test(p)) type = "UPDATE_STYLE";
  else if (/supprime|retire|delete/i.test(p)) type = "REFACTOR_DELETE";
  else if (/audit|sécurité/i.test(p)) type = "AUDIT_VALIDATION";
  else if (/bouton|menu|modal/i.test(p)) type = "CREATE_COMPONENT";
  return { type, domain, risk, confidence: 98, description };
}
```

**Confiance toujours entre 94 et 99 — sans aucun fondement probabiliste.**

### 6.3 `generateEngineeringPlan` — Implémentation réelle

Ce n'est PAS un planificateur IA. C'est un switch/regex sur des templates hardcodés :

```js
function generateEngineeringPlan(prompt, intent, targetCode) {
  if (/gmail|e-?mail/i.test(p)) {
    planTitle = "Création de la Messagerie Webmail (Clone Gmail)";
    steps = [ { num:"1", title:"Navigation & Dossiers", ... }, ... ]; // HARDCODÉ
  } else if (/facebook/i.test(p)) { ... }
  // ...
  return { id: 'plan-'+Date.now(), status: "WAITING_CONFIRMATION", ... };
}
```

**Plans entièrement prédéfinis. Aucun appel à PlanGenerator du backend.**

### 6.4 Constat CRITIQUE : Fonctions jamais appelées

La recherche exhaustive confirme que **`analyzeUserIntent`, `generateEngineeringPlan`
et `executePlanAction` ne sont JAMAIS appelées** dans `handleWorkspacePromptSubmit`
ni dans aucune autre fonction de `apps/studio/index.html`.

**Ces fonctions sont du DEAD CODE — implémentées mais jamais invoquées dans le flux principal.**

Elles sont potentiellement utilisées dans `volaco_studio.html` (autre version du Studio)
via un sous-flux différent (non audité ici).

---

## 7. MATRICE DES COMPOSANTS : ÉTAT DE CONNEXION

| Composant | Existe | Testé | Exposé via API | Appelé par Studio | Verdict |
|-----------|--------|-------|---------------|------------------|---------|
| `ConversationIntelligenceService` | ✅ | ✅ (65/65) | ✅ (`conversations.ts`) | ❌ | **BYPASSÉ** |
| `ConversationIntentEngine` | ✅ | ✅ | Encapsulé dans service | ❌ | **BYPASSÉ** |
| `ConversationCompass` | ✅ | ✅ | Encapsulé dans service | ❌ | **BYPASSÉ** |
| `PlanGenerator` | ✅ | ✅ | Encapsulé dans service | ❌ | **BYPASSÉ** |
| `PlanValidator` | ✅ | ✅ | Via `conversations.ts` | ❌ | **BYPASSÉ** |
| `PlanRepository` | ✅ | ✅ | Via `conversations.ts` | ❌ | **BYPASSÉ** |
| `AIOrchestratorService` | ✅ | ✅ (tests LOT 05) | ❌ Aucune route | ❌ | **NON CÂBLÉ** |
| `AgentRuntimeService` | ✅ | ✅ (tests LOT 06) | ❌ Aucune route | ❌ | **NON CÂBLÉ** |
| `MutationOrchestratorService` | ✅ | ✅ (tests LOT 07) | ❌ Aucune route | ❌ | **NON CÂBLÉ** |
| Proxy Mistral brut (`ai.ts`) | ✅ | ✅ | ✅ (`/api/v1/ai/chat/completions`) | ✅ ← SEUL UTILISÉ | **UTILISÉ (LEGACY)** |
| Local JS intent engine | ✅ (dead code) | ❌ | N/A | ❌ | **DEAD CODE** |
| Local JS plan engine | ✅ (dead code) | ❌ | N/A | ❌ | **DEAD CODE** |
| Local CompassStep UI | ✅ (CSS only) | N/A | N/A | ❌ (dead code path) | **COSMÉTIQUE SEULEMENT** |

---

## 8. PROBLÈMES IDENTIFIÉS — CLASSIFICATION P0/P1/P2

### P0 — BLOQUANT CRITIQUE (Architecture non conforme)

**P0-001 : Le Studio n'utilise PAS la chaîne conversationnelle cible**

**Preuve :** `handleWorkspacePromptSubmit` (L10348–L10844) appelle uniquement
`authenticatedFetch("/api/v1/ai/chat/completions", ...)` — le proxy Mistral brut.
Aucun appel à `/api/v1/projects/:id/conversations` ni à aucun endpoint de
`conversations.ts`.

**Impact :** L'architecture conversationnelle complète construite dans les LOTs 03–07
(ConversationIntelligence, IntentEngine, CompassEngine, PlanGenerator, PlanValidator,
Confirmation, AIOrchestratorService, AgentRuntimeService, MutationOrchestratorService)
est **100% bypassée** dans l'expérience utilisateur réelle.

---

**P0-002 : `AIOrchestratorService` et `AgentRuntimeService` ne sont câblés dans aucune route**

**Preuve :** Recherche exhaustive dans `apps/api/src/routes/` — aucun fichier n'importe
`AIOrchestratorService` ou `AgentRuntimeService`. Ces services existent uniquement
dans les tests (`lot06-agent-runtime.test.ts` L30/L873).

**Impact :** Même si le Studio appelait `conversations.ts`, l'Orchestrateur et
l'Agent Runtime ne seraient pas exécutés. La génération resterait simple.

---

**P0-003 : `MutationOrchestratorService` ne dispose d'aucune route HTTP**

**Preuve :** `apps/api/src/routes/mutations.ts` existe mais gère un service différent.
La recherche sur `MutationOrchestratorService` dans les routes retourne zéro résultats.

**Impact :** Le moteur de mutation atomique (LOT 07) n'est jamais exécuté.

---

### P1 — IMPORTANT (Tromperie architecturale)

**P1-001 : Les fonctions `analyzeUserIntent`, `generateEngineeringPlan`,
`executePlanAction` sont du dead code non invoqué**

**Preuve :** Aucune occurrence de `analyzeUserIntent(` ou `generateEngineeringPlan(`
hors de leur définition dans `index.html`. Script de recherche exhaustif : DONE — 0 résultat.

**Impact :** Le commentaire à L9905 "Real-Time Prompt Handling with Intent Engine,
Conversation Compass & Plan Engine (CDC V7.0)" est trompeur — il décrit des intentions
non implémentées dans le flux actif.

---

**P1-002 : L'UI Compass (compassStep-1 à compassStep-5) est cosmétique**

**Preuve :** Les éléments DOM `#compassStep-1` à `#compassStep-5` sont manipulés
par `setCompassState()`, qui elle-même n'est appelée que depuis `executePlanAction()`
— dead code.

**Impact :** La barre de progression visuelle du Compass ne reflète aucune étape
réelle du backend.

---

**P1-003 : Les clés de confiance de l'intent engine local sont fictives**

**Preuve :** `analyzeUserIntent` retourne toujours des valeurs `confidence` de 94–99
calculées par un classifieur regex, sans fondement probabiliste.

**Impact :** Si cette fonction était réactivée, les scores affiché à l'utilisateur
seraient trompeurs.

---

### P2 — MINEUR (Dette technique)

**P2-001 : Deux versions du Studio coexistent (index.html et volaco_studio.html)**

**Preuve :** Les deux fichiers ont des tailles similaires (984 KB vs 972 KB) et
contiennent des fonctions identiques (`analyzeUserIntent` présente dans les deux).
Risque de divergence silencieuse.

**P2-002 : Pas de streaming SSE dans le flux de création**

**Preuve :** L10653 — `authenticatedFetch` attend la réponse complète (`await res.json()`).
Pas de `ReadableStream` / SSE. L'interface affiche "en cours..." puis la page complète
— sans feedback progressif.

**P2-003 : Timeout fixe de 120 secondes**

**Preuve :** L10650 — `setTimeout(() => controller.abort(), 120000)`.
Pas de retry intelligent ni de backoff progressif.

---

## 9. FLUX CIBLE VS FLUX RÉEL

### Flux CIBLE (architecture LOTs 03–07)

```
USER INPUT
    │
    ▼
POST /api/v1/projects/:id/conversations/:convId/messages
    │
    ▼
ConversationIntelligenceService.processTurn()
    ├─► ConversationIntentEngine.classify()
    ├─► ConversationCompass.updateState()
    ├─► ClarificationEngine (si ambigu)
    └─► PlanGenerator.generate()
    │
    ▼
Plan affiché → Confirmation utilisateur
    │
    ▼
POST /api/v1/.../plans/:planId/confirm
    │
    ▼
AIOrchestratorService.orchestrate()
    └─► AgentRuntimeService.runAgent(...)
         └─► MutationOrchestratorService.applyMutation(...)
    │
    ▼
RÉSULTAT VALIDÉ → Application modifiée
```

### Flux RÉEL (ce que le code fait aujourd'hui)

```
USER INPUT
    │
    ▼
handleWorkspacePromptSubmit (JS inline, index.html L10348)
    │
    ├─► Commandes slash → UI locale uniquement
    ├─► /template → HTML statique local
    ├─► Pas de clé → Message "clé requise"
    └─► Clé présente:
             │
             ▼
        POST /api/v1/ai/chat/completions  (PROXY MISTRAL BRUT)
             │
             ▼
        Mistral Codestral API → HTML brut
             │
             ▼
        renderWorkspaceIframe(html)
        "créée par Codestral !"
```

**Delta : La totalité de l'architecture conversationnelle est sautée.**

---

## 10. RECOMMANDATIONS POUR LOT 08

> ⚠️ Section informative uniquement — aucune modification n'est faite dans cet audit.

Pour connecter le Studio à l'architecture conversationnelle réelle, LOT 08 devrait :

1. **Remplacer l'appel direct à `/api/v1/ai/chat/completions`** dans
   `handleWorkspacePromptSubmit` par un appel à
   `POST /api/v1/projects/:id/conversations/:convId/messages`

2. **Câbler `AIOrchestratorService` et `AgentRuntimeService`** dans une nouvelle
   route (ex: `executions.ts`) appelée après confirmation du plan

3. **Câbler `MutationOrchestratorService`** pour appliquer les mutations atomiques
   validées par l'agent runtime

4. **Remplacer le polling/attente par SSE** pour afficher la progression réelle des
   étapes Compass (IntentEngine → PlanGenerator → Confirmation → Orchestrator → Agent)

5. **Supprimer ou intégrer le dead code** (`analyzeUserIntent`, `generateEngineeringPlan`,
   `executePlanAction`) — soit les connecter au flux principal, soit les retirer

---

## 11. VERDICT FINAL

| Question | Réponse |
|----------|---------|
| Le Studio appelle-t-il `ConversationIntelligenceService` ? | ❌ NON |
| Le Studio appelle-t-il `IntentEngine` (backend) ? | ❌ NON |
| Le Studio affiche-t-il la Compass du backend ? | ❌ NON |
| Le Studio appelle-t-il `PlanGenerator` (backend) ? | ❌ NON |
| Le Studio demande-t-il une confirmation structurée (plans) ? | ❌ NON |
| Le Studio appelle-t-il `AIOrchestratorService` ? | ❌ NON |
| Le Studio appelle-t-il `AgentRuntimeService` ? | ❌ NON |
| Le Studio appelle-t-il `MutationOrchestratorService` ? | ❌ NON |
| Le Studio appelle-t-il `/api/v1/ai/chat/completions` directement ? | ✅ OUI (seul appel AI) |
| Les tests LOT 03–07 passent-ils ? | ✅ OUI (tous isolés du Studio) |
| L'expérience utilisateur réelle est-elle conforme à l'architecture cible ? | ❌ NON |

**CONCLUSION : L'architecture conversationnelle de Volaco (LOTs 03–07) est entièrement
fonctionnelle et testée — mais elle n'est pas câblée au Studio. Le Studio utilise un
chemin direct Mistral proxy. LOT 08 doit connecter ces deux mondes.**

---

*Audit généré le 2026-09-15T09:23:47.986Z — Mode READ-ONLY strict — Zéro modification de code*
*Auditeur : Antigravity LOT 07 Conversation Audit*
