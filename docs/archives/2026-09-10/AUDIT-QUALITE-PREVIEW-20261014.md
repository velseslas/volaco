# AUDIT QUALITÉ PREVIEW — état réel au 14/10/2026 (preuves visuelles)

**Méthode :** 3 vraies pages générées extraites de la base + photographiées en vrai Chromium (viewport 1280×800, CDN actifs) + distribution des 153 derniers scores du Quality Gate + lecture de la grille de notation. Read-only.

## 1. Verdict

| Page (date) | Note visuelle | Détail |
|---|---|---|
| Pizzeria claire (14/10, hierarchy) | **Bien** | Palette cohérente, serif Fraunces, hero photo pro, 2 boutons, zéro erreur console. |
| Pizzeria sombre (02/10) | **Bien** | Ambiance premium tenue, hiérarchie claire, zéro erreur console. |
| Crèche + boucherie (26/09) | **Raté** | En-tête "Boucherie Tradition" + hero "crèche Montessori" + cartes viandes ; images cassées/absurdes (veste en cuir pour le "bœuf", jus d'orange pour le "porc", icône cassée pour le "poulet"). |

**Lecture honnête :** la page ratée date du **26/09 — avant** le correctif anti-accumulation (É48 : remplacement au lieu de fusion). C'est le fossile du bug, pas forcément l'état actuel. Les 2 pages récentes (dont une d'**hier soir**) sont bonnes. **Reste à prouver en direct :** une modification fraîche (coûte du crédit IA — non testé ici).

## 2. Défauts actuels visibles (même sur les bonnes pages)

1. **Recette unique** : en-tête + hero photo + 2 boutons, toujours. Propre, mais formulaïque — deux restaurants différents partagent la **même photo** Unsplash et la même structure.
2. **Titres génériques** : 2 pages sur 3 ont `<title>VibeCode Studio</title>` au lieu du nom du commerce (SEO nul).
3. **Images au hasard du stock** : quand la banque d'images ne suit pas, ça casse (page 3) — aucune vérification que l'image colle au sujet, aucun repli propre (icône cassée affichée telle quelle).

## 3. Le Quality Gate note l'hygiène, pas le goût

- 153/156 dernières exécutions notées : **min 70, médiane 100, 90 % à 100**.
- La grille (`routes/visual.ts`) compte : polices ≤ 3, couleurs ≤ 10, sections dupliquées, en-têtes/pieds multiples, rendu dispo. Rien sur : cohérence sujet/contenu ("boucherie" + "crèche" passerait), qualité des images, titres, responsive, accessibilité.
- **Un 100/100 ne veut pas dire "beau"** — il veut dire "propre". Le gate n'aurait pas attrapé la page 3.

## 4. Plan qualité (petits pas)

1. **Titre = nom du commerce** (1 ligne de prompt système) — gain SEO immédiat.
2. **Vérifier les images** : tester chaque URL d'image avant insertion (HEAD request), repli (dégradé/couleur) si cassée ; préférer des requêtes de recherche variées par sujet.
3. **Enrichir la grille du gate** : incohérence titre/contenu, images cassées (`onerror`/404), boutons sans action, contraste — sans ça, le 100/100 restera décoratif.
4. **Casser la recette** : 2-3 gabarits de mise en page alternés (centré, asymétrique, carte) pour éviter l'effet "même site".
5. **Preuve en direct** : une génération + une modification fraîches photographiées (coût : 2 flux IA) pour valider que le mélange boucherie/crèche ne se reproduit plus.

*Preuves : captures `volaco-quality/*.png` (regénables), `documents.files` (75 projets), `documents.executions` (153 scores), `routes/visual.ts:100-190`.*
