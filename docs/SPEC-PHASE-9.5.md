# Phase 9.5 — Architecture Critical

> **Document de spécification — Decision Engine + Intelligence Pool Unification**
> Date : 2026-09-24
> Inspiré par l'analyse GPT (cartographie réelle du dépôt) + worklog Super Z (`audit-ai-engine`).
> Prérequis : Phase 0 (clé cachée) → Phase 9 (orchestrateur vivant).
> Bloquant pour : Phase 10 (mutation/rollback).

---

## 1. Problème

Le code contient aujourd'hui **4 modules redondants** qui font la même chose :
- `strategy` (StrategicRecommendation, StrategicScoreBreakdown, StrategicScoreEngine)
- `evolution` (EvolutionProposal, EvolutionPriorityEngine)
- `feature-intelligence` (FeatureCandidate, FeatureValueEngine, FeaturePriorityEngine)
- `application-understanding` (SemanticFeature, SemanticInsight)

Tous : "regarde le codebase + feedback → output une liste prioritisée avec evidence[]".

Ils émettent tous des `EngineeringTaskGraph` à 3 tasks (ANALYZE → MODIFY → VERIFY) via leur `OrchestratorBridge` respectif. **Aucun consumer ne lit ces artifacts en prod** — c'est du "structured nothing" (worklog §D).

Parallèlement, le `ConversationCompass` prend des décisions de transition d'état **sans accès** :
- aux contraintes du projet (CDC, ADRs)
- à l'historique des décisions précédentes
- aux alternatives (il n'en génère qu'une)
- à la contradiction avec décisions antérieures

Le `ArchitecturalDecisionRecord` et `ContradictionDetector` existent dans `conversation-intelligence/types.ts` mais ne sont pas activement utilisés par un `DecisionEngine`.

---

## 2. Objectifs

1. **Créer un `DecisionEngine`** au centre du système, qui décide :
   - "Doit-on exécuter maintenant ?" (status: READY / BLOCKED / NEEDS_CONFIRMATION)
   - "Quelle alternative respecte les contraintes ?" (parmi N options)
   - "Cette demande contredit-elle une décision précédente ?"

2. **Fusionner les 4 modules redondants** en `intelligence-pool` avec 4 `analysts` partageant :
   - 1 `PriorityScorer(weights)` paramétrable
   - 1 `EvidenceRanker` unifié
   - 1 `LruCache` partagé
   - 1 `canonical.ts` unifié (deepFreeze + sha256)
   - Target : **−6,000 LOC de ceremony**

3. **Réviser `ConversationCompass`** pour déléguer au `DecisionEngine` :
   - `determineNextStateWithDecision(intent, decision)` : si `BLOCKED` → CLARIFYING, si `NEEDS_CONFIRMATION` → WAITING_CONFIRMATION, si `READY` → EXECUTING.

4. **Geler les modules proactifs** : `strategy/evolution/feature-intelligence` ne peuvent plus émettre des `EngineeringTaskGraph` exécutables directement. Ils émettent des `IntelligenceRecommendation` qui doivent transiter par le Decision Engine.

5. **Nouvelle route `POST /api/v1/projects/:id/decide`** : prend un `Intent`, retourne un `Decision`.

---

## 3. Architecture cible

```
                 USER message
                       │
                       ▼
        ┌──────────────────────────────┐
        │ ConversationIntelligenceSvc  │  (intent + compass + plan)
        └──────────────┬───────────────┘
                       │ intent
                       ▼
        ┌──────────────────────────────┐
        │      DECISION ENGINE         │  ←── NOUVEAU
        │  ┌────────────────────────┐  │
        │  │ ConstraintRegistry    │  │  (CDC + ADRs + conventions)
        │  │ DecisionLedger        │  │  (decisions passées)
        │  │ AlternativeGenerator  │  │  (multiple options)
        │  │ ContradictionDetector│  │  (reuse existant)
        │  └────────────────────────┘  │
        └──────────────┬───────────────┘
                       │ Decision { status, chosen, rationale }
                       ▼
        ┌──────────────────────────────┐
        │   ConversationCompass        │  ← délègue au Decision
        │   (transition pilotée)       │
        └──────────────┬───────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │  AI Orchestrator (Phase 9)   │
        └──────────────────────────────┘

  IntelligencePool (consultatif, pas décisionnel)
  ┌───────────────────────────────────────────┐
  │ StrategyAnalyst | EvolutionAnalyst |      │
  │ FeatureAnalyst  | UnderstandingAnalyst    │
  │  (4 analysts partagent 1 scorer + 1 cache) │
  └───────────────────────────────────────────┘
                       │
                       │ IntelligenceRecommendation[]
                       ▼
              Decision Engine (file d'attente proactive)
```

