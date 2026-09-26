# SÉCURITÉ DU DÉPLOIEMENT & CONTENEURISATION — MISSION P3
**Composants :** Scripts de démarrage, variables d'environnement

---

## 1. Constats de Déploiement
* Aucun Dockerfile ni fichier docker-compose n'est fourni dans le dépôt.
* Le script de démarrage de production exécute `node dist/apps/api/src/server.js`.
* Si l'opérateur omet `NODE_ENV=production`, le serveur démarre en mode développement permissif avec génération automatique de sessions `ENGINEER`.

## 2. Recommandations Impératives
1. Imposer le refus de démarrage si `NODE_ENV !== 'production'` et `AUTH_SECRET` non défini.
2. Définir un Dockerfile multi-stage avec utilisateur non-root (`USER node`).
3. Verrouiller le bind de `server.listen` sur `127.0.0.1` par défaut si un reverse proxy local est attendu.
