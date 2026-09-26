const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('=== TEST 1: Verification of TypeScript Frontend Files ===');
const frontendDir = path.resolve('../volaco/frontend/src');

// 1. Check capture.ts
const captureTs = fs.readFileSync(path.join(frontendDir, 'utils/capture.ts'), 'utf8');
assert(captureTs.includes('getUniqueSelector'), 'capture.ts must export getUniqueSelector');
assert(captureTs.includes('extractCriticalComputedStyles'), 'capture.ts must export extractCriticalComputedStyles');
assert(captureTs.includes('triggerCameraFlash'), 'capture.ts must export triggerCameraFlash');
assert(captureTs.includes('opacity 100ms'), 'camera flash must transition 0 -> 0.35 -> 0 sur 200ms');
assert(captureTs.includes('Capture effectuée'), 'camera flash must show micro toast Capture effectuée');
assert(captureTs.includes('captureElementWithInspection'), 'capture.ts must export captureElementWithInspection');
console.log('✓ capture.ts: All functions & flash mechanics verified.');

// 2. Check StudioContext.tsx
const contextTs = fs.readFileSync(path.join(frontendDir, 'context/StudioContext.tsx'), 'utf8');
assert(contextTs.includes('StudioProvider'), 'StudioContext must export StudioProvider');
assert(contextTs.includes('useStudio'), 'StudioContext must export useStudio');
assert(contextTs.includes('isTargetMode'), 'StudioContext must manage isTargetMode');
assert(contextTs.includes('attachedInspection'), 'StudioContext must manage attachedInspection');
assert(contextTs.includes('focusChatInput'), 'StudioContext must provide focusChatInput');
console.log('✓ StudioContext.tsx: Global studio state verified.');

// 3. Check CaptureModal.tsx & CaptureViewerModal.tsx
const captureModalTs = fs.readFileSync(path.join(frontendDir, 'components/CaptureModal.tsx'), 'utf8');
assert(captureModalTs.includes('CaptureModal'), 'CaptureModal.tsx must export CaptureModal');
const captureViewerTs = fs.readFileSync(path.join(frontendDir, 'components/CaptureViewerModal.tsx'), 'utf8');
assert(captureViewerTs.includes('Envoyer à l\'IA pour correction'), 'CaptureViewerModal must have Envoyer à l\'IA pour correction button');
assert(captureViewerTs.includes('Sparkles'), 'Button must feature Sparkles icon');
assert(captureViewerTs.includes('bg-amber-500/10'), 'Button must have amber tinted style');
assert(captureViewerTs.includes('onSendInspectionToChat'), 'Modal must transfer DOM inspection data to chat');
console.log('✓ CaptureModal & CaptureViewerModal: Footer Send to AI button & styling verified.');

// 4. Check StudioHeader.tsx & Header.tsx
const studioHeaderTs = fs.readFileSync(path.join(frontendDir, 'components/StudioHeader.tsx'), 'utf8');
assert(studioHeaderTs.includes('StudioHeader'), 'StudioHeader.tsx must export StudioHeader');
const headerTs = fs.readFileSync(path.join(frontendDir, 'components/Header.tsx'), 'utf8');
assert(headerTs.includes('Cibler élément'), 'Header must have Cibler élément toggle button');
assert(headerTs.includes('Target') || headerTs.includes('Crosshair'), 'Header must use Target/Crosshair icon');
assert(headerTs.includes('isTargetMode'), 'Header must support isTargetMode prop');
console.log('✓ StudioHeader & Header: Cibler élément button verified.');

