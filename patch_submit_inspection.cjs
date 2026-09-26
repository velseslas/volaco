const fs = require('fs');
const path = require('path');

const filePath = path.resolve('apps/studio/index.html');
let content = fs.readFileSync(filePath, 'utf8');

const targetStr = `      const attachedSnapshot = [...chatAttachedFiles];`;
const replacementStr = `      // Inclusion de la capture technique DOM inspectée si présente
      if (attachedCaptureInspection) {
        userMessageHtml += '<div class="mt-2.5 p-2 bg-neutral-900/90 border border-neutral-700 rounded-xl flex items-center gap-2.5">' +
          '<div class="h-12 w-12 shrink-0 rounded-lg overflow-hidden border border-neutral-700 bg-black flex items-center justify-center">' +
          '<img src="' + attachedCaptureInspection.imageBase64 + '" class="h-full w-full object-cover">' +
          '</div>' +
          '<div class="min-w-0 flex flex-col gap-0.5">' +
          '<div class="flex items-center gap-1.5">' +
          '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">DOM lié</span>' +
          '<span class="text-[11px] font-mono text-slate-300 truncate">' + (attachedCaptureInspection.selector || 'body') + '</span>' +
          '</div>' +
          '<span class="text-[9px] text-slate-400">Styles & structure transmis à l\\\'IA</span>' +
          '</div>' +
          '</div>';
        detachInspectionFromChat();
      }

      const attachedSnapshot = [...chatAttachedFiles];`;

if (content.includes(targetStr) && !content.includes('Inclusion de la capture technique DOM inspectée si présente')) {
  content = content.replace(targetStr, replacementStr);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Updated handleWorkspacePromptSubmit with inspection support');

  // Synchronize all mirrors
  const mirrors = [
    path.resolve('apps/studio/volaco_studio.html'),
    path.resolve('volaco_studio.html'),
    path.resolve('C:/Users/FAYCAL/.gemini/antigravity/brain/8fa9edf0-0fd9-4b9a-aba5-b16114e16dd7/volaco_studio.html')
  ];

  for (const m of mirrors) {
    if (fs.existsSync(m)) {
      fs.writeFileSync(m, content, 'utf8');
      console.log('Synchronized mirror:', m);
    }
  }
} else {
  console.log('Target string not found or already patched');
}
