export async function testApiConnection(apiUrl = 'http://127.0.0.1:3000') {
  const startTime = performance.now();
  const requestId = 'studio_' + Math.random().toString(36).substring(2, 10);

  try {
    const res = await fetch(`${apiUrl}/health`, {
      headers: { 'X-Request-Id': requestId }
    });
    const latency = Math.round(performance.now() - startTime);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    return {
      connected: true,
      latencyMs: latency,
      service: data.service,
      version: data.version,
      requestId: data.requestId,
      status: data.status
    };
  } catch (err) {
    return {
      connected: false,
      error: err.message
    };
  }
}
