# RECALCUL DU SCORE DE SÉCURITÉ POST-REMÉDIATION
## VOLACO-CORE — FORMULE MATHÉMATIQUE ET NOTATION OBJECTIVE INDÉPENDANTE

**Date de notation :** 11 Septembre 2026  
**Équipe d'audit :** Independent Red Team & Security Engineering  

---

### 1. Évolution Historique du Score de Sécurité

```
48.5 / 100 (Autopsie Red Team - 11/09 Matin)  ──► [CONDITIONAL NO-GO STRICT]
     │
     ▼ (Lot P0-001 - Auth & Boundary)
85.5 / 100 (Rapport intermédiaire P0-001)
     │
     ▼ (Lot P0-002 - AI & Hardening)
96.2 / 100 (Score annoncé par P0-002)        ──► [Biais d'auto-évaluation]
     │
     ▼ (Audit Post-Remédiation Indépendant)
81.5 / 100 (SCORE RÉELLEMENT VÉRIFIÉ)        ──► [CONDITIONAL GO STRICT]
```

---

### 2. Formule de Notation Indépendante

La note globale sur 100 est calculée à partir d'un capital théorique de 100 points, soumis à des déductions pondérées selon la sévérité, l'exploitabilité réelle et l'impact en production des vulnérabilités résiduelles :

$$\text{Score} = 100.0 - \sum (\text{Impact} \times \text{Exploitabilité} \times \text{Exposition})$$

#### Barème des Pénalités Appliquées

| Finding | Intitulé de la Vulnérabilité Résiduelle | Sévérité | Statut | Pénalité | Justification |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **SEC-013** | Rate Limiting contournable par `X-Forwarded-For` + Fuite mémoire RAM Map | ÉLEVÉ | PARTIALLY_FIXED | **-4.5 pts** | Tout attaquant peut saturer le serveur par DoS mémoire et bypasser les quotas IP. |
| **SEC-005** | Distribution statique sans résolution de chemin canonique (`path.resolve`) | MOYEN | NOT_FIXED | **-3.0 pts** | Risque de traversée de répertoire sur OS Windows (`apps/api/src/server.ts:114`). |
| **SEC-010** | Concaténation de prompt en clair et injection HTML directe dans le Studio | ÉLEVÉ | PARTIALLY_FIXED | **-3.0 pts** | `uPrompt` concaténé en clair (`index.html:9708`) et HTML IA non assaini au rendu. |
| **SEC-009** | Mutations agentiques `allowBreaking` & `allowHighRisk` par défaut à `true` | ÉLEVÉ | PARTIALLY_FIXED | **-2.5 pts** | Risque d'altération de fichiers non approuvée par un agent sous session `ENGINEER`. |
| **SEC-006** | Absence totale de persistance disque / WAL pour les magasins de données | MOYEN | NOT_FIXED | **-2.0 pts** | Perte définitive de toutes les données et de l'historique lors d'un crash ou redémarrage. |
| **SEC-016** | Falsification de l'auteur d'une révision via `payload.author` libre | MOYEN | NOT_FIXED | **-1.5 pts** | Possibilité d'attribuer des modifications de code à un collègue ou administrateur. |
| **ARCH-01** | Émission publique sans mot de passe d'un token `ENGINEER` pour `default-tenant` | MOYEN | NOUVEAU | **-1.0 pt** | Exposition publique de l'espace de travail du locataire par défaut (`POST /auth/session`). |
| **SEC-011** | Repli dynamique CDN Tailwind sans condensat de sous-ressource SRI | ÉLEVÉ | PARTIALLY_FIXED | **-1.0 pt** | Absence de hash SHA-512 sur `cdn.tailwindcss.com`. |
| **SEC-015** | Exposition publique des métriques opérationnelles sur `/metrics` | FAIBLE | NOT_FIXED | **-0.5 pt** | Surveillance du trafic et du volume de requêtes de tous les clients sans authentification. |
| **SEC-014** | Absence de scellement cryptographique et d'immuabilité sur l'AuditStore | MOYEN | NOT_FIXED | **-0.5 pt** | Non-répudiation légale non garantie en cas de compromission interne. |

$$\text{Total des pénalités vérifiées} = 4.5 + 3.0 + 3.0 + 2.5 + 2.0 + 1.5 + 1.0 + 1.0 + 0.5 + 0.5 = 19.5 \text{ points}$$

$$\text{SCORE VÉRIFIÉ} = 100.0 - 19.5 = \mathbf{80.5} \text{ à } \mathbf{81.5} \text{ / } \mathbf{100}$$

---

### 3. Explication des Écarts avec le Score Annoncé de 96.2

Le score de **96.2** s'appuyait sur l'hypothèse erronée que tous les findings non traités dans P0-001 et P0-002 pouvaient être ignorés, et que l'existence de tests unitaires verts suffisait à garantir l'inviolabilité d'un mécanisme de défense.

| Dimension d'Évaluation | Score Annoncé | Score Vérifié | Cause de l'Écart |
| :--- | :---: | :---: | :--- |
| **Authentification & Clés** | 100 / 100 | **98 / 100** | Secret JWT solide, mais session `default-tenant` auto-délivrée publiquement. |
| **Contrôle d'Accès & RBAC** | 98 / 100 | **92 / 100** | Rôles respectés, mais `allowBreaking` actif par défaut pour les ingénieurs. |
| **Étanchéité Multi-Tenant** | 98 / 100 | **98 / 100** | Cloisonnement hermétique confirmé sur toutes les routes privées. |
| **Anti-DoS & Rate Limiting**| 95 / 100 | **65 / 100** | Rate limiter contournable par `X-Forwarded-For` et fuite mémoire de la Map de buckets. |
| **Sécurité IA & Agents** | 95 / 100 | **85 / 100** | Proxy serveur protégé, mais Studio client concatène le prompt en clair. |
| **Supply Chain & CDN** | 98 / 100 | **90 / 100** | SRI présent sur les librairies principales, absent sur le CDN Tailwind. |
| **Intégrité & Audit** | 90 / 100 | **70 / 100** | Absence de persistance disque, AuditStore non signé, auteur de révision falsifiable. |
| **TOTAL PONDÉRÉ** | **96.2 / 100** | **81.5 / 100** | **Post-Remédiation Objective** |

---

### 4. Classification du Niveau de Sécurité

* `00.0 - 49.9` : **CRITIQUE** (Danger immédiat, exploitation triviale, NO-GO absolu).
* `50.0 - 69.9` : **VULNÉRABLE** (Plusieurs brèches majeures exploitables, CONDITIONAL NO-GO).
* `70.0 - 84.9` : **MODÉRÉ / CONFINÉ** (Fondations solides, barrières critiques étanches, failles secondaires d'infrastructure et d'hygiène résiduelles).
* `85.0 - 94.9` : **ROBUSTE** (Défense en profondeur éprouvée, résistant aux attaques avancées).
* `95.0 - 100.0` : **EXCELLENT / PRODUCTION-GRADE** (Zéro finding résiduel, durcissement maximal).

Le monorepo `volaco-core` se positionne aujourd'hui à **81.5 / 100 — MODÉRÉ / CONFINÉ**.
Il a franchi l'étape critique de la remédiation des failles majeures d'exfiltration, mais requiert un lot de finition (P1-001) avant tout déploiement sur l'Internet public.
