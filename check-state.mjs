import { readFileSync, writeFileSync } from 'node:fs';
let src = readFileSync('apps/studio/index.html', 'utf8');
// Vérifie que le moteur de construction en direct (Stitch) a survécu au revert
const checks = {
  openLiveCanvas: src.includes('function openLiveCanvas()'),
  feedCanvas: src.includes('function feedCanvas(chunk)'),
  scanner: src.includes('function scanNextElement(buffer)'),
  laser: src.includes("command: 'canvas-state'"),
  pacerV2: src.includes('const delay = /[.!?]/.test(last)'),
  grounding: src.includes('buildPageContext(currentHtml)')
};
writeFileSync('check-state.tmp.json', JSON.stringify(checks, null, 2));
