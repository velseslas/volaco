# AUDIT DE SÉCURITÉ RÉSEAU ET TRANSPORT (NETWORK_SECURITY)

## 1. Verrouillage du Port d'Écoute (Safe Host Binding)

- **Configuration par défaut :** En mode production, le serveur HTTP écoute exclusivement sur l'interface locale de bouclage `127.0.0.1` (`P4-NET-02`).
- **Prévention d'Exposition Directe :** Cela empêche toute exposition accidentelle directe sur Internet (`0.0.0.0`) sans passer par la terminaison TLS/HTTPS du reverse-proxy (Nginx, Traefik, etc.).

## 2. En-têtes de Sécurité HTTP

Toutes les réponses HTTP émises par l'API intègrent les en-têtes durcis suivants (`P4-NET-01`) :
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` : Force le trafic en HTTPS avec politique de pré-chargement navigateur.
- `X-Content-Type-Options: nosniff` : Interdit au navigateur de deviner le type MIME d'un fichier.
- `X-Frame-Options: SAMEORIGIN` : Empêche le détournement de clic (clickjacking) depuis des domaines tiers.
- `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:;` : Confinement strict de l'environnement d'exécution du navigateur.
- `Referrer-Policy: strict-origin-when-cross-origin` : Protège les URLs sensibles lors de requêtes sortantes.
- `Permissions-Policy: camera=(), microphone=(), geolocation=()` : Désactive l'accès aux périphériques physiques sensibles.
