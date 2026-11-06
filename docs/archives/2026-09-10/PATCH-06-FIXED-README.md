# PATCH 06 FIXED — Orchestrator Wiring (runtime-only)

This patch replaces ONLY `dist/apps/api/src/server.js`.

It is based on the current runtime server and preserves the existing Phase 9.5→19 code.
It does NOT run a build and does NOT delete/recreate dist.

The change only:
- imports CodeIntelligenceService, ApplicationDNAService, SemanticCodeGraphService, ApplicationUnderstandingService, ImpactIntelligenceService
- instantiates them in dependency order
- moves AIOrchestratorService bootstrap after MutationService is ready
- passes the real services instead of undefined

Apply:
`powershell -ExecutionPolicy Bypass -File .\apply_patch06_fixed.ps1`

Do NOT run `npm run build` for this runtime patch.
