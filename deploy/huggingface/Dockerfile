# =============================================================================
# volaco-core — Hugging Face Spaces (hébergement gratuit, URL fixe)
# =============================================================================
# Adaptation du Dockerfile de production pour les Spaces HF :
#   - écoute sur 7860 (port attendu par la plateforme) ;
#   - tourne en utilisateur non-root uid 1000 (exigence HF) ;
#   - les secrets (MISTRAL_API_KEY, AUTH_SECRET) ne sont JAMAIS dans
#     l'image : ils sont injectés par les « Variables and secrets » du Space.
#
# Note : le disque d'un Space gratuit est ÉPHÉMÈRE — les projets créés
# disparaissent au redémarrage/sleep du Space. Parfait pour une démo
# publique et un test de charge réel ; la persistance viendra de la
# migration PostgreSQL (§38) pointée vers une base externe gratuite.
# =============================================================================

FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev && npm cache clean --force

COPY . .

ENV NODE_ENV=production
ENV PORT=7860

# HF exécute le conteneur en uid 1000 : /app doit lui appartenir pour que
# .volaco-data et workspace soient inscriptibles.
RUN useradd -m -u 1000 user \
    && mkdir -p /app/.volaco-data /app/workspace \
    && chown -R user:user /app

USER 1000

EXPOSE 7860

CMD ["node", "dist/apps/api/src/server.js"]
