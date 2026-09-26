# AUDIT DE SÉCURITÉ DE L'AUTHENTIFICATION (AUTH_SECURITY)

## 1. Architecture Cryptographique des Jetons

Le mécanisme d'authentification repose sur des jetons HMAC-SHA256 (JWT-like) conformes aux standards de sécurité modernes :
- **Algorithme imposé :** `HS256` (HMAC avec SHA-256). Tout jeton spécifiant un algorithme alternatif (notamment `none`, `RS256` non configuré ou inconnu) est impitoyablement rejeté à la source (`P4-AUTH-01`).
- **Signature et Intégrité :** La signature est recalculée et comparée en temps constant via `crypto.timingSafeEqual` afin d'immuniser le système contre les attaques temporelles (side-channel timing attacks).
- **Protection Anti-Tampering :** L'altération d'un seul bit dans le payload ou la signature entraîne un rejet `401 Unauthorized` (`P4-AUTH-02`).

## 2. Cycle de Vie et Expiration

- **Revendication d'expiration (`exp`) :** Chaque jeton porte une date d'expiration en secondes UTC.
- **Vérification au milliardième de seconde :** Le middleware `authMiddleware` compare le timestamp actuel avec l'échéance. Les jetons expirés sont rejetés avec un code `401` (`P4-AUTH-03`).

## 3. Robustesse du Secret Maître (`AUTH_SECRET`)

- **Contrainte de taille :** Un secret cryptographique robuste d'au moins 32 caractères est exigé (`validateAuthSecret`).
- **Fail-Fast au démarrage :** Si la variable d'environnement `AUTH_SECRET` est manquante ou sous-dimensionnée, le serveur refuse catégoriquement d'ouvrir son port d'écoute et interrompt le processus (`P4-AUTH-05`).

## 4. Résistance aux Payloads Malveillants

Des tests adversariaux ont soumis le parseur d'en-tête `Authorization: Bearer <token>` à des entrées contenant :
- Des octets nuls (`\x00`)
- Des payloads de taille anormale (> 10 Ko)
- Des chaînes non base64
- Des structures à 1, 2 ou 4 segments
Dans tous les cas, le middleware intercepte l'anomalie sans planter le runtime Node.js et retourne un code HTTP `401`.
