# AUDIT DE SÉCURITÉ DE L'API REST (API_SECURITY)

## 1. Validation des Entrées et Gestion des Payloads

- **Limitation de la taille des corps de requête :** `readBody()` applique une limite maximale de 10 Mo (`MAX_BODY_BYTES = 10 * 1024 * 1024`). Les requêtes dépassant ce seuil sont rejetées immédiatement avec un code `413 Payload Too Large`.
- **Tolérance aux erreurs de parsing JSON :** Tout corps JSON syntaxiquement invalide génère une `ValidationError` sérialisée proprement en code HTTP `400`, évitant tout plantage inopiné du serveur HTTP.
- **Normalisation des Types :** Les champs obligatoires (`name`, `tenantId`, etc.) sont typés et validés par assertions explicites.

## 2. Traçabilité des Requêtes (`X-Request-Id`)

Chaque requête entrante se voit assigner un identifiant de corrélation unique (`requestId`) sous format cryptographique (`req_${randomBytes(8).toString('hex')}`). Cet identifiant est propagé :
- Dans l'en-tête de réponse HTTP `X-Request-Id`
- Dans chaque entrée du journal structuré JSON
- Dans le journal d'audit cryptographique
- Dans les charges utiles d'erreur retournées au client
