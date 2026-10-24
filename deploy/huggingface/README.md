---
title: Volaco Vibecoding
emoji: 🚀
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: true
---

# Volaco / Vibecoding — Space de démonstration

Plateforme AI-Native de création, validation et évolution d'applications.
Studio complet à l'ouverture du Space (connexion : écran de login intégré).

## Secrets à configurer dans le Space (Settings → Variables and secrets)

| Secret | Rôle |
|---|---|
| `MISTRAL_API_KEY` | Clé API Mistral (génération) |
| `AUTH_SECRET` | Secret de signature JWT (≥ 32 caractères, fixe) |

Ne jamais commiter ces valeurs dans le dépôt du Space.

## Limites du plan gratuit

- Disque **éphémère** : les projets repartent de zéro au redémarrage du Space ;
- **Sleep** après 48 h sans visite (réveil ~1 min à la première visite) ;
- Build initial ~5-10 min (image Playwright + Chromium ≈ 2 Go).
