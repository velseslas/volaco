# CHAÎNES D'ATTAQUE COMPOSITES — MISSION P3
**Analyse de 15 chaînes d'attaque réalistes contre volaco-core.**

---

### Chaîne 1 : Accès Réseau Externe & Session de Développement
* **Étape 1 :** L'administrateur démarre le serveur via `node dist/apps/api/src/server.js` sans définir `NODE_ENV=production`.
* **Étape 2 :** Le serveur bind sur `0.0.0.0:3000` en HTTP clair.
* **Étape 3 :** Un attaquant sur le même sous-réseau ou via internet interroge `POST /api/v1/auth/session`.
* **Étape 4 :** L'API délivre un jeton JWT avec le rôle `ENGINEER` pour `default-tenant`.
* **Résultat :** Compromission du tenant par défaut avec droits de modification et d'accès aux fichiers.
* **Bloqué par :** Doit être bloqué par l'obligation absolue de `NODE_ENV=production` au démarrage.

### Chaîne 2 : Déni de Service de Quota Multi-Tenant Anonyme
* **Étape 1 :** Un attaquant identifie l'identifiant d'un locataire cible (ex: `tenant-acme`).
* **Étape 2 :** L'attaquant envoie en boucle 60 requêtes HTTP avec l'en-tête `X-Tenant-Id: tenant-acme`.
* **Étape 3 :** Le middleware `RateLimiter.check` incrémente le bucket `tenant:tenant-acme:MUTATION` sans vérifier l'authentification.
* **Étape 4 :** Le quota est épuisé.
* **Résultat :** Tout utilisateur légitime de `tenant-acme` tentant une modification reçoit un code HTTP 429.
* **Bloqué par :** Le rate-limiting par tenant ne doit s'appliquer qu'après validation cryptographique du JWT.

### Chaîne 3 : Contournement d'Approbation de Plan IA
* **Étape 1 :** L'utilisateur demande une modification via l'assistant de conversation.
* **Étape 2 :** Le plan est généré et stocké dans la session en état `PLANNING`.
* **Étape 3 :** Un script client malveillant appelle directement `executeApprovedPlan` sans appeler `confirmPlan`.
* **Étape 4 :** `ExecutionBridge.canExecute` autorise l'état `PLANNING` car le statut n'est ni `REJECTED` ni `FAILED`.
* **Résultat :** Le plan est transmis à l'exécuteur sans consentement explicite de l'utilisateur.
* **Bloqué par :** Exiger formellement `plan.status === 'APPROVED'` dans `executeApprovedPlan`.

### Chaîne 4 : Évaporation de la Piste d'Audit Post-Attaque
* **Étape 1 :** Un attaquant exploitant une clé API effectue des actions non autorisées.
* **Étape 2 :** Les événements sont enregistrés dans `AuditStore` en mémoire vive.
* **Étape 3 :** L'attaquant force un redémarrage (ou attend un arrêt du conteneur).
* **Résultat :** L'intégralité du journal d'audit est effacée sans persistance médico-légale.
* **Bloqué par :** Journalisation persistante sur fichier append-only ou base de données sécurisée.

### Chaîne 5 : Spoofing d'Origine via Loopback Proxy
* **Étape 1 :** L'API est déployée derrière un proxy inverse situé sur la même machine (`127.0.0.1`).
* **Étape 2 :** Le proxy inverse ne nettoie pas les en-têtes `X-Forwarded-For` fournis par le client.
* **Étape 3 :** Le client fournit `X-Forwarded-For: 127.0.0.1`.
* **Étape 4 :** L'API considère que la requête provient de `localhost` et autorise la consultation de `/metrics`.
* **Résultat :** Fuite de métriques système internes protégées.
* **Bloqué par :** Désactiver l'exemption localhost pour les métriques en production (`ALLOW_LOCALHOST_METRICS=false`).

### Chaîne 6 : Injection de Contexte Inter-Tenant dans l'Audit Direct
* **Étape 1 :** Un utilisateur de Tenant A appelle `POST /api/v1/audit`.
* **Étape 2 :** Le corps de la requête contient `{"tenantId": "tenant-B", "projectId": "pB"}`.
* **Étape 3 :** La route extrait `payload.tenantId` en priorité sur `context.tenantId`.
* **Résultat :** L'audit est exécuté et journalisé sous l'identité du Tenant B.
* **Bloqué par :** Forcer l'utilisation stricte de `context.tenantId` issu du JWT.

