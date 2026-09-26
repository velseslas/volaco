# AUDIT DE LA GESTION DES SECRETS & CHAÎNES SENSIBLES (SEC-012)
## VOLACO-CORE — MASQUAGE DES IDENTIFIANTS ET PROTOCOLES DE BASE DE DONNÉES

### 1. Masquage Universel des URI de Bases de Données
- Composant : `packages/core/src/security/secrets.ts`.
- Fonction : `maskConnectionString(val)`.
- Protocoles couverts : `postgres://`, `postgresql://`, `mysql://`, `mongodb://`, `redis://`, `amqp://`, `mssql://`.
- Mécanisme : Toute URL de base de données contenant des identifiants voit son mot de passe systématiquement remplacé par `***` avant toute persistance ou renvoi à l'API.

### 2. Masquage des Variables d'Environnement Sensibles
- La liste blanche de masquage `SENSITIVE_KEY_PATTERN` couvre :
  `API_KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `PRIVATE_KEY`, `DATABASE_URL`, `DB_URI`, `DSN`.
- Validation : Vecteur 17 de `offensive-audit.test.ts` et `secrets-settings.test.ts` (PASS).
