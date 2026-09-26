# FEUILLE DE ROUTE D'ÉVOLUTION POST-PRODUCTION (REMEDIATION_PRIORITY)

Bien qu'aucun élément bloquant ne s'oppose au déploiement immédiat en production, les évolutions suivantes sont préconisées pour les versions futures (`v1.1+`) :

| Priorité | Axe d'Amélioration | Effort | Bénéfice |
|---|---|:---:|---|
| **P1** | Adaptateur Redis pour le Rate Limiter en environnement distribué | Faible | Permet le scaling horizontal dynamique sans dérive des quotas. |
| **P2** | Support d'un backend PostgreSQL pour le stockage persistant | Moyen | Facilite les sauvegardes incrémentielles et la réplication multi-AZ. |
| **P3** | Intégration d'un module HSM/KMS pour la rotation automatique de `AUTH_SECRET` | Faible | Conformité bancaire et enterprise-grade (SOC 2, ISO 27001). |
| **P4** | Télémétrie OpenTelemetry exportable (OTLP gRPC) pour Datadog/Grafana | Faible | Visibilité temps réel sur les latences et les rejets de sécurité. |
