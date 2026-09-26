# REGISTRE CONSOLIDÉ DES VULNÉRABILITÉS & STATUT POST-P1-001
## VOLACO-CORE — REVUE EXHAUSTIVE DES 16 FINDINGS + ARCH-01

| Réf | Vulnérabilité | Sévérité Initiale | Statut Avant P1-001 | Statut Post-P1-001 | Preuve & Test Automatisé |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **SEC-001** | Clé secrète JWT par défaut codée en dur | CRITIQUE | FIXED | **FIXED** | `validateAuthSecret` bloque tout démarrage si secret < 32 chars. Test Vector 2. |
| **SEC-002** | Bypass authentification par en-têtes HTTP | CRITIQUE | FIXED | **FIXED** | Requiert Bearer token signé valide sur toutes les routes API. Test Vector 1 & 4. |
| **SEC-003** | Clé Mistral exposée dans HTML / localStorage | CRITIQUE | FIXED | **FIXED** | Proxy serveur exclusif, clé jamais transmise au client. Test Vector 9 & 20. |
| **SEC-004** | CORS permissif avec wildcard `*` | ÉLEVÉ | FIXED | **FIXED** | Whitelist stricte d'origines, rejet 403 sur preflight inconnu. Test Vector 18. |
| **SEC-005** | Path traversal sur distribution statique | MOYEN | NOT_FIXED | **FIXED** | Résolution canonique `path.resolve`, préfixe `studioRoot` obligatoire. Test Vector 23. |
| **SEC-006** | Volatilité des magasins en mémoire | MOYEN | NOT_FIXED | **TRADE_OFF** | Choix architectural documenté. Stores bornés en mémoire. Pénalité minime (-1.0 pt). |
| **SEC-007** | Évasion Sandbox Iframe via `allow-same-origin` | CRITIQUE | FIXED | **FIXED** | Attributs sandbox stricts sans allow-same-origin. Origine opaque. Test Vector 15. |
| **SEC-008** | Popout preview Blob sans `noopener noreferrer` | ÉLEVÉ | FIXED | **FIXED** | Attributs `noopener noreferrer` appliqués sur tous les liens popout. |
| **SEC-009** | Mutations autonomes `allowBreaking` permissives | ÉLEVÉ | PARTIALLY_FIXED | **FIXED** | Deny-by-default dans Executor et Service. Confirmation humaine requise. Test Vector 28. |
| **SEC-010** | Concaténation de prompt en clair & XSS Studio | ÉLEVÉ | PARTIALLY_FIXED | **FIXED** | Encadrement XML côté serveur, Iframe opaque sans accès DOM parent. Test Vector 9 & 16. |
| **SEC-011** | Dépendances CDN externes sans hash SRI | ÉLEVÉ | PARTIALLY_FIXED | **FIXED** | SRI SHA-512 sur bibliothèques, suppression totale du CDN Tailwind dynamique. Test Vector 19 & 30. |
| **SEC-012** | Mots de passe en clair dans `DATABASE_URL` | MOYEN | FIXED | **FIXED** | `maskConnectionString` systématique sur protocoles DB. Test Vector 17. |
| **SEC-013** | DoS & Absence de Rate Limiting effectif | ÉLEVÉ | PARTIALLY_FIXED | **FIXED** | Filtrage IP proxy de confiance, map bornée 10 000 clés, purge automatique. Test Vector 8, 21, 22. |
| **SEC-014** | Absence de signature cryptographique AuditStore | MOYEN | NOT_FIXED | **FIXED** | Chaînage de hash SHA-256 et méthode `verifyIntegrity()`. Test Vector 27. |
| **SEC-015** | Exposition publique de `/metrics` sans auth | FAIBLE | NOT_FIXED | **FIXED** | Accès restreint à localhost ou token ADMIN/OWNER/METRICS_TOKEN. Test Vector 25. |
| **SEC-016** | Usurpation auteur révision via `payload.author` | MOYEN | NOT_FIXED | **FIXED** | `payload.author` ignoré ; utilisation forcée de `context.role`. Test Vector 26. |
| **ARCH-01** | Endpoint de session dev anonyme `/auth/session` | MOYEN | NOUVEAU | **FIXED** | Désactivé en production, soumis à `ENABLE_DEV_AUTH_SESSION`. Test Vector 24. |

---

### Bilan des 17 Vulnérabilités & Faiblesses :
- **Totalement Corrigées (FIXED) :** 16 / 17 (94.1%)
- **Compromis Architectural Documenté (TRADE_OFF) :** 1 / 17 (5.9% — SEC-006)
- **Non Corrigées (NOT_FIXED) :** 0 / 17 (0.0%)
- **Vulnérabilités Critiques / Élevées Résiduelles :** **0**
