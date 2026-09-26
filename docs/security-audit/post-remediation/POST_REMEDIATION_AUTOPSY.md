# AUTOPSIE POST-REMÉDIATION INDÉPENDANTE
## VOLACO-CORE — CONFRONTATION DES PROMESSES À LA RÉALITÉ DU CODE

**Périmètre :** Monorepo complet `volaco-core`  
**Méthodologie :** Red Team White-Box Forensic & AST Code Inspection  
**Standard :** Preuve tangible par les lignes de code réelles (No Evidence → No Claim)  

---

### 1. Contexte & Historique de la Remédiation

À la date du 11 Septembre 2026, la plateforme Volaco Core présentait un état de sécurité alarmant :
* **Score initial de l'autopsie :** 48.5/100 (Statut CONDITIONAL NO-GO).
* **16 vulnérabilités** répertoriées allant du secret JWT codé en dur à l'évasion totale de sandbox iframe et à l'exposition de clés IA tierces.

Deux chantiers de correction ont été conduits :
1. **Lot P0-001 :** Axé sur l'authentification fondamentale, les secrets et la frontière navigateur (SEC-001, SEC-002, SEC-003, SEC-007).
2. **Lot P0-002 :** Axé sur l'API, le durcissement du runtime IA et les frontières de sécurité (SEC-004, SEC-009, SEC-010, SEC-011, SEC-012, SEC-013).

Le rapport de fin de P0-002 affichait :
* 1127/1127 tests passés (100%)
* 20/20 tests de sécurité passés (100%)
* Quality Gates 1 et 2 validées (100%)
* Score de sécurité annoncé : **96.2 / 100 — ROBUSTE**

Notre mandat d'audit post-remédiation consiste à **démystifier cette validation administrative** en examinant si les défenses mises en place résistent à une analyse contradictoire sans complaisance.

---

### 2. Ce qui a été réellement et solidement corrigé

L'inspection approfondie du code confirme que les fondations les plus critiques ont été véritablement assainies :

#### A. SEC-001 — Secret JWT obligatoire et inviolable
* **Code avant :** `export const AUTH_SECRET = process.env.AUTH_SECRET || 'volaco-auth-secret-key-2026-secure';`
* **Code actuel (`apps/api/src/middleware/auth.ts:18-35`) :**
  ```typescript
  export function validateAuthSecret(): void {
    const secret = process.env.AUTH_SECRET;
    if (!secret || typeof secret !== 'string' || secret.trim().length < 32) {
      throw new AppError(
        'FATAL: Variable d environnement AUTH_SECRET obligatoire (minimum 32 caractères cryptographiques robustes). Le serveur refuse de démarrer.',
        'INTERNAL_ERROR',
        500
      );
    }
  }
  ```
* **Vérification d'exécution :** `validateAuthSecret()` est appelé dès la première instruction de `createApiServer()`. Le serveur refuse catégoriquement de s'initialiser sans un secret d'au moins 32 caractères.

#### B. SEC-003 — Rapatriement de la clé Mistral côté serveur
* **Code avant :** Clé d'API valide injectée dans le champ HTML et lue depuis `localStorage` (`apps/studio/index.html:3092`).
* **Code actuel :** Aucune clé d'API Mistral n'est présente dans les fichiers distribués aux clients ou dans le bundle Studio. L'ensemble des appels IA transite par `/api/v1/ai/chat/completions`, qui lit `process.env.MISTRAL_API_KEY` côté backend et n'expose jamais la valeur aux navigateurs.

#### C. SEC-007 — Étanchéité de l'Iframe Preview
* **Code avant :** `sandbox="allow-scripts allow-modals allow-forms allow-same-origin allow-popups allow-downloads"`
* **Code actuel (`apps/studio/index.html:1402`) :**
  ```html
  sandbox="allow-scripts allow-modals allow-forms allow-popups allow-downloads"
  ```
  `allow-same-origin` a été retiré. En conséquence, le navigateur attribue à l'iframe une origine opaque (`null`). L'iframe ne peut plus accéder à `window.parent.document`, ni au stockage local du Studio.

#### D. SEC-004 — Révocation du Wildcard CORS
* **Code avant :** `res.setHeader('Access-Control-Allow-Origin', '*');`
* **Code actuel (`apps/api/src/server.ts:47-78`) :** Le wildcard `*` a été supprimé. En cas d'origine inconnue, aucun en-tête `Access-Control-Allow-Origin` n'est émis, et toute pré-requête `OPTIONS` suspecte est immédiatement bloquée avec un code HTTP 403 Forbidden.

