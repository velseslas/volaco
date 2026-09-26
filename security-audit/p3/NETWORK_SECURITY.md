# SÉCURITÉ RÉSEAU ET CONTRÔLE DE FLUX — MISSION P3
**Composants :** Bind réseau, CORS, Reverse Proxy

---

## 1. Bind Réseau Involontaire
* `server.listen(config.port)` écoute sur toutes les interfaces réseau (`0.0.0.0` et `[::]`).
* Risque : Exposition directe du port 3000 au réseau local ou à Internet si le pare-feu de l'hôte n'est pas configuré.

## 2. Politique CORS
* Révocation du wildcard `*`.
* Les origines autorisées sont explicitement contrôlées via `config.allowedOrigins`.
* En mode développement uniquement, `localhost` et les origines nulles sont tolérées.
