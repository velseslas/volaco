# Mise en service sur ton VPS — guide pas à pas

Ce guide suppose : **VPS Linux (Ubuntu ou Debian), accès racine, 6 vCPU / 12 Go** — la configuration que tu as montrée. Prévoir **30 à 45 minutes** la première fois (dont 10-15 minutes de construction automatique).

---

## Ce que tu vas obtenir

```
    Internet ──► Cloudflare (plus tard) ──► Nginx (accueil, port 80)
                                              │
                                              ▼
                                    Serveur d'API (conteneur Docker)
                                    n'écoute que sur 127.0.0.1:3000
                                              │
                        ┌─────────────────────┴─────────────────────┐
                        ▼                                           ▼
              /app/.volaco-data                            /app/workspace
        (projets, comptes, audit, usage IA)        (builds des applications générées)
                    volume disque                              volume disque
```

Tout est **conteneurisé** : ton VPS reste propre, et la mise à jour se fait par une seule commande.

---

## Étape 1 — Préparer le paquet sur ton PC (Windows)

```powershell
cd C:\Users\FAYCAL\Desktop\volcanoo\volaco-core
node scripts\prepare-release.mjs
```

Cela crée un dossier propre **à côté** de ton projet : `C:\Users\FAYCAL\Desktop\volcanoo\volaco-release`, avec `dist/` **copié tel quel** (règle du projet : on ne reconstruit jamais `dist/` sur le serveur).

