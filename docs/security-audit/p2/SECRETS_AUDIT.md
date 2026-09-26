# AUDIT EXHAUSTIF DES SECRETS ET DONNÉES SENSIBLES
## VOLACO-CORE — MASQUAGE UNIVERSEL ET SCAN DU CODE SOURCE

### 1. Masquage Universel des Protocoles SGBD
- Tous les protocoles courants (`postgres://`, `mysql://`, `mongodb://`, `redis://`, `amqp://`, `mssql://`) sont interceptés par `maskConnectionString()`.
- Les mots de passe sont universellement remplacés par `***`.

### 2. Sanitization des Payloads JSON et Variables Sensibles
- La fonction `sanitizePayload()` applique un filtrage récursif sur tous les objets avant journalisation dans l'AuditStore ou renvoi par l'API.
- Les motifs sensibles (`api_key`, `secret`, `token`, `password`, `database_url`, etc.) sont masqués sous forme `***MASKED***` ou `sk_...end`.

### 3. Scan d'Exposition Frontend
- Recherche exhaustive dans `apps/studio/` : **zéro secret serveur, zéro clé API Mistral, zéro token JWT hardcodé.**
