# ÉVALUATION DU COMPORTEMENT MULTI-INSTANCES (MULTI_INSTANCE_REALITY)

## 1. Test Réel sur Processus Node.js Distincts

Un test a été exécuté en démarrant simultanément deux processus Node.js indépendants (`PID 1` sur le port 52111 et `PID 2` sur le port 52112) :
- **Partage des Données :** Les données écrites par l'instance 1 sur le disque partagé sont relues avec succès par l'instance 2.
- **Comportement du Limiteur de Débit :**
  - L'instance 1 a reçu 5 requêtes et a bloqué la 6ème avec `HTTP 429`.
  - La même requête émise immédiatement vers l'instance 2 pour le même locataire a retourné **HTTP 200 OK**.
- **Conclusion Réelle :** Les quotas de rate limiting sont isolés en mémoire vive par processus. En environnement multi-instances sans affinité de session IP (`sticky sessions`), les quotas réels sont multipliés par le nombre d'instances en service.
- **Statut :** **NOT VERIFIED POUR LE CLUSTERING SANS STICKY SESSIONS** (Nécessite un adaptateur Redis).
