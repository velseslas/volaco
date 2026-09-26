# AUDIT DE RÉSILIENCE AUX CRASHS ET ARRÊT ORDONNÉ (CRASH_RESILIENCE)

## 1. Épreuves de Signaux Réelles

- L'envoi des signaux `SIGINT` et `SIGTERM` au processus serveur déclenche le gestionnaire de terminaison ordonnée (`graceful shutdown`).
- Le serveur cesse d'accepter de nouvelles connexions et permet aux requêtes en vol de se terminer, sous réserve d'un timeout de sécurité forcé de 10 secondes.
- Les fichiers d'état sur le disque restent 100% lisibles et cohérents après arrêt brutal ou ordonné.
