import { createApiServer } from '../dist/apps/api/src/server.js';
import { createTestAuthHeader } from '../dist/apps/api/tests/helpers/auth-helper.js';

async function run() {
  process.env.MISTRAL_API_KEY = 'test-key-for-audit';
  const { server } = createApiServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const authHeader = createTestAuthHeader('tenant-p7-audit', 'ADMIN');

  console.log('--- STARTING P7 SECURITY FINDINGS VERIFICATION ---');

  const createRes = await fetch(`${baseUrl}/api/v1/projects`, {
    method: 'POST',
    headers: { ...authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Project P7 Audit' })
  });
  const resJson = await createRes.json();
  const projectId = resJson.project.id;
  console.log(`Setup: created project ${projectId}, HTTP ${createRes.status}`);

  const nullPayloadRoutes = [
    { method: 'PUT', path: `/api/v1/projects/${projectId}/settings`, name: 'PUT settings' },
    { method: 'PUT', path: `/api/v1/projects/${projectId}/workspace`, name: 'PUT workspace' },
    { method: 'PUT', path: `/api/v1/projects/${projectId}/status`, name: 'PUT status' },
    { method: 'POST', path: `/api/v1/projects/${projectId}/revisions`, name: 'POST revisions' },
    { method: 'PUT', path: `/api/v1/projects/${projectId}/files/content`, name: 'PUT file content' },
    { method: 'POST', path: `/api/v1/projects/${projectId}/files/rename`, name: 'POST file rename' },
    { method: 'POST', path: `/api/v1/projects/${projectId}/files`, name: 'POST file create' },
    { method: 'POST', path: `/api/v1/projects/${projectId}/files/commit`, name: 'POST file commit' },
    { method: 'POST', path: `/api/v1/projects/${projectId}/files/move`, name: 'POST file move' },
    { method: 'POST', path: `/api/v1/projects/${projectId}/files/operation`, name: 'POST file operation' },
    { method: 'POST', path: `/api/v1/projects/${projectId}/terminal/execute`, name: 'POST terminal execute' },
    { method: 'POST', path: `/api/v1/projects/${projectId}/audit/analyze`, name: 'POST audit analyze' },
    { method: 'POST', path: `/api/v1/projects/${projectId}/feedback/analyze`, name: 'POST feedback analyze' },
    { method: 'POST', path: `/api/v1/projects/${projectId}/features/analyze`, name: 'POST features analyze' },
    { method: 'POST', path: `/api/v1/projects/${projectId}/evolution/analyze`, name: 'POST evolution analyze' }
  ];

  console.log('\n=== TESTING FINDING 1: NULL PAYLOADS ON MUTATION ROUTES ===');
  for (const route of nullPayloadRoutes) {
    try {
      const res = await fetch(`${baseUrl}${route.path}`, {
        method: route.method,
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: 'null'
      });
      const data = await res.json().catch(() => null);
      console.log(`[${route.name}] -> HTTP ${res.status}: ${JSON.stringify(data)}`);
    } catch (err) {
      console.error(`[${route.name}] Fetch error:`, err);
    }
  }

  console.log('\n=== TESTING FINDING 2: AI PROXY WITH NULL BODY ===');
  try {
    const res = await fetch(`${baseUrl}/api/v1/ai/chat/completions`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: 'null'
    });
    const data = await res.json().catch(() => null);
    console.log(`[POST /api/v1/ai/chat/completions (null)] -> HTTP ${res.status}: ${JSON.stringify(data)}`);
  } catch (err) {
    console.error('[POST /api/v1/ai/chat/completions (null)] Fetch error:', err);
  }

  server.close();
  console.log('\n--- VERIFICATION COMPLETED ---');
}
run();
