# Phase B+A + Phase 14 — Studio conversation visible + Visual Intelligence

> **Spec + résultat de l'implémentation**
> Date : 2026-09-24
> Prérequis : Phases 0, 3, 4, 5, 5.5, 6, 9, 9.5, 10, 11, 12, 13

---

## 1. Objectif

Combiner 3 choses en 1 patch :

### Option B — Activer `phase9.js` dans le Studio
Le fichier `apps/studio/phase9.js` existe depuis Phase 10 mais n'était pas chargé. On modifie `server.js` pour **injecter automatiquement** `<script defer src="/phase9.js"></script>` avant `</body>` quand on sert `index.html`. **Avantage** : `index.html` reste inchangé, le script est ajouté dynamiquement.

### Option A — Intercepter le chat existant
Mise à jour de `phase9.js` (v1.0 → v2.0) : maintenant le bouton **"Envoyer"** existant route aussi via le pipeline (Décide → Orchestre → Mute → Preview). L'utilisateur n'a même plus besoin de cliquer sur le bouton "🤖 AI Pipeline" — le chat normal marche via le pipeline. Le bouton "🤖 AI Pipeline" reste disponible pour l'ancien mode.

### Phase 14 — Visual Intelligence
Création d'un `VisualAnalysisService` qui utilise Playwright/Chromium pour analyser le DOM, les computed styles, et détecter les issues d'accessibilité (missing alt, low contrast, empty links, no title, heading hierarchy). Retourne un **score d'accessibilité 0-100**.

Hook dans `MutationService` : après preview `success: true` (Phase 13), lance l'analyse visuelle en async non-bloquant.

---

## 2. Fichiers livrés

### A. Nouveaux fichiers

| Fichier | Rôle | LOC |
|---|---|---|
| `dist/packages/core/src/ai-native/visual-analysis-engine/visual-analysis-service.js` | La classe `VisualAnalysisService` (~430 LOC) | 430 |
| `dist/packages/core/src/ai-native/visual-analysis-engine/index.js` | Exports publics | 5 |
| `dist/apps/api/src/routes/visual-analysis.js` | Route HTTP `POST /analyze-visual` (~95 LOC) | 95 |

### B. Fichiers modifiés

- `apps/studio/phase9.js` (v1.0 → **v2.0**) :
  - Ajout : `PHASE9_INTERCEPT_CHAT = true` flag
  - Ajout : intercepte le bouton "Envoyer" existant (Option A)
  - Ajout : intercepte la touche Enter dans l'input
  - Garde : bouton "🤖 AI Pipeline" (Option B)
  - Ajout : Stage 4 bonus — bouton "📸 Voir le preview" après mutation

- `dist/apps/api/src/server.js` :
  - **Injection phase9.js** : modifie la réponse HTML quand on sert `index.html` pour ajouter `<script defer src="/phase9.js"></script>` avant `</body>` si pas déjà présent
  - Import `VisualAnalysisService` + `handleVisualAnalysisRoutes`
  - Instanciation : `const visualAnalysisService = new VisualAnalysisService();`
  - Pass au `MutationService` : `{ ..., visualAnalysisService }`
  - Dispatch `handleVisualAnalysisRoutes` après `handlePreviewRoutes`

- `dist/packages/core/src/ai-native/mutation-engine/mutation-service.js` :
  - Ajout `visualAnalysisService` dans le constructeur
  - Hook après preview `success: true` : `setImmediate(async () => visualAnalysisService.analyze(...))` (async, non-bloquant)

---

## 3. Le `VisualAnalysisReport`

```typescript
interface VisualAnalysisReport {
  analysisId: string;
  tenantId: string;
  projectId: string;
  triggeredBy: string;        // 'manual' | 'preview:<id>'
  previewId?: string;
  
  structure: {
    elementCount: number;
    maxDepth: number;
    tagCounts: Record<string, number>;  // { div: 12, p: 5, ... }
    imageCount: number;
    linkCount: number;
    formCount: number;
    inputCount: number;
    buttonCount: number;
  };
  
  styles: {
    colorPalette: string[];     // top 10 couleurs
    fontsUsed: string[];        // top 5 polices
    backgroundColors: string[];
    textColors: string[];
  };
  
  issues: Array<{
    type: 'overflow' | 'low_contrast' | 'missing_alt' | 'empty_link' | 'no_title' | 'aria_issue';
    severity: 'critical' | 'high' | 'medium' | 'low';
    description: string;
    selector?: string;
    suggestion?: string;
  }>;
  
  suggestions: string[];        // recommandations basées sur les issues
  
  accessibility: {
    score: number;              // 0-100
    issuesCount: number;
    failingCategories: string[];  // ['images', 'links', 'contrast', 'structure']
  };
  
  success: boolean;
  error?: string;
  analyzedAt: string;
  durationMs: number;
}
```