---

### 3. Les failles et angles morts révélés par l'audit

L'erreur majeure du rapport P0-002 a été de confondre la conformité aux exigences prioritaires avec une sécurisation intégrale du système.

#### A. Le Mirage du Rate Limiting (SEC-013) : Confiance Aveugle en `X-Forwarded-For`
Le middleware `RateLimiter` (`apps/api/src/middleware/rate-limiter.ts:95-104`) extrait l'IP du client de la manière suivante :
```typescript
private getClientIp(req: IncomingMessage): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim().length > 0) {
    const firstIp = xff.split(',')[0]?.trim();
    if (firstIp && /^[0-9a-fA-F:.]+$/.test(firstIp)) {
      return firstIp;
    }
  }
  return req.socket.remoteAddress || '127.0.0.1';
}
```
**Preuve de bypass :**
Si le serveur Node.js est accessible directement ou si le reverse proxy amont n'écrase pas systématiquement l'en-tête `X-Forwarded-For`, un attaquant peut émettre 10 000 requêtes en générant une fausse IP différente à chaque appel (`X-Forwarded-For: 198.51.100.${i}`). Le limiteur traite chaque requête comme émanant d'un client distinct et ne déclenche jamais le quota HTTP 429.

**Vulnérabilité de déni de service mémoire (Heap DoS) :**
La structure de stockage `this.buckets = new Map<string, WindowBucket>();` n'applique aucun mécanisme d'éviction LRU, ni timer de nettoyage périodique. Une attaque par génération d'adresses IP forgées provoque une croissance linéaire et illimitée de la Map en RAM, conduisant à un crash V8 par `JavaScript heap out of memory`.

#### B. La Session Publique Default-Tenant (`POST /api/v1/auth/session`)
Dans `apps/api/src/server.ts:173-185`, pour faciliter le fonctionnement du Studio en mode autonome, le serveur expose une route publique sans mot de passe :
```typescript
if (req.method === 'POST' && (pathname === `${config.apiPrefix}/auth/session` || pathname === `${config.apiPrefix}/auth/token`)) {
  const sessionToken = generateAuthToken({ tenantId: 'default-tenant', role: 'ENGINEER' });
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = 200;
  res.end(JSON.stringify({ success: true, token: sessionToken, tenantId: 'default-tenant', role: 'ENGINEER', requestId }));
  return;
}
```
Cette commodité de développement signifie que **n'importe quel visiteur anonyme** sur le réseau peut instantanément obtenir un jeton JWT valide doté du rôle `ENGINEER` sur le locataire `default-tenant`. Si un projet d'entreprise y est créé, il est totalement exposé en lecture, modification et exécution de mutations à tout acteur externe.

#### C. Les 5 Vulnérabilités Oubliées / Non Traitées
Alors que le score de 96.2 sous-entendait la résolution de la quasi-totalité des risques, 5 findings majeurs n'avaient en réalité fait l'objet d'aucune modification de code :
1. **SEC-005 :** Distribution de fichiers statiques vérifiant `!includes('..')` sans `path.resolve` étanche.
2. **SEC-006 :** Aucun WAL ni persistance sur disque pour les données critiques et l'historique de versions.
3. **SEC-014 :** Journal d'audit en mémoire vive, non signé et sans scellement cryptographique.
4. **SEC-015 :** Métriques d'infrastructure `/metrics` accessibles publiquement sans aucun token.
5. **SEC-016 :** Création de révisions acceptant `payload.author` fourni par le client sans liaison avec l'identité du token.

---

### 4. Bilan Méthodologique : Pourquoi les Tests Précédents Étaient Verts

Les tests de régression (`apps/api/tests/security/*.test.ts`) étaient 100% verts car ils testaient fidèlement **les scénarios nominaux prévus par les développeurs des correctifs** :
* Le test de rate limit testait le blocage avec une même IP fixe. Il ne testait pas la falsification de `X-Forwarded-For`.
* Le test de secret testait le masquage des URIs. Il ne testait pas la persistance du store.
* Le test de l'agent runtime vérifiait que `VIEWER` était rejeté. Il ne vérifiait pas que `allowBreaking` restait à `true` par défaut pour l'ingénieur.

C'est précisément l'utilité d'un audit indépendant : **tester ce que les tests unitaires omettent de tester**.
