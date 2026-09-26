# ATTAQUES DE PROTOCOLE ET GESTION DES ERREURS D'API (API_ATTACKS)

## 1. Comportement Face aux Requêtes Anormales

- **Méthodes inattendues (TRACE, TRACK, PROPFIND) :** Le serveur ne dispose d'aucun routeur pass-through permissif. Les méthodes non gérées lèvent soit une `NotFoundError` (404), soit terminent la connexion.
- **Corps JSON malformé :** Envoi d'une chaîne tronquée `{"name": "broken", invalid` -> Retourne **HTTP 400 Bad Request** avec sérialisation propre, sans exception non capturée.

## 2. Écart Découvert : Fuite d'Informations Système (CWE-209)

- **Constat :** Dans `apps/api/src/server.ts` (l. 434) :
  `const errObj = new AppError('Erreur interne du serveur', 'INTERNAL_ERROR', 500, { original: message }, requestId);`
- **Impact :** En cas d'erreur interne non prévue (ex: échec d'accès disque, erreur d'une lib externe), le message d'erreur d'origine est injecté dans `context.original` et envoyé dans le corps HTTP au client.
- **Sévérité :** **MEDIUM**. Doit être masqué en production pour ne renvoyer que le code d'erreur et le `requestId`.