---

## 4. Spécification détaillée

### 4.1 — `packages/core/src/ai-native/decision-engine/types.ts`

```ts
export type DecisionVerdict =
  | 'READY'           // peut exécuter
  | 'NEEDS_CONFIRMATION'  // risque modéré, utilisateur doit valider
  | 'BLOCKED'         // contrainte violée ou contradiction
  | 'DEFERRED';       // conflit avec décision précédente, à revoir

export interface DecisionConstraint {
  readonly id: string;
  readonly source: 'CDC' | 'ADR' | 'CONVENTION' | 'USER_PREFERENCE' | 'TECHNICAL';
  readonly statement: string;
  readonly severity: 'HARD' | 'SOFT';
  readonly rationale: string;
}

export interface DecisionAlternative {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly constraintsHonored: readonly string[];   // constraint ids
  readonly constraintsViolated: readonly string[];
  readonly riskScore: number;                       // 0-100
  readonly reversible: boolean;
  readonly estimatedEffort: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly source: 'LLM' | 'INTELLIGENCE_POOL' | 'USER';
}

export interface Decision {
  readonly decisionId: string;
  readonly sessionId: string;
  readonly projectId: string;
  readonly intentGoal: string;
  readonly verdict: DecisionVerdict;
  readonly chosenAlternative?: DecisionAlternative;
  readonly alternatives: readonly DecisionAlternative[];
  readonly constraints: readonly DecisionConstraint[];
  readonly contradictingDecisions: readonly string[];  // decisionIds
  readonly rationale: string;
  readonly requiredClarifications: readonly string[];
  readonly createdAt: string;
  readonly status: 'PROPOSED' | 'ACCEPTED' | 'REJECTED' | 'SUPERSEDED';
}
```

### 4.2 — `decision-engine/constraint-registry.ts`

Charge les contraintes depuis :
1. Le CDC (parse du PDF ou fichier texte)
2. Les ADRs (`docs/adr/ADR-*.md` — 13 existants)
3. Les conventions détectées (DNA package — stack/frameworks)
4. Les user preferences (depuis `ProjectMemory.userPreferences`)

Méthodes :
- `loadConstraints(projectId)`: DecisionConstraint[]
- `addConstraint(constraint)`: void
- `getHardConstraints()`: DecisionConstraint[]
- `violates(statement)`: DecisionConstraint[]

### 4.3 — `decision-engine/decision-ledger.ts`

Persiste les décisions dans `<data-dir>/<tenantId>/<projectId>/decisions.json` via `json-disk-cache`.

Méthodes :
- `recordDecision(decision)`: void
- `getActiveDecisions()`: Decision[]
- `findContradicting(decision)`: Decision[]
- `supersede(decisionId, newDecisionId, reason)`: void

### 4.4 — `decision-engine/decision-engine.ts`

