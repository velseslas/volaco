# REGISTRE DES CONSTATS RED TEAM P2
## VOLACO-CORE — SYNTHÈSE DES 60 VECTEURS D'ATTAQUE ADVERSES

### 1. Synthèse par Catégorie de Menace

| Catégorie | Vecteurs Testés | Taux d'Échec Attaquant | Risque Résiduel |
| :--- | :---: | :---: | :---: |
| **1. Authentification & Confusion JWT** | 12 | 100% (12/12 neutralisés) | Négligeable |
| **2. Multi-Tenant Breakout & IDOR** | 8 | 100% (8/8 neutralisés) | Négligeable |
| **3. Rate Limiter, Spoofing & Anti-DoS** | 6 | 100% (6/6 neutralisés) | Négligeable |
| **4. Body Attacks & Protocol Parsing** | 6 | 100% (6/6 neutralisés) | Négligeable |
| **5. Path Traversal & Filesystem** | 6 | 100% (6/6 neutralisés) | Négligeable |
| **6. AI Orchestrator & Agent Runtime** | 6 | 100% (6/6 neutralisés) | Négligeable |
| **7. Sandbox Iframe, PostMessage & DOM** | 4 | 100% (4/4 neutralisés) | Négligeable |
| **8. Audit Trail Cryptographique** | 2 | 100% (2/2 neutralisés) | Faible (Mémoire) |
| **9. Chaînes d'Attaque Composées 1 à 10** | 10 | 100% (10/10 neutralisées) | Négligeable |
| **TOTAL** | **60** | **100% (60/60 NEUTRALISÉS)** | **0 Brèche** |

---

### 2. Détail des Constats Techniques Majeurs

- **Algorithme JWT (`alg: none`) :** Rejet systématique avec code HTTP 401. Le parseur compare obligatoirement le HMAC calculé avec le secret serveur et la signature fournie.
- **IDOR Transverse :** Toutes les routes de manipulation de données injectent `context.tenantId` dans les requêtes de magasin. Toute tentative de requêter l'identifiant d'un locataire tiers déclenche un code 404 (NotFoundError) pour masquer l'existence de la ressource.
- **Usurpation d'Adresse IP :** L'en-tête `X-Forwarded-For` n'est pris en compte que si le socket distant figure dans `TRUSTED_PROXIES`. Les attaquants externes directs sont confinés à leur IP socket réelle.
- **Plafond Mémoire du Corps HTTP :** Le parseur `readBody()` vérifie `Content-Length` immédiatement avant toute lecture de flux et détruit la connexion socket dès dépassement de quota (HTTP 413).
- **Confinement de Fichiers Statiques :** La combinaison de `decodeURIComponent()`, `path.resolve(studioRoot, relativeFile)`, du contrôle de préfixe et de l'interdiction de `..` bloque toutes les variantes de traversée (Windows antislash, doubles encodages URL, caractères nuls).
