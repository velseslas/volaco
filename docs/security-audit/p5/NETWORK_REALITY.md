# ANALYSE DE LA RÉALITÉ RÉSEAU ET DU TRANSPORT (NETWORK_REALITY)

## 1. Host Binding & Détection de Proxy

- **Host Binding Réel :** Par défaut, `config.host` est fixé à `127.0.0.1`. Si l'opérateur configure `HOST=0.0.0.0`, le serveur écoute sur toutes les interfaces réseau physiques.
- **Hypothèse de Terminaison TLS :** Le serveur Node.js est un serveur HTTP en clair. Il repose sur un reverse proxy (Nginx, Caddy, AWS ALB) pour assurer le chiffrement TLS.
- **Faille de Configuration Optionnelle :** Si `process.env.REQUIRE_HTTPS` n'est pas explicitement valorisé à `'true'`, le serveur accepte le trafic HTTP direct en production sans émettre de redirection ou de refus.

## 2. Gestion des En-têtes de Confiance (`trustedProxies`)

- Dans `apps/api/src/server.ts` (l. 91) :
  `const isTrustedProxy = (config.trustedProxies || ['127.0.0.1', '::1']).includes(cleanSocketIp);`
- **Effet de Bord :** Comme le serveur écoute sur `127.0.0.1`, toute connexion TCP directe établie depuis la même machine (ou depuis un conteneur colocalisé) présente `req.socket.remoteAddress === '127.0.0.1'`.
- Par conséquent, si un reverse proxy écoute sur la même machine en loopback, l'en-tête `X-Forwarded-Proto: https` envoyé par un attaquant local ou via un proxy mal configuré est aveuglément accepté.
