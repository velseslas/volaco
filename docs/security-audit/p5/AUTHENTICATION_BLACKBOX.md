# ATTAQUES ADVERSARIALES SUR L'AUTHENTIFICATION (AUTHENTICATION_BLACKBOX)

## 1. Résultats des Attaques Cryptographiques sur JWT

| Vecteur d'Attaque | Payload Testé | Statut HTTP | Verdict |
|---|---|:---:|:---:|
| **Algorithme "none"** | `{"alg":"none","typ":"JWT"}.payload.` | 401 Unauthorized | **PASS** (Rejeté) |
| **Altération de signature** | 1 bit modifié dans le 3ème segment | 401 Unauthorized | **PASS** (Rejeté) |
| **Jeton expiré** | `exp` dépassé de 3600 secondes | 401 Unauthorized | **PASS** (Rejeté) |
| **Clé asymétrique forgée** | Jeton signé avec clé tierce | 401 Unauthorized | **PASS** (Rejeté) |
| **En-tête Bearer vide** | `Authorization: Bearer ` | 401 Unauthorized | **PASS** (Rejeté) |
| **Octets nuls dans l'en-tête** | `Bearer eyJ\x00.eyJ` | Rejet Transport / 401 | **PASS** (Rejeté) |
| **Payload géant (> 10 Ko)** | Jeton artificiel de 12 000 octets | 401 Unauthorized | **PASS** (Rejeté) |

## 2. Robustesse du Secret Maître

Le test d'entropie confirme que si `AUTH_SECRET` n'est pas renseigné ou comporte moins de 32 caractères, le processus Node.js s'interrompt immédiatement avec une erreur fatale. Aucune clé par défaut de développement n'est autorisée en production.