```ts
export class DecisionEngine {
  constructor(
    private readonly constraintRegistry: ConstraintRegistry,
    private readonly decisionLedger: DecisionLedger,
    private readonly alternativeGenerator: AlternativeGenerator,
    private readonly contradictionDetector: ContradictionDetector
  ) {}

  async decide(request: {
    intent: IntentResult;
    projectId: string;
    sessionId: string;
    memory: ProjectMemory;
    intelligenceRecommendations?: IntelligenceRecommendation[];
  }): Promise<Decision> {
    // 1. Charger les contraintes
    const constraints = this.constraintRegistry.loadConstraints(request.projectId);

    // 2. Générer 1 à N alternatives (via LLM ou IntelligencePool)
    const alternatives = await this.alternativeGenerator.generate(
      request.intent,
      constraints,
      request.memory,
      request.intelligenceRecommendations
    );

    // 3. Filtrer les alternatives qui violent des HARD constraints
    const viable = alternatives.filter(a => a.constraintsViolated.length === 0);

    // 4. Détecter les contradictions avec décisions passées
    const contradicting = (await this.contradictionDetector.detect({
      newDecision: { goal: request.intent.goal, alternatives: viable },
      pastDecisions: this.decisionLedger.getActiveDecisions()
    })).filter(c => c.resolved === false);

    // 5. Choisir l'alternative (riskScore le plus bas + reversibility)
    const chosen = viable.sort((a, b) => a.riskScore - b.riskScore)[0];

    // 6. Déterminer le verdict
    let verdict: DecisionVerdict;
    if (viable.length === 0) verdict = 'BLOCKED';
    else if (contradicting.length > 0) verdict = 'DEFERRED';
    else if (chosen && chosen.riskScore > 50) verdict = 'NEEDS_CONFIRMATION';
    else verdict = 'READY';

    return {
      decisionId: crypto.randomUUID(),
      sessionId: request.sessionId,
      projectId: request.projectId,
      intentGoal: request.intent.goal,
      verdict,
      chosenAlternative: chosen,
      alternatives: viable,
      constraints,
      contradictingDecisions: contradicting.map(c => c.id),
      rationale: this.buildRationale(verdict, chosen, constraints, contradicting),
      requiredClarifications: verdict === 'BLOCKED' ? this.deriveClarifications(constraints) : [],
      createdAt: new Date().toISOString(),
      status: 'PROPOSED'
    };
  }
}
```

### 4.5 — `intelligence-pool/` (fusion 4→1)

```
packages/core/src/ai-native/intelligence-pool/
├── types.ts                 (IntelligenceRecommendation, Evidence, PriorityWeights)
├── priority-scorer.ts       (1 scorer paramétrable)
├── evidence-ranker.ts       (1 ranker unifié)
├── lru-cache.ts              (1 cache partagé)
├── canonical.ts             (deepFreeze + computeHash)
├── analysts/
│   ├── strategy-analyst.ts       (was: strategy/service.ts)
│   ├── evolution-analyst.ts      (was: evolution/scoring/)
│   ├── feature-analyst.ts        (was: feature-intelligence/service.ts)
│   └── understanding-analyst.ts (was: application-understanding/service.ts)
└── index.ts
```

Tous les analysts implémentent l'interface :

```ts
export interface IntelligenceAnalyst {
  readonly id: 'strategy' | 'evolution' | 'feature' | 'understanding';
  readonly displayName: string;
  analyze(context: AnalystContext): Promise<IntelligenceRecommendation[]>;
}

export interface IntelligenceRecommendation {
  readonly id: string;
  readonly source: 'strategy' | 'evolution' | 'feature' | 'understanding';
  readonly title: string;
  readonly description: string;
  readonly score: number;                    // 0-100 from PriorityScorer
  readonly evidence: Evidence[];
  readonly targetFiles: readonly string[];
  readonly proposedActions: readonly string[];
  readonly reversible: boolean;
  readonly riskScore: number;
}

export interface AnalystContext {
  readonly projectId: string;
  readonly tenantId: string;
  readonly files: readonly { path: string; content: string }[];
  readonly feedback?: readonly { message: string; sentiment: string }[];
  readonly memory?: ProjectMemory;
}
```

### 4.6 — Révision `ConversationCompass`

Ajouter :

```ts
public determineNextStateWithDecision(
  params: {
    currentState: ConversationState;
    intent: IntentResult;
    decision: Decision;
  }
): ConversationState {
  const { currentState, intent, decision } = params;

  // Informational intents → COMPLETED
  if (['QUESTION', 'EXPLAIN', 'EXPLORATION', 'REVIEW', 'NAVIGATION'].includes(intent.category)) {
    return 'COMPLETED';
  }

  switch (decision.verdict) {
    case 'BLOCKED':
      return this.canTransition(currentState, 'CLARIFYING') ? 'CLARIFYING' : currentState;
    case 'DEFERRED':
      return this.canTransition(currentState, 'CLARIFYING') ? 'CLARIFYING' : currentState;
    case 'NEEDS_CONFIRMATION':
      return this.canTransition(currentState, 'WAITING_CONFIRMATION') ? 'WAITING_CONFIRMATION' : currentState;
    case 'READY':
      if (intent.category === 'ANALYZE') return 'UNDERSTANDING';
      return this.canTransition(currentState, 'PLANNING') ? 'PLANNING' : currentState;
    default:
      return currentState;
  }
}
```