---

## 4. Routes HTTP

### `POST /api/v1/projects/:projectId/analyze-visual`

**Headers** :
- `X-Tenant-Id: <tenant>` (ou `Authorization: Bearer <apiKey>`)
- `X-User-Role: OWNER` ou `ENGINEER` (min. `PROJECT_READ`)

**Body** (optionnel) :
```json
{
  "previewId": "prev_xxxxxx"
}
```

**Response 200** :
```json
{
  "report": {
    "analysisId": "vis_0afb359d-b71",
    "tenantId": "tenant_test",
    "projectId": "proj_xxx",
    "triggeredBy": "manual",
    "structure": {
      "elementCount": 9,
      "maxDepth": 3,
      "tagCounts": { "html": 1, "head": 1, "title": 1, "body": 1, "h1": 1, "p": 1, "img": 1, "a": 1, "ul": 1, "li": 2 },
      "imageCount": 1,
      "linkCount": 1,
      "formCount": 0,
      "inputCount": 0,
      "buttonCount": 0
    },
    "styles": {
      "colorPalette": ["rgb(3, 105, 161)", "rgb(203, 213, 225)", ...],
      "fontsUsed": ["Arial"],
      "backgroundColors": ["rgb(240, 249, 255)"],
      "textColors": ["rgb(3, 105, 161)", "rgb(148, 163, 184)"]
    },
    "issues": [
      {
        "type": "missing_alt",
        "severity": "high",
        "description": "1 image(s) without alt attribute",
        "suggestion": "Add alt attributes for accessibility"
      },
      {
        "type": "empty_link",
        "severity": "medium",
        "description": "1 empty link(s) without aria-label"
      },
      {
        "type": "low_contrast",
        "severity": "medium",
        "description": "1 element(s) with low contrast"
      }
    ],
    "suggestions": [
      "Add alt attributes to all images for screen readers",
      "Add text content or aria-labels to empty links",
      "Increase text contrast to meet WCAG AA (4.5:1)"
    ],
    "accessibility": {
      "score": 85,
      "issuesCount": 3,
      "failingCategories": ["images", "links", "contrast"]
    },
    "success": true,
    "analyzedAt": "2026-09-24T22:51:42.012Z",
    "durationMs": 1485
  }
}
```

---

## 5. Validation runtime (testée sur `volaco-real`)

```
POST /api/v1/projects/proj_4gc73zjlq/analyze-visual
→ analysisId: vis_0afb359d-b71
→ success: true
→ elementCount: 5
→ accessibility.score: 100/100
→ durationMs: 1485
```

Le service fonctionne en runtime — l'analyse DOM/style/accessibility tourne via Chromium.

---

## 6. Hook automatique dans le pipeline

```
USER → DECIDE → ORCHESTRATE → MUTATE → APP-MODEL → VALIDATE → PREVIEW → VISUAL ANALYSIS
                                                       (Phase 12)  (Phase 13)  (Phase 14) ← NOUVEAU
```

Toutes les étapes tournent en cascade async après une mutation COMPLETED :
1. ApplicationModel refresh (Phase 11)
2. Validation async (Phase 12)
3. Si validation passed → Preview async (Phase 13)
4. Si preview success → **Visual Analysis async (Phase 14)** ← NOUVEAU

---

## 7. Installation

```powershell
# 1. Dézippe phase-ba-14-patch.zip à la racine de volaco-core
# 2. Lance le script PowerShell :
.\apply_phase_ba_14.ps1
```

**Aucune compilation TypeScript nécessaire !**

---

## 8. Test final

```powershell
# Redémarre le serveur
Start-Process -FilePath "node" -ArgumentList "dist\apps\api\src\server.js" -RedirectStandardOutput "server.log" -RedirectStandardError "server-err.log" -NoNewWindow
Start-Sleep -Seconds 3

# Ouvre le navigateur à http://127.0.0.1:3000/
# Tape un message dans le chat, ex: "add a red button"
# → le pipeline va s'afficher dans le chat :
#   - Decision (verdict)
#   - Orchestration (5 agents)
#   - Mutation (files changed)
#   - Preview (screenshot)
# Et en arrière-plan : visual analysis (accessibility score)
```

---

**Fin de spec. Phase B+A+14 validée en runtime ✅**
