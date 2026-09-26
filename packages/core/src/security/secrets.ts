export function maskSecret(value: string, visibleChars = 4): string {
  if (!value || typeof value !== 'string') return '';
  if (value.length <= visibleChars * 2) {
    return '***';
  }
  const start = value.slice(0, visibleChars);
  const end = value.slice(-visibleChars);
  return `${start}...${end}`;
}

const SENSITIVE_KEY_REGEX = /^(api_?key|token|password|secret|authorization|cookie|bearer)$/i;

export function sanitizePayload<T>(payload: T): T {
  if (payload === null || payload === undefined) {
    return payload;
  }

  if (typeof payload === 'string') {
    if (/sk_[a-zA-Z0-9_-]{20,}/.test(payload)) {
      return payload.replace(/sk_[a-zA-Z0-9_-]{20,}/g, (match) => maskSecret(match)) as unknown as T;
    }
    return payload;
  }

  if (Array.isArray(payload)) {
    return payload.map(item => sanitizePayload(item)) as unknown as T;
  }

  if (typeof payload === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        if (key.toLowerCase().includes('password')) {
          sanitized[key] = '***MASKED***';
        } else {
          sanitized[key] = typeof value === 'string' ? maskSecret(value) : '***MASKED***';
        }
      } else {
        sanitized[key] = sanitizePayload(value);
      }
    }
    return sanitized as T;
  }

  return payload;
}
