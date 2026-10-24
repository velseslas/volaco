process.env.VOLACO_EXECUTION_TIMELINE = 'off';
process.env.PORT = '3901';
const fs = require('node:fs');
(async () => {
  const meta = JSON.parse(fs.readFileSync('missions-artifacts/mode/meta.json', 'utf8'));
  const { createApiServer } = await import('../dist/apps/api/src/server.js');
  const server = createApiServer({ port: 3901 }).server;
  await new Promise((r) => server.listen(3901, r));
  const base = 'http://127.0.0.1:3901';
  const H = { 'Content-Type': 'application/json; charset=utf-8', 'x-tenant-id': 'tenant_mission', 'x-user-role': 'ENGINEER' };
  for (const [label] of [['desktop'], ['mobile']]) {
    const r = await fetch(`${base}/api/v1/projects/${meta.projectId}/render/preview`, { method: 'POST', headers: H, body: '{}' });
    const j = await r.json();
    console.log(label, r.status, j.screenshotBase64 ? 'OK ' + j.screenshotBase64.length : JSON.stringify(j).slice(0, 120));
    if (j.screenshotBase64) fs.writeFileSync(`missions-artifacts/mode/${label}.png`, Buffer.from(j.screenshotBase64, 'base64'));
  }
  server.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
