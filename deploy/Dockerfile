# =============================================================================
# volaco-core — image de production
# =============================================================================
# Base : image officielle Playwright 1.63.0 — elle contient déjà Chromium et
# toutes ses dépendances système, ce qui évite l'étape fragile
# « npx playwright install --with-deps chromium » sur le serveur.
# (Le projet épingle playwright-core 1.63.0 : les deux versions correspondent.)
#
# À construire depuis la RACINE du dossier de release :
#   docker build -f deploy/Dockerfile -t volaco-api .
# Le compose s'en charge — voir deploy/DEPLOIEMENT.md
# =============================================================================

FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app

# 1) Dépendances.
#    IMPORTANT : les « devDependencies » sont OBLIGATOIRES ici, même en
#    production : vite, @vitejs/plugin-react et @tailwindcss/vite sont chargés
#    à l'exécution pour compiler les applications générées (app-pipeline.ts).
COPY package.json package-lock.json ./
RUN npm ci --include=dev && npm cache clean --force

# 2) L'application complète, `dist/` INCLUS TEL QUEL.
#    Politique du projet (RELEASE-POLICY.md) : on ne reconstruit pas dist/ sur
#    le serveur, on le copie tel qu'il a été validé sur le poste de dev.
COPY . .

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Le serveur écrit ses données dans /app/.volaco-data et les workspaces de
# build dans /app/workspace : les deux sont montés en volume par le compose.
CMD ["node", "dist/apps/api/src/server.js"]
