# AUDIT DES SECRETS ET VARIABLES D'ENVIRONNEMENT (SECRETS_AUDIT)

## 1. Absence de Secrets Hardcodés

Une recherche exhaustive par expressions régulières (clés privées PEM, tokens AWS/GCP, clés API OpenAI/Anthropic, mots de passe de connexion) n'a révélé aucun secret sensible en dur dans le code source de production.

## 2. Masquage Automatique dans les Logs

Le système de logging (`packages/core/src/logger.ts` et sous-systèmes associés) implémente un filtre d'assainissement automatique :
- Les tokens porteurs (`Bearer eyJ...`) sont masqués.
- Les identifiants dans les chaînes de connexion URI (`postgres://user:pass@host`) sont neutralisés.
- Les variables d'environnement étiquetées sensibles (`API_KEY`, `SECRET`, `PASSWORD`, `TOKEN`) sont remplacées par `[REDACTED]` lors de toute sérialisation vers le client ou la console.

## 3. Validation Stricte au Démarrage

En environnement de production (`NODE_ENV === 'production'`), le serveur impose la présence effective de `AUTH_SECRET` avec une entropie d'au moins 32 caractères. Le repli sur des secrets par défaut de développement est totalement interdit.
