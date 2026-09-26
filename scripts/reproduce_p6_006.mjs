import { createApiServer } from '../dist/apps/api/src/server.js';
import { createTestAuthHeader } from '../dist/apps/api/tests/helpers/auth-helper.js';

async function run() {
  const { server } = createApiServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const authHeader = createTestAuthHeader('tenant-poc-006', 'ENGINEER');

  const tests = [
    { name: 'Test A (null)', body: 'null' },
    { name: 'Test B (body absent)', body: undefined },
    { name: 'Test C (JSON malformé)', body: '{"name":' },
    { name: 'Test D (tableau [])', body: '[]' },
    { name: 'Test E (primitive "hello")', body: '"hello"' },
    { name: 'Test F (objet vide {})', body: '{}' }
  ];

  for (const t of tests) {
    const res = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: t.body
    });
    const data = await res.json();
    console.log(`${t.name} -> HTTP ${res.status}:`, JSON.stringify(data));
  }

  server.close();
}

run();