⚠️ **Deux nettoyages obligatoires avant d'envoyer** — ces dossiers ne sont pas exclus automatiquement et contiennent d'anciennes copies de ton code (donc potentiellement d'anciennes clés) :

```powershell
cd C:\Users\FAYCAL\Desktop\volcanoo\volaco-release
Remove-Item -Recurse -Force _backup-avant-fix-v2-*, _live-line-backup, .memory-backup, bench, *.log, *.zip, patch, volaco-fix-*, volaco-core-ok, restauration-archive8 -ErrorAction SilentlyContinue
```

Puis crée un fichier `.dockerignore` à la racine de ce dossier (il évite d'envoyer l'inutile dans l'image) :

```powershell
@"
node_modules
.git
bench
*.log
*.zip
_backup-*
patch
deploy/data
"@ | Set-Content -Path .dockerignore -Encoding UTF8
```

---

## Étape 2 — Se connecter au serveur

Depuis PowerShell :

```powershell
ssh root@ADRESSE_IP_DU_VPS
```

*(Le mot de passe est celui envoyé par l'hébergeur. Pour un usage durable, ajoute ta clé SSH — à faire plus tard, ce n'est pas bloquant.)*

---

## Étape 3 — Installer Docker et fermer le pare-feu

```bash
apt update && apt install -y curl
curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
sh /tmp/get-docker.sh
docker --version
```

Pare-feu (laisse SSH ouvert **avant** d'activer, sinon tu te coupes l'accès) :

```bash
apt install -y ufw
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable
ufw status
```

> Le port **3000 ne doit jamais être ouvert publiquement** : le serveur d'API n'est joignable que par Nginx, sur la boucle locale du serveur.

---

## Étape 4 — Installer l'accueil public (Nginx)

```bash
apt install -y nginx
systemctl enable --now nginx
```

---

## Étape 5 — Envoyer les fichiers

Depuis **PowerShell sur ton PC** (nouvelle fenêtre, pas celle du SSH) :

```powershell
scp -r C:\Users\FAYCAL\Desktop\volcanoo\volaco-release root@ADRESSE_IP_DU_VPS:/opt/
```

*(Alternative sans ligne de commande : WinSCP ou FileZilla, glisser-déposer le dossier dans `/opt/`.)*

Vérification côté serveur : `ls /opt/volaco-release` doit montrer `apps  deploy  dist  packages  server  package.json …`

---

## Étape 6 — Créer le fichier de réglages

Sur le serveur :

```bash
cd /opt/volaco-release
nano deploy/.env
```

Recopie ces **noms de réglages**, un par ligne, suivis de `=` puis de la valeur :

| Nom du réglage | Valeur à mettre |
|---|---|
| `NODE_ENV` | `production` |
| `VOLACO_STRICT_AUTH` | `1` |
| `VOLACO_BIND_HOST` | `0.0.0.0` |
| `PORT` | `3000` |
| `VOLACO_DATA_DIR` | `/app/.volaco-data` |
| `AUTH_SECRET` | le résultat de : `openssl rand -hex 32` |
| `VOLACO_API_KEY` | le résultat de : `openssl rand -hex 32` (ta clé d'accès aux outils) |
| `MISTRAL_API_KEY` | ta **nouvelle** clé Mistral (à régénérer avant, voir étape 11) |
| `MISTRAL_MODEL` | `codestral-latest` |
| `VOLACO_MAX_CONCURRENT_AI` | `3` |
| `CORS_ALLOWED_ORIGINS` | *(laisser vide)* |

> ⚠️ `NODE_ENV=production` **et** `VOLACO_STRICT_AUTH=1` sont les deux lignes qui **ferment la porte** : sans jeton, plus rien ne passe (sauf la page Studio et la santé). Ne fais pas cette installation sans elles.

Enregistre (`Ctrl+O`, `Entrée`, `Ctrl+X`) puis protège le fichier :

```bash
chmod 600 deploy/.env
```

---

## Étape 7 — Lancer le serveur

```bash
cd /opt/volaco-release
docker compose -f deploy/docker-compose.yml up -d --build
```

*(La première construction télécharge l'image de base avec le navigateur : quelques minutes. Les suivantes sont quasi instantanées.)*

Vérifications :

```bash
docker compose -f deploy/docker-compose.yml ps          # doit afficher "healthy"
curl -s http://127.0.0.1:3000/health                     # doit répondre {"status":"ok",...}
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/v1/projects
```

La **troisième** commande doit répondre **401** : c'est la preuve que la porte est fermée. Avec la clé, ça marche :

```bash
curl -s -H "Authorization: Bearer TA_CLE_API" http://127.0.0.1:3000/api/v1/projects
```

---

## Étape 8 — Brancher l'accueil public

```bash
cp /opt/volaco-release/deploy/nginx.conf /etc/nginx/sites-available/volaco
ln -sf /etc/nginx/sites-available/volaco /etc/nginx/sites-enabled/volaco
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

Depuis ton PC : `curl http://ADRESSE_IP_DU_VPS/health` → doit répondre pareil. La page Studio est alors accessible à l'adresse `http://ADRESSE_IP_DU_VPS/`.

---

## Étape 9 — Mesurer la solidité (le vrai but)

**9a. Ouvrir temporairement le port direct** (pour que la mesure porte sur l'API, sans l'accueil) :

```bash
nano /opt/volaco-release/deploy/docker-compose.yml
```
Remplace `- "127.0.0.1:3000:3000"` par `- "3000:3000"`, puis :
```bash
cd /opt/volaco-release && docker compose -f deploy/docker-compose.yml up -d
```

**9b. Lancer le banc depuis ton PC** (l'option `--allow-remote` autorise explicitement une cible distante — à n'utiliser que sur ton propre serveur) :

```powershell
cd C:\Users\FAYCAL\Desktop\volcanoo\volaco-core
$env:VOLACO_API_KEY = "TA_CLE_API"
node scripts\bench-backend.mjs --base http://ADRESSE_IP_DU_VPS:3000 --allow-remote
```

**9c. Compare** avec les mesures locales (dans `bench/`) :

| Scénario | Ton PC (mesuré) | VPS (à remplir) |
|---|---|---|
| `GET /health` | ~1 200-1 700 req/s | … |
| Lecture projets | ~900-1 200 req/s | … |
| Fichier statique | ~550 req/s | … |
| Écriture | ~100/s | … |
| Connexion | ~35/s | … |

⚠️ **N'attends pas forcément mieux** : les cœurs d'un serveur mutualisé sont souvent **plus lents** que ceux d'un PC récent. Ce test sert à connaître la capacité **réelle de ta plateforme en ligne** et l'effet du réseau — pas à voir une amélioration. Celle-ci viendra de l'étape « base de données ».

**9d. Refermer** : remets `- "127.0.0.1:3000:3000"` et relance la commande.

---

## Étape 10 — Ajouter Cloudflare (et re-mesurer)

1. Créer un compte gratuit, ajouter ton domaine, et suivre les deux adresses de serveurs de noms à déclarer chez ton registrar (là où tu as acheté le domaine).
2. Dans **DNS** : une entrée `A` vers l'adresse IP du VPS, avec le **nuage orange activé** (trafic filtré et accéléré par Cloudflare).
3. Dans **SSL/TLS** : mode **Full**. Pour faire mieux (Full strict), génère un **Origin Certificate** gratuit dans Cloudflare et installe-le sur Nginx (2 lignes à ajouter).
4. Dans **Caching** : laisse le cache par défaut **et** crée une règle « Bypass cache » pour `/api/*` (une génération ne doit **jamais** être mise en cache).
5. Rejoue le test de l'étape 9 depuis ton PC, cette fois **vers ton domaine** (sans `--allow-remote`, puisque c'est un nom public) : tu verras l'effet réel de Cloudflare (les fichiers statiques ne toucheront plus ton serveur).

---

## Étape 11 — Avant d'ouvrir à qui que ce soit

À faire **dans cet ordre** :

1. **Régénérer la clé Mistral** (elle a fuité dans l'historique git) et mettre la nouvelle dans `deploy/.env`.
2. **Appliquer `deploy/PATCH-IP-REELLE.md`** — sinon tous tes visiteurs partagent un seul quota de 600 requêtes/minute et se bloquent entre eux.
3. Les trois correctifs de sécurité de l'audit : authentification stricte (déjà faite ici par les deux lignes du `.env`), clé IA hors du navigateur, sortie du contenu généré de l'origine du Studio.
4. **Sauvegardes** : les données vivent dans `/opt/volaco-release/deploy/data` — copie-les la nuit :

```bash
mkdir -p /opt/backups
crontab -e
# ajoute cette ligne :
0 4 * * * tar czf /opt/backups/volaco-$(date +\%F).tar.gz -C /opt/volaco-release deploy/data && find /opt/backups -name 'volaco-*.tar.gz' -mtime +14 -delete
```

---

## Dépannage express

| Symptôme | Cause probable | Solution |
|---|---|---|
| `ps` affiche `Exited` | erreur au démarrage | `docker compose -f deploy/docker-compose.yml logs api --tail 50` |
| `502 Bad Gateway` | conteneur arrêté, ou mauvais port | vérifier `ps` puis `curl http://127.0.0.1:3000/health` |
| `401` sur toutes les pages API | mode strict sans jeton | utiliser l'en-tête `Authorization: Bearer …` — c'est le comportement voulu |
| `429` en rafale dès qu'il y a 2 visiteurs | quota partagé derrière l'accueil | appliquer `PATCH-IP-REELLE.md` |
| Génération IA en échec | clé Mistral absente/invalide | vérifier `deploy/.env` puis `docker compose … up -d` |
| Aperçu ou auto-réparation en échec | navigateur absent ou planté | l'image le contient déjà ; sinon consulter les journaux |
| Le Studio affiche une vieille version | cache du navigateur | `Ctrl+F5` |
| Build d'application en échec | `dist/` manquant sur le serveur | vérifier que `dist/` a bien été envoyé |
| Disque qui se remplit | images et bundles générés | `df -h` ; les données sont dans `deploy/data` |

---

## Ce que cette installation ne fait PAS encore (à savoir)

- **Pas de base de données externe** : la persistance reste un fichier unique dans `deploy/data`. Ajouter Postgres/Redis ne servirait à rien aujourd'hui — **le code ne les utilise pas** (c'est le chantier « étape 1 » du plan d'architecture).
- **Un seul exemplaire du serveur** : deux processus écrivant dans le même fichier de données se marcheraient dessus. Le passage à plusieurs serveurs vient **après** la base de données.
- **Aucun quota ni facturation**, **aucune isolation** des applications générées (elles tournent encore dans le navigateur du visiteur, sur l'origine du Studio), **pas de CI**.

Ces points sont détaillés dans `ARCHITECTURE-QUI-ENCAISSE-20261013.md`.