### 4.7 — Nouvelle route `apps/api/src/routes/decide.ts`

```ts
POST /api/v1/projects/:projectId/decide
Body: { intent, message }
Response: { decision, nextState, reasoningTrace }
```

Le route handler :
1. Charge le `IntentResult` (depuis le body ou re-classifie)
2. Charge la `ProjectMemory` (depuis la session active)
3. Appelle `intelligencePool.analyzeAll()` pour collecter les recommendations consultatives
4. Appelle `decisionEngine.decide({ intent, intelligenceRecommendations, ... })`
5. Appelle `compass.determineNextStateWithDecision({ currentState, intent, decision })`
6. Retourne le tout

---

## 5. Plan d'implémentation (fichiers à créer/modifier)

### A. Créations (10 nouveaux fichiers)
1. `packages/core/src/ai-native/decision-engine/types.ts`
2. `packages/core/src/ai-native/decision-engine/constraint-registry.ts`
3. `packages/core/src/ai-native/decision-engine/decision-ledger.ts`
4. `packages/core/src/ai-native/decision-engine/alternative-generator.ts`
5. `packages/core/src/ai-native/decision-engine/decision-engine.ts`
6. `packages/core/src/ai-native/decision-engine/index.ts`

7. `packages/core/src/ai-native/intelligence-pool/types.ts`
8. `packages/core/src/ai-native/intelligence-pool/priority-scorer.ts`
9. `packages/core/src/ai-native/intelligence-pool/evidence-ranker.ts`
10. `packages/core/src/ai-native/intelligence-pool/lru-cache.ts`
11. `packages/core/src/ai-native/intelligence-pool/canonical.ts`
12. `packages/core/src/ai-native/intelligence-pool/analysts/strategy-analyst.ts`
13. `packages/core/src/ai-native/intelligence-pool/analysts/evolution-analyst.ts`
14. `packages/core/src/ai-native/intelligence-pool/analysts/feature-analyst.ts`
15. `packages/core/src/ai-native/intelligence-pool/analysts/understanding-analyst.ts`
16. `packages/core/src/ai-native/intelligence-pool/index.ts`

17. `apps/api/src/routes/decide.ts`

### B. Modifications
18. `packages/core/src/ai-native/conversation-intelligence/engine/conversation-compass.ts` — add `determineNextStateWithDecision()`
19. `apps/api/src/server.ts` — instantiate DecisionEngine + IntelligencePool + wire /decide route

### C. Tests
20. `packages/core/tests/ai-native/decision-engine/decision-engine.test.ts`
21. `packages/core/tests/ai-native/intelligence-pool/intelligence-pool.test.ts`

---

## 6. Critères de succès

- [ ] `decision-engine.test.ts` passe : 5 scénarios (READY, NEEDS_CONFIRMATION, BLOCKED, DEFERRED, contradiction)
- [ ] `intelligence-pool.test.ts` passe : 4 analysts utilisent le même `PriorityScorer` partagé
- [ ] `POST /api/v1/projects/:id/decide` répond `{ decision, nextState }`
- [ ] 982 tests existants toujours verts (pas de régression)
- [ ] Le `ConversationCompass` peut maintenant transitionner avec un `Decision`
- [ ] Aucun module `strategy/evolution/feature-intelligence` n'émet plus directement un `EngineeringTaskGraph` exécutable — ils passent tous par le DecisionEngine

---

## 7. Ce qu'on ne fait PAS (scope strict)

- ❌ Ne pas supprimer les anciens packages `strategy/`, `evolution/`, `feature-intelligence/`, `application-understanding/` — on les marque comme deprecated et on les laisse tourner pour les routes existantes (dégradation douce)
- ❌ Ne pas refactor les 16 LRU caches des autres packages — juste le faire pour les 4 fusionnés
- ❌ Ne pas implémenter le parser CDC PDF — on utilisera une version simplifiée (hardcoded constraints + ADRs)
- ❌ Ne pas toucher à Phase 10 (mutation) — Phase 9.5 bloque mais ne remplace pas Phase 10

---

**Fin de spec. Implémentation suit.**