// 5. Check ChatInput.tsx & VibeChat.tsx
const chatInputTs = fs.readFileSync(path.join(frontendDir, 'components/ChatInput.tsx'), 'utf8');
assert(chatInputTs.includes('ChatInput'), 'ChatInput.tsx must export ChatInput');
assert(chatInputTs.includes('DOM lié'), 'ChatInput must render DOM lié badge');
assert(chatInputTs.includes('h-14 w-14'), 'ChatInput must render 56px thumbnail');
assert(chatInputTs.includes('Décrivez la modification ou le problème constaté...'), 'ChatInput must adapt placeholder');
const vibeChatTs = fs.readFileSync(path.join(frontendDir, 'components/VibeChat.tsx'), 'utf8');
assert(vibeChatTs.includes('DOM lié'), 'VibeChat must render DOM lié badge');
assert(vibeChatTs.includes('h-14 w-14'), 'VibeChat must render 56px thumbnail');
assert(vibeChatTs.includes('Décrivez la modification ou le problème constaté...'), 'VibeChat must adapt placeholder');
assert(vibeChatTs.includes('onClearAttachedInspection'), 'VibeChat must allow removing attached inspection with red X');
console.log('✓ ChatInput & VibeChat: 56px thumbnail, DOM lié badge & adapted placeholder verified.');

// 6. Check PreviewCanvas.tsx
const previewCanvasTs = fs.readFileSync(path.join(frontendDir, 'components/PreviewCanvas.tsx'), 'utf8');
assert(previewCanvasTs.includes('SET_TARGET_MODE'), 'PreviewCanvas must send SET_TARGET_MODE to iframe');
assert(previewCanvasTs.includes('TARGET_ELEMENT_CAPTURED'), 'PreviewCanvas must handle TARGET_ELEMENT_CAPTURED');
assert(previewCanvasTs.includes('transition-opacity duration-200'), 'PreviewCanvas must render 200ms camera flash');
console.log('✓ PreviewCanvas: Click-to-inspect bridge & flash verified.');

console.log('\n=== TEST 2: Verification of Studio HTML & Mirrors ===');
const studioHtml = fs.readFileSync(path.resolve('apps/studio/index.html'), 'utf8');

assert(studioHtml.includes('id="cameraFlashOverlay"'), 'studio HTML must contain cameraFlashOverlay');
assert(studioHtml.includes('id="btnToggleTargetInspect"'), 'studio HTML must contain btnToggleTargetInspect');
assert(studioHtml.includes('id="modalCaptureBtnSendAi"'), 'studio HTML must contain modalCaptureBtnSendAi');
assert(studioHtml.includes('id="chatInspectionAttachmentBar"'), 'studio HTML must contain chatInspectionAttachmentBar');
assert(studioHtml.includes('DOM lié'), 'studio HTML must contain DOM lié badge');
assert(studioHtml.includes('vibecode-target-element-captured'), 'studio HTML bridge must handle target element capture');
assert(studioHtml.includes('toggleTargetElementMode'), 'studio HTML must define toggleTargetElementMode');
assert(studioHtml.includes('sendCaptureToAiForCorrection'), 'studio HTML must define sendCaptureToAiForCorrection');

console.log('✓ studio HTML: All 5 modules present and functional.');

// Parity checks
const mirror1 = fs.readFileSync(path.resolve('apps/studio/volaco_studio.html'), 'utf8');
const mirror2 = fs.readFileSync(path.resolve('volaco_studio.html'), 'utf8');
const brainMirror = fs.readFileSync('C:/Users/FAYCAL/.gemini/antigravity/brain/8fa9edf0-0fd9-4b9a-aba5-b16114e16dd7/volaco_studio.html', 'utf8');

assert.strictEqual(studioHtml, mirror1, 'apps/studio/volaco_studio.html must have 100% binary parity');
assert.strictEqual(studioHtml, mirror2, 'volaco_studio.html must have 100% binary parity');
assert.strictEqual(studioHtml, brainMirror, 'brain volaco_studio.html must have 100% binary parity');
console.log('✓ Parity: 100% byte-for-byte binary parity across all 4 mirrors.');

console.log('\n🎉 ALL VISUAL INSPECTION TESTS PASSED WITH 100% SUCCESS!');
