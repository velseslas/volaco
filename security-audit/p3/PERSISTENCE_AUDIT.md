# AUDIT DE PERSISTANCE ET D'INTÉGRITÉ (SEC-006 RÉALITÉ) — MISSION P3
**Composants :** Tous les stores du monorepo

---

## 1. Analyse de la Volatilité
* Aucun SGBD relationnel (PostgreSQL, MySQL, SQLite) ni magasin clé-valeur persistant (Redis) n'est raccordé.
* Toutes les structures sont maintenues dans le heap du processus Node.js.

## 2. Impact sur l'Exploitation en Production
1. **Zéro tolérance au redémarrage :** Tout crash ou mise à jour de déploiement efface l'intégralité des projets utilisateurs et de leur historique de versions.
2. **Perte de traçabilité médico-légale :** L'audit trail (`AuditStore`) est effacé à chaque redémarrage, violant les exigences de conformité SOC 2 / ISO 27001.
3. **Incompatibilité avec le Clustering / Scaling Horizontal :**
   Dans une architecture distribuée multi-instances (Load Balancer devant Instance 1 et Instance 2), les états divergent instantanément :
   - Requête 1 (Instance 1) : Création du projet.
   - Requête 2 (Instance 2) : 404 Projet introuvable.