### Chaîne 7 : Débordement LRU de Clés de Rate Limiting
* **Étape 1 :** L'attaquant envoie des milliers de requêtes avec des `X-Tenant-Id` aléatoires.
* **Étape 2 :** Les buckets s'accumulent dans `RateLimiter.buckets`.
* **Étape 3 :** À 10 000 clés, l'éviction LRU supprime les clés les plus anciennes.
* **Résultat :** La clé de limitation de l'attaquant lui-même est évincée, remettant à zéro son compteur d'IP.
* **Bloqué par :** Les clés IP ne doivent pas être évincées par la saturation de clés locataires non authentifiées.

### Chaîne 8 : Man-in-the-Middle sur Réseau Non Chiffré
* **Étape 1 :** Un utilisateur accède au Studio via HTTP (`http://studio.vibecode.internal:3000`).
* **Étape 2 :** Un écouteur sur le réseau capture les paquets non chiffrés.
* **Étape 3 :** Le jeton Bearer JWT circule en clair dans l'en-tête `Authorization`.
* **Résultat :** Vol de session et usurpation de compte avec privilèges de l'ingénieur.
* **Bloqué par :** Terminaison TLS obligatoire et en-tête HSTS.

### Chaîne 9 : Altération de Code via Injection de Dépendance CDN
* **Étape 1 :** Le Studio charge `cdn.tailwindcss.com` sans hachage Subresource Integrity (SRI).
* **Étape 2 :** Un attaquant compromet le CDN ou réalise un empoisonnement DNS/BGP.
* **Étape 3 :** Un script malveillant est exécuté dans le contexte du Studio parent.
* **Résultat :** Exfiltration des jetons de session stockés dans le DOM ou mémoire locale.
* **Bloqué par :** Autohébergement des ressources CSS/JS ou ajout de condensats SRI (`integrity="sha384-..."`).

### Chaîne 10 : Échappement Iframe Preview via event.source
* **Étape 1 :** Un utilisateur prévisualise une page contenant un script malveillant.
* **Étape 2 :** Le script de la sandbox émet un message `postMessage` vers le parent.
* **Étape 3 :** Le Studio parent valide `event.source === iframe.contentWindow`.
* **Étape 4 :** Le message est filtré : seules les propriétés de logs sont acceptées, toute commande (`command`, `action`, `eval`) est rejetée.
* **Résultat :** Tentative bloquée avec succès par les garde-fous du Studio.
* **Preuve :** Lignes 5508-5522 de `apps/studio/index.html`.

### Chaîne 11 : Injection de Commande Système dans le Terminal
* **Étape 1 :** Un utilisateur soumet la commande `git status; rm -rf /`.
* **Étape 2 :** `validateAndParseCommand` analyse la chaîne.
* **Étape 3 :** Détection de l'opérateur `;` dans `DANGEROUS_PATTERNS`.
* **Résultat :** Rejet immédiat avec `ValidationError`.
* **Preuve :** Vérifié par le test unitaire CORE-005 et le test offensif J2.

### Chaîne 12 : Traversée de Répertoire via Paramètre Path
* **Étape 1 :** Un attaquant tente de lire `GET /api/v1/projects/:id/files/content?path=../../etc/passwd`.
* **Étape 2 :** `sanitizePath` décompose le chemin et détecte les composants `..`.
* **Résultat :** Rejet avec erreur 400 `navigation relative interdite`.
* **Preuve :** Testé avec succès dans le test offensif F1/F3.

### Chaîne 13 : Dépassement de Capacité de Corps HTTP (Body Bombing)
* **Étape 1 :** Un client envoie un payload JSON de 50 Mo avec `Content-Length: 52428800`.
* **Étape 2 :** `readBody` vérifie l'en-tête et compare avec `MAX_BODY_BYTES_DEFAULT` (1 Mo).
* **Résultat :** Destruction immédiate du socket (`req.destroy()`) et réponse HTTP 413.
* **Preuve :** Validé dans le test offensif E1.

### Chaîne 14 : Usurpation de Clé IA par Cost Bombing
* **Étape 1 :** Un utilisateur tente de soumettre une requête avec `max_tokens: 100000`.
* **Étape 2 :** `routes/ai.ts` applique le plafonnement strict `MAX_AI_TOKENS_CAP = 4096`.
* **Résultat :** Le paramètre est ramené à 4096 tokens, empêchant l'épuisement financier.
* **Preuve :** Validé dans le test offensif H3.

### Chaîne 15 : Contournement d'Édition Fichier par un VIEWER
* **Étape 1 :** Un utilisateur doté du rôle `VIEWER` tente `PUT /api/v1/projects/:id/files/content`.
* **Étape 2 :** Le service `EditorService.saveFile` exécute `assertPermission(userRole, 'PROJECT_UPDATE')`.
* **Résultat :** Rejet 403 Forbidden.
* **Preuve :** Validé dans le test offensif B1/B4.
