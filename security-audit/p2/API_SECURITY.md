# SÉCURITÉ DE L'API REST ET RÉSISTANCE AUX ATTAQUES HTTP
## VOLACO-CORE — PROTOCOLE, VALIDATION DES FLUX ET LIMITES DE CORPS

### 1. Validation Précoce des Corps de Requête
- Vérification du `Content-Length` déclaré avant lecture des flux pour rejeter immédiatement les requêtes abusives avec code HTTP 413.
- Coupure immédiate du flux en streaming chunked dès que le cumul d'octets reçus dépasse la limite allouée.
- Limites calibrées :
  - `MAX_BODY_BYTES_DEFAULT` : 1 Mo (endpoints JSON standards).
  - `MAX_BODY_BYTES_SMALL` : 256 Ko (réglages et rollbacks).
  - `MAX_BODY_BYTES_FILES` : 10 Mo (transfert de fichiers de code source).

### 2. Gestion des Erreurs et Réponses Structurées
- Toutes les erreurs retournent un objet JSON typé conforme à `ErrorDetails` (`code`, `message`, `statusCode`, `requestId`).
- Aucune trace de pile (stack trace) ni secret interne n'est divulgué aux clients distants en cas d'erreur de validation ou d'échec serveur.
