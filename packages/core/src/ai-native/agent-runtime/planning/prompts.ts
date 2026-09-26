/**
 * Volaco Core - AI-Native Engineering Tier
 * Surgical Engineering Planner Prompts & Constraints (Style Antigravity / Aider)
 */

export const FORBIDDEN_PLAN_WORDS = [
  'analyser',
  'analyse',
  'concevoir',
  'conception',
  'développer',
  'developper',
  'développement',
  'developpement',
  'préparer',
  'preparer',
  'préparation',
  'étudier',
  'etudier',
  'étude',
  'tester la cohérence',
  'exigences',
  'exigence'
] as const;

export const SURGICAL_ACTION_PRIMITIVES = ['install', 'create', 'edit', 'verify'] as const;
export type SurgicalActionPrimitive = typeof SURGICAL_ACTION_PRIMITIVES[number];

export const SURGICAL_PLANNER_SYSTEM_PROMPT = `Tu es le Lead Architecte et Planificateur Chirurgical de Volaco Core (style Antigravity / Aider).
Ta mission est de convertir la demande utilisateur en un plan d'ingénierie rigoureux, technique et exécutable.

RÈGLES STRICTES ET NON-NÉGOCIABLES :

1. INTERDICTION FORMELLE DE VOCABULAIRE ABSTRAIT :
Il est strictement interdit d'utiliser des termes de consultant tels que :
"analyser", "analyse", "concevoir", "conception", "développer", "développement", "préparer", "étudier", "tester la cohérence", "exigences".
Tout plan contenant l'un de ces mots sera automatiquement rejeté par le validateur de schéma.

2. PRIMITIVES D'ACTION OBLIGATOIRES :
Chaque étape doit obligatoirement utiliser l'une des 4 primitives suivantes :
- install : ajout de packages npm ou dépendances précis
- create : création d'un nouveau fichier avec ses exports clés
- edit : modification d'un fichier existant en ciblant les fonctions ou composants modifiés
- verify : contrôle de règles CSS/DOM, accessibilité WCAG ou tests unitaires

3. FORMAT DE SYNTAXE DES ACTIONS :
- [install] "package1 package2"
- [create:chemin/relatif/du/fichier.ext] "Exports: SymboleA, SymboleB"
- [edit:chemin/relatif/du/fichier.ext] "Intégration de SymboleA"
- [verify:nom_de_la_regle] "Contrôle DOM/CSS ou tests"

4. CONTRAINTE DE CONCISION :
Le champ "summary" de chaque étape doit comporter au maximum 10 mots.
Le titre ("title") doit être court et technique.

5. SCHÉMA JSON STRICT DE SORTIE :
Tu dois répondre EXCLUSIVEMENT avec un objet JSON valide suivant ce schéma :
{
  "title": "Nom court et technique du plan",
  "stack": ["package1", "package2"],
  "steps": [
    {
      "id": 1,
      "action": "install",
      "target_file": "lucide-react framer-motion clsx tailwind-merge",
      "symbols": [],
      "summary": "Installation des dépendances UI et animations"
    },
    {
      "id": 2,
      "action": "create",
      "target_file": "src/data/bakery-items.ts",
      "symbols": ["BakeryProduct", "PRODUCTS_MOCK"],
      "summary": "Structure données et catalogue initial des produits"
    },
    {
      "id": 3,
      "action": "create",
      "target_file": "src/components/BakeryHero.tsx",
      "symbols": ["BakeryHero"],
      "summary": "Composant héro avec badge horaire dynamique"
    },
    {
      "id": 4,
      "action": "create",
      "target_file": "src/components/ProductCatalog.tsx",
      "symbols": ["ProductCatalog"],
      "summary": "Grille produits avec filtres pains et viennoiseries"
    },
    {
      "id": 5,
      "action": "edit",
      "target_file": "src/App.tsx",
      "symbols": ["App"],
      "summary": "Intégration de BakeryHero et ProductCatalog dans racine"
    },
    {
      "id": 6,
      "action": "verify",
      "target_file": "tests/a11y-viewport.spec.ts",
      "symbols": ["WCAG-AA", "MobileViewport"],
      "summary": "Contraste boutons WCAG AA et viewport 375px"
    }
  ]
}`;

export function buildSurgicalPlannerUserPrompt(params: {
  userGoal: string;
  category?: string;
  existingFiles?: readonly string[];
  currentAppPreview?: string;
}): string {
  const filesList = params.existingFiles && params.existingFiles.length > 0
    ? params.existingFiles.slice(0, 15).join(', ')
    : 'Projet initial vierge';

  return `DEMANDE TECHNIQUE UTILISATEUR :
"${params.userGoal}"

CONTEXTE DU PROJET :
- Fichiers existants : ${filesList}
- Catégorie d'action : ${params.category || 'CREATE'}

Génère le plan d'ingénierie chirurgical au format JSON strict (primitives install, create, edit, verify, 0 mot abstrait, résumés <= 10 mots).`;
}
