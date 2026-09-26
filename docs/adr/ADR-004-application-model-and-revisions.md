# ADR-004 : ModÃ¨le d'Application V0, Arbre de RÃ©visions Immuable & Provenance

- **Statut** : AcceptÃ©
- **Date** : 2026-09-04
- **DÃ©cideur** : Direction Produit & Architecture VibeCode
- **Contexte** : Cahier des Charges V7.0 â€” Phase 1 (FND-004)

## 1. Contexte et ProblÃ©matique
Une plateforme de Vibecoding ne peut pas se contenter d'Ã©craser des fichiers Ã  chaque prompt.
L'utilisateur et l'IA ont besoin de :
1. ConnaÃ®tre l'historique complet des versions avec possibilitÃ© d'annuler/rÃ©tablir sans perte de donnÃ©es.
2. Savoir exactement qui a modifiÃ© quoi et pourquoi (Provenance : prompt utilisateur vs auto-rÃ©paration systÃ¨me).
3. Conserver la mÃ©moire des dÃ©cisions techniques prises (ex. choix d'une bibliothÃ¨que, structure CSS).

## 2. DÃ©cision
1. **ImmuabilitÃ© Totale des RÃ©visions** :
   - Chaque modification gÃ©nÃ¨re une nouvelle `ApplicationRevision` liÃ©e Ã  sa rÃ©vision parente.
   - Les rÃ©visions passÃ©es ne sont JAMAIS supprimÃ©es ni Ã©crasÃ©es.
2. **IntÃ©gritÃ© par Condensat SHA-256** :
   - Chaque fichier dans une rÃ©vision possÃ¨de son hash SHA-256 calculÃ© pour garantir la dÃ©tection d'altÃ©ration.
3. **Rollback par Ajout DÃ©terministe** :
   - Un rollback ne supprime pas l'historique : il crÃ©e une nouvelle rÃ©vision N+1 qui restaure l'Ã©tat des fichiers de la rÃ©vision cible, avec traÃ§abilitÃ© de l'Ã©vÃ©nement.
4. **Conservation des DÃ©cisions Techniques** :
   - Les dÃ©cisions d'architecture (`TechnicalDecision`) sont attachÃ©es aux rÃ©visions pour constituer la base de connaissance du modÃ¨le DNA futur (Phase 5).

## 3. ConsÃ©quences
- ZÃ©ro risque de perte de code lors d'une hallucination d'IA.
- Audit et diagnostics immÃ©diats.
