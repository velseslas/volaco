# ADR-003 — CSP différée tant que le preview est un iframe srcdoc

**Décision :** appliquer les en-têtes Annexe F (nosniff, Referrer-Policy,
Permissions-Policy, X-Frame-Options) SAUF la Content-Security-Policy, en
exception documentée.

**Contexte :** le preview du Studio est un iframe `srcdoc` — il HÉRITE de la
CSP de la page parente. Les applications générées chargent des CDNs arbitraires
(Tailwind, FontAwesome, chart.js…) et des scripts inline : une CSP parente
stricte casserait la promesse « toute app générée fonctionne ».

**Alternatives :** CSP permissive (rejeté : faux sentiment de sécurité) ;
servir les previews via HTTP avec leur propre CSP (retenu pour plus tard :
à l'étape de matérialisation disque, chaque projet a des fichiers réels
servables).

**Conséquences :** les autres en-têtes protègent dès maintenant ; la CSP
stricte arrive avec le preview servi par HTTP ; exception tracée ici et dans
server.ts (Annexe F : « toute exception doit être documentée et limitée »).

**Statut :** ACTIVE
