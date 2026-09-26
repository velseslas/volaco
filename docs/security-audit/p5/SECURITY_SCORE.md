# MODÈLE DE SCORING DE SÉCURITÉ P5 (SECURITY_SCORE)

## 1. Décompte des Pénalités

$$\text{Score} = 100 - (\text{Critical} \times 25) - (\text{High} \times 10) - (\text{Medium} \times 3) - (\text{Low} \times 0.25) - (\text{Info} \times 0.0)$$

| Niveau de Gravité | Constatations | Pénalité Unitaire | Total Pénalités |
|---|:---:|:---:|:---:|
| **CRITICAL** | 0 | 25.0 | 0.0 |
| **HIGH** (P5-CRIT-01) | 1 | 10.0 | -10.0 |
| **MEDIUM** (P5-MED-01 à 03) | 3 | 3.0 | -9.0 |
| **LOW** (P5-LOW-01 à 02) | 2 | 0.25 | -0.5 |
| **INFO** | 1 | 0.0 | 0.0 |
| **TOTAL DES PÉNALITÉS** | | | **-19.5** |

$$\text{Score P5 Indépendant} = 100 - 19.5 = \mathbf{80.5 / 100}$$

## 2. Indice de Confiance de Production
- **Niveau attribué :** **PARTIALLY VERIFIED**
- **Justification :** Le système présente une excellente robustesse structurelle sur l'authentification et l'isolation des données, mais la présence d'une vulnérabilité active de déni de service inter-locataires et de fuites dans les erreurs 500 interdit de certifier une sécurité de production sans correctif préalable.
