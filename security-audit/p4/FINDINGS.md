# REGISTRE DÉTAILLÉ DES CONSTATATIONS D'AUDIT P4 (FINDINGS)

## Synthèse par Niveau de Sévérité

| Sévérité | Nombre | Statut |
|---|:---:|:---:|
| **CRITICAL** | 0 | Aucun problème identifié |
| **HIGH** | 0 | Aucun problème identifié |
| **MEDIUM** | 0 | Tous les écarts P3 sont résolus |
| **LOW** | 2 | Notations architecturales |
| **INFO** | 1 | Bonnes pratiques documentaires |

---

## Constatations Résiduelles (Non Bloquantes pour la Production)

### FINDING P4-LOW-01 : Limitation d'Échelle du Limiteur de Débit en Mémoire
- **Description :** L'implémentation actuelle du limiteur de débit (`MemoryRateLimitStore`) utilise une structure en mémoire vive locale au processus Node.js.
- **Impact :** En cas de déploiement multi-instances derrière un load-balancer round-robin (cluster horizontal sans affinité de session IP), le quota d'un client serait multiplié par le nombre d'instances actives.
- **Atténuation Actuelle :** Conçu pour un nœud maître ou avec routage à affinité de session IP (`ip_hash` sur Nginx).
- **Recommandation Post-Production :** Ajouter un adaptateur optionnel Redis (`RedisRateLimitStore`) pour les déploiements de type cluster élastique Kubernetes.

### FINDING P4-LOW-02 : Persistance Fichier Durable Monosite
- **Description :** Le stockage durable s'appuie sur le système de fichiers local (`DATA_DIR`) avec renommage atomique.
- **Impact :** Adapté pour une instance unique (VPS, conteneur avec volume persistant attaché), mais non adapté à un cluster multi-zones sans volume partagé compatible POSIX locks.
- **Recommandation Post-Production :** Prévoir un connecteur S3/R2 ou base de données relationnelle (PostgreSQL) pour une mise à l'échelle multi-régionale future.

### FINDING P4-INFO-01 : Épinglage des Hashes SRI Externes
- **Description :** Les dépendances CDN du Studio Web intègrent des condensats SHA-512 conformes aux exigences modernes de Subresource Integrity.
- **Recommandation :** Automatiser la vérification de ces condensats lors de chaque mise à jour de dépendance front-end dans la CI/CD.
