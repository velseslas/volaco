import { rm } from 'node:fs/promises';

// Build hygiene: dist is generated output and must never be used as a source of truth.
// Removing it before each build prevents stale compiled files/tests from surviving
// after source files are renamed or deleted.
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
console.log('✓ Clean build: dist/ removed before compilation.');
