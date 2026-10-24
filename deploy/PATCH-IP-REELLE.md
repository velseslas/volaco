# PATCH — lire la vraie adresse du visiteur (à appliquer AVANT d'ouvrir le service)

## Pourquoi c'est indispensable

Le serveur limite le débit **par adresse IP** (600 requêtes/minute) :

- `apps/api/src/server.ts` → `checkRateLimit()` utilise `req.socket.remoteAddress`
- `apps/api/src/routes/auth.ts` → `loginFailureKey()` utilise la même valeur

Derrière Nginx (et derrière Cloudflare), **toutes les requêtes arrivent de l'accueil** :
le serveur voit donc une seule adresse (127.0.0.1). Sans correction, **tous tes
visiteurs partagent un unique quota de 600 requêtes par minute** : dès qu'il y a
plusieurs personnes, tout le monde est bloqué en 429, et l'anti-force-brute
compte toutes les tentatives de tous les visiteurs dans le même seau.

> Effet mesurable : en local, ce plafond vaut 10 requêtes/seconde **par personne**.
> Derrière l'accueil sans correction, il vaut 10 requêtes/seconde **pour tout le monde**.

C'est le seul correctif de cette mise en service qui touche le code. Il prend
une vingtaine de minutes à un développeur.

---

## 1. Nouveau fichier à créer

`apps/api/src/middleware/client-ip.ts`

```ts
import type { IncomingMessage } from 'node:http';

/**
 * Adresses des intermédiaires de confiance (accueil local, réseau Docker).
 * En-tête de transfert accepté UNIQUEMENT si la requête vient de l'un d'eux :
 * sinon n'importe quel visiteur pourrait falsifier son adresse et contourner
 * la limitation de débit.
 */
function isTrustedProxy(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = addr.replace(/^::ffff:/, ''); // IPv4 encapsulée
  if (a === '127.0.0.1' || a === '::1') return true;
  if (a.startsWith('10.')) return true;
  if (a.startsWith('192.168.')) return true;
  const m = /^172\.(\d{1,3})\./.exec(a);
  if (m) {
    const second = Number(m[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

/** Adresse réelle du visiteur : en-tête de transfert si (et seulement si) la
 *  requête vient d'un intermédiaire de confiance, sinon l'adresse de connexion. */
export function clientIp(req: IncomingMessage): string {
  const peer = req.socket.remoteAddress;
  if (isTrustedProxy(peer)) {
    const forwarded = req.headers['x-forwarded-for'];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (typeof first === 'string' && first.trim().length > 0) {
      return first.split(',')[0]!.trim();
    }
    const real = req.headers['x-real-ip'];
    if (typeof real === 'string' && real.trim().length > 0) return real.trim();
  }
  return peer || 'unknown';
}
```

## 2. Deux remplacements

**a) `apps/api/src/server.ts`** — dans `checkRateLimit()` :

```diff
-  const ip = req.socket.remoteAddress || 'unknown';
+  const ip = clientIp(req);
```

et l'import en tête de fichier :

```diff
+import { clientIp } from './middleware/client-ip.js';
```

**b) `apps/api/src/routes/auth.ts`** — dans `loginFailureKey()` :

```diff
-  const ip = req.socket.remoteAddress || 'unknown';
+  const ip = clientIp(req);
```

avec l'import :

```diff
+import { clientIp } from '../middleware/client-ip.js';
```

## 3. Mise en service du correctif

1. Sur ton poste : appliquer les changements ci-dessus.
2. `npm run typecheck` (doit passer) puis `npm run build` — compilation TypeScript
   classique, qui met à jour `dist/`. *(Ne pas supprimer `dist/` : la politique du
   projet interdit la reconstruction complète, pas la recompilation.)*
3. Recopier le dossier `dist/` sur le serveur (ou refaire `prepare-release.mjs`).
4. Sur le serveur : `docker compose -f deploy/docker-compose.yml up -d --build`

## 4. Vérification (simple, en usage réel)

- **Avant** le correctif : deux appareils (ton PC + un téléphone en 4G) qui
  travaillent en même temps épuisent 600 requêtes communes en une minute et se
  bloquent mutuellement (erreurs `429 RATE_LIMITED`).
- **Après** le correctif : chaque appareil dispose de son propre quota de 600/min ;
  plus de blocage mutuel. L'anti-force-brute comptabilise aussi les tentatives
  par couple adresse + email, et non plus de façon globale.

## 5. Défense en profondeur (déjà en place, ne la retire pas)

`deploy/nginx.conf` applique en plus une limitation au niveau de l'accueil
(`limit_req_zone … rate=15r/s`). Elle protège l'accueil lui-même, **mais ne
remplace pas** ce correctif : c'est le serveur d'API qui compte par IP pour
l'anti-force-brute et pour la protection du budget IA.
