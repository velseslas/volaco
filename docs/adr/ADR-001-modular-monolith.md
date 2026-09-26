# ADR-001 : Architecture Monolithe Modulaire (Modular Monolith)

- **Statut** : AcceptÃ©
- **Date** : 2026-09-04
- **DÃ©cideur** : Direction Produit & Architecture VibeCode
- **Contexte** : Cahier des Charges V7.0 â€” Phase 0 & Phase 1 (FND-001)

## 1. Contexte et ProblÃ©matique
La plateforme VibeCode Studio vise Ã  fournir un environnement de dÃ©veloppement assistÃ© par IA.
Deux voies s'opposaient :
- Les microservices distribuÃ©s (complexitÃ© rÃ©seau prÃ©maturÃ©e, latence, maintenance lourde).
- Le monolithe dÃ©sordonnÃ© non typÃ© (fragilitÃ©, effets de bord incontrÃ´lÃ©s).

## 2. DÃ©cision
Nous adoptons formellement le modÃ¨le **Modular Monolith** pour les phases 1 Ã  10 :
1. **FrontiÃ¨res modulaires hermÃ©tiques** : Les communications inter-modules se font exclusivement via des interfaces TypeScript strictes.
2. **Source de vÃ©ritÃ© unifiÃ©e** : PostgreSQL pour les donnÃ©es relationnelles, systÃ¨me de fichiers/object storage pour les artefacts.
3. **Ã‰volution sans rupture** : Tout sous-module peut Ãªtre extrait en service indÃ©pendant plus tard sans rÃ©Ã©criture mÃ©tier.

## 3. ConsÃ©quences
- VÃ©locitÃ© et fiabilitÃ© maximales.
- Tests unitaires et intÃ©grÃ©s instantanÃ©s.
- ContrÃ´le strict garanti par le compilateur TypeScript.
