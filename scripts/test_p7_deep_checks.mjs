import { createApiServer } from '../dist/apps/api/src/server.js';
import { createTestAuthHeader } from '../dist/apps/api/tests/helpers/auth-helper.js';

async function run() {
  const { server } = createApiServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  
  const tenantA_Admin = createTestAuthHeader('tenant-A', 'ADMIN');
  const tenantA_Viewer = createTestAuthHeader('tenant-A', 'VIEWER');
  const tenantB_Admin = createTestAuthHeader('tenant-B', 'ADMIN');

  console.log('=== MULTI-TENANT ISOLATION TESTS ===');
  // Tenant A creates project
  const pA_res = await fetch(`${baseUrl}/api/v1/projects`, {
    method: 'POST',
    headers: { ...tenantA_Admin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Project A' })
  });
  const pA = (await pA_res.json()).project;
  console.log(`Tenant A created project ${pA.id}`);

  // Tenant B tries to access Tenant A's project
  const pB_get = await fetch(`${baseUrl}/api/v1/projects/${pA.id}`, {
    headers: tenantB_Admin
  });
  console.log(`Tenant B GET Project A -> HTTP ${pB_get.status} (Expected: 404)`);

  // Tenant B tries to write settings to Tenant A's project
  const pB_put_settings = await fetch(`${baseUrl}/api/v1/projects/${pA.id}/settings`, {
    method: 'PUT',
    headers: { ...tenantB_Admin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ framework: 'react' })
  });
  console.log(`Tenant B PUT Settings Project A -> HTTP ${pB_put_settings.status} (Expected: 404)`);

  // Tenant B tries to create revision in Tenant A's project
  const pB_rev = await fetch(`${baseUrl}/api/v1/projects/${pA.id}/revisions`, {
    method: 'POST',
    headers: { ...tenantB_Admin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'hacked', files: [] })
  });
  console.log(`Tenant B POST Revision Project A -> HTTP ${pB_rev.status} (Expected: 404)`);

  console.log('\n=== RBAC ENFORCEMENT TESTS ===');
  // VIEWER tries to create revision
  const v_rev = await fetch(`${baseUrl}/api/v1/projects/${pA.id}/revisions`, {
    method: 'POST',
    headers: { ...tenantA_Viewer, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'viewer change', files: [] })
  });
  console.log(`Viewer POST Revision -> HTTP ${v_rev.status} (Expected: 403)`);

  // VIEWER tries to execute terminal
  const v_term = await fetch(`${baseUrl}/api/v1/projects/${pA.id}/terminal/execute`, {
    method: 'POST',
    headers: { ...tenantA_Viewer, 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'echo 1' })
  });
  console.log(`Viewer POST Terminal -> HTTP ${v_term.status} (Expected: 403)`);

  // VIEWER tries to call AI proxy
  const v_ai = await fetch(`${baseUrl}/api/v1/ai/chat/completions`, {
    method: 'POST',
    headers: { ...tenantA_Viewer, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] })
  });
  console.log(`Viewer POST AI Chat -> HTTP ${v_ai.status} (Expected: 403)`);

  console.log('\n=== SECURITY HEADERS TESTS ===');
  const head_res = await fetch(`${baseUrl}/health`);
  console.log('CSP:', head_res.headers.get('content-security-policy') ? 'PRESENT' : 'MISSING');
  console.log('HSTS:', head_res.headers.get('strict-transport-security') ? 'PRESENT' : 'MISSING');
  console.log('X-Content-Type-Options:', head_res.headers.get('x-content-type-options'));
  console.log('X-Frame-Options:', head_res.headers.get('x-frame-options'));

  console.log('\n=== CONCURRENCY TESTS ===');
  // 5 concurrent revisions on Tenant A
  const revPromises = Array.from({ length: 5 }).map((_, i) =>
    fetch(`${baseUrl}/api/v1/projects/${pA.id}/revisions`, {
      method: 'POST',
      headers: { ...tenantA_Admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Concurrent revision ${i}`, files: [] })
    }).then(r => r.status)
  );
  const revStatuses = await Promise.all(revPromises);
  console.log('Concurrent revision creation statuses:', revStatuses);

  server.close();
}

run();
