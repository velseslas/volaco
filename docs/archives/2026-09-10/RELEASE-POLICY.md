# Volaco Release Policy

## Critical rule

`dist/` is currently part of the runtime and contains installed AI phases that are not all represented in TypeScript source.

**Never run a clean build as part of release preparation.**
Do not run `rm -rf dist`, `npm run build`, or any process that recreates `dist` unless the complete phase source/runtime parity has first been established and explicitly approved.

## Release preparation

Use:

```powershell
node scripts/prepare-release.mjs
```

The script creates a clean release copy while preserving `dist/` byte-for-byte from the current working tree.

It excludes local/runtime artifacts such as `node_modules`, `.env*`, `.volaco_*`, backups, scratch files, coverage and test reports.

## Surgical patches

Patches must not replace the complete project or complete `dist/`. Runtime changes must provide only the exact compiled JS files that need to change.
